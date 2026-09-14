import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, unlink, rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readRootOperation, settleRootOperation, operationExpectedBeforeHash, type OperationClaim, type PrismaClient } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";
import { createControlledOperationRequest, getControlledOperationRequest, holdControlledOperationRequest, cancelControlledOperationRequest, resumeControlledOperationRequest } from "../../apps/web/lib/system/controlled-operation-request-service";
import { operationJournalDirectory, readOperationJournal } from "../../ops/controlled-operation-agent/journal";
import { prepareOperationCase, publishOperationFixtureContext } from "./controlled-operation-fixture-driver";
import { createOperationFixtureRequest, operationRequestBinding } from "./controlled-operation-runtime-data";
import { startOperationFixtureAgent } from "./controlled-operation-process";
import type { ControlledOperationFixture } from "./controlled-operation-fixture";

export async function testOperationRaces(client: PrismaClient, fixture: ControlledOperationFixture, actor: CurrentUser, passed: (name: string) => void) {
  const create = async (name: string) => {
    const data = await prepareOperationCase(fixture, `${name}-${randomUUID().slice(0, 8)}`);
    return { ...data, request: await createOperationFixtureRequest(actor, data.context) };
  };
  const hold = async (id: string) => {
    const row = await getControlledOperationRequest(actor, id);
    return holdControlledOperationRequest(actor, id, { ...operationRequestBinding(row), reasonCode: "INCIDENT" });
  };
  const resume = async (id: string) => resumeControlledOperationRequest(actor, id, operationRequestBinding(await getControlledOperationRequest(actor, id)));
  {
    const data = await prepareOperationCase(fixture, `expired-admission-${randomUUID().slice(0, 8)}`);
    const past = new Date(Date.now() - 400_000);
    const expired = await createControlledOperationRequest(actor, { operation: { operation: "APPLY_RELEASE", tag: "v9.9.1" },
      expectedBeforeHash: operationExpectedBeforeHash(data.context.expectedBefore), executionSnapshotHash: data.context.snapshotHash,
      idempotencyKey: randomUUID(), requestedReason: "合成过期请求" }, { now: past });
    await client.controlledOperationRequest.update({ where: { id: expired.id }, data: { status: "QUEUED", confirmedByUserId: actor.id, approvedByUserId: actor.id, confirmedAt: past, approvedAt: past } });
    assert.equal((await startOperationFixtureAgent(fixture, data.name, expired.id).done).code, 0);
    assert.equal((await getControlledOperationRequest(actor, expired.id)).status, "EXPIRED");
    assert.equal((await readdir(path.join(data.root, "synthetic-effects"))).length, 0);
    const next = await createOperationFixtureRequest(actor, data.context);
    assert.equal((await startOperationFixtureAgent(fixture, data.name, next.id).done).code, 0);
    passed("expired queued request records expiry with zero effects and does not poison later admission");
  }
  {
    const data = await create("unclaimed-registration");
    try {
      await client.user.update({ where: { id: actor.id }, data: { status: "SUSPENDED" } });
      assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 1);
    } finally { await client.user.update({ where: { id: actor.id }, data: { status: "ACTIVE" } }); }
    assert.equal((await getControlledOperationRequest(actor, data.request.id)).attempt, 0);
    const next = await createOperationFixtureRequest(actor, data.context);
    const result = await startOperationFixtureAgent(fixture, data.name, next.id).done; assert.equal(result.code, 0, result.stderr);
    passed("pre-claim rejection leaves a provably unclaimed bridge and does not block unrelated work");
  }
  {
    const data = await create("hold-cancel-writeback");
    const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started,terminal:durable" });
    try {
      await active.waitFor("validation:started"); await hold(data.request.id); active.continue();
      await active.waitFor("terminal:durable"); const current = await getControlledOperationRequest(actor, data.request.id);
      assert.ok(current.workerId); await cancelControlledOperationRequest(actor, current.id, operationRequestBinding(current));
      active.continue(); const result = await active.done; assert.equal(result.code, 0, result.stderr);
      assert.equal((await getControlledOperationRequest(actor, current.id)).status, "CANCELLED");
      assert.equal((await readOperationJournal(operationJournalDirectory(data.root, current.requestHash))).at(-1)?.outcome, "CANCELLED");
    } finally { active.stop(); await active.done; }
    passed("durable hold receipt cannot overwrite a newer cancel request");
  }
  {
    const data = await create("prior-generation"); const first = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started" });
    try { await first.waitFor("validation:started"); await hold(data.request.id); first.continue(); assert.equal((await first.done).code, 0); }
    finally { first.stop(); await first.done; }
    await resume(data.request.id);
    const second = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "claim:committed" });
    await second.waitFor("claim:committed");
    const previous = await readRootOperation(client, data.request.id);
    const stale: OperationClaim = { request: previous.row, operation: previous.operation, workerId: previous.row.workerId!, token: previous.row.leaseToken!, generation: previous.row.attempt };
    second.stop(); await second.done; await leaseExpiry(client, data.request.id);
    const recovered = await startOperationFixtureAgent(fixture, data.name, data.request.id).done; assert.equal(recovered.code, 0, recovered.stderr);
    const row = await getControlledOperationRequest(actor, data.request.id); assert.equal(row.status, "SUCCEEDED"); assert.equal(row.attempt, 3);
    await assert.rejects(settleRootOperation(client, stale, { outcome: "SUCCEEDED", resultCode: "STALE", evidenceHash: row.evidenceHash!, rawEvidenceHash: row.evidenceHash! }), /STALE_EXECUTOR/);
    passed("claim-before-admission SIGKILL rejects prior generation terminal and stale executor");
  }
  {
    const data = await create("cross-request-anchor"); const first = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started" });
    try { await first.waitFor("validation:started"); await hold(data.request.id); first.continue(); assert.equal((await first.done).code, 0); }
    finally { first.stop(); await first.done; }
    const directory = operationJournalDirectory(data.root, data.request.requestHash); const prefix = (await readOperationJournal(directory)).length;
    await resume(data.request.id); const second = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "backup:effect" });
    await second.waitFor("backup:effect"); second.stop(); await second.done; await leaseExpiry(client, data.request.id);
    assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 0);
    const events = await readOperationJournal(directory);
    for (let index = prefix + 1; index <= events.length; index++) await unlink(path.join(directory, `${String(index).padStart(6, "0")}.json`));
    await publishOperationFixtureContext(fixture, data.context); const next = await createOperationFixtureRequest(actor, data.context);
    const denied = await startOperationFixtureAgent(fixture, data.name, next.id).done;
    assert.equal(denied.code, 1); assert.match(denied.stderr, /OPS_JOURNAL_TRUNCATED/);
    assert.equal((await getControlledOperationRequest(actor, next.id)).attempt, 0);
    passed("other-request truncated valid prefix cannot bypass scope-wide reconciliation barrier");
  }
  {
    const data = await create("verified-no-effect");
    assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id, { rejectExecution: true }).done).code, 0);
    const failed = await getControlledOperationRequest(actor, data.request.id);
    assert.equal(failed.failureCode, "SYNTHETIC_LOCK_BUSY");
    assert.equal((await readdir(path.join(data.root, "synthetic-effects"))).length, 0);
    const next = await createOperationFixtureRequest(actor, data.context);
    const result = await startOperationFixtureAgent(fixture, data.name, next.id).done; assert.equal(result.code, 0, result.stderr);
    assert.equal((await getControlledOperationRequest(actor, next.id)).status, "SUCCEEDED");
    passed("verified zero-effect rejection is ordinary failure and does not permanently block the scope");
  }
  {
    const data = await create("missing-entire-journal"); const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "backup:effect" });
    await active.waitFor("backup:effect"); active.stop(); await active.done; await leaseExpiry(client, data.request.id);
    assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 0);
    await rename(operationJournalDirectory(data.root, data.request.requestHash), path.join(data.root, "quarantined-test-journal"));
    const next = await createOperationFixtureRequest(actor, data.context);
    const result = await startOperationFixtureAgent(fixture, data.name, next.id).done; assert.equal(result.code, 1); assert.match(result.stderr, /OPS_JOURNAL_TRUNCATED|OPS_SCOPE_RECONCILIATION_REQUIRED/);
    assert.equal((await getControlledOperationRequest(actor, next.id)).attempt, 0);
    passed("database root registry detects a missing whole journal, not only truncated files");
  }
  {
    const data = await create("tampered-journal-body"); assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 0);
    const file = path.join(operationJournalDirectory(data.root, data.request.requestHash), "000001.json");
    const event = JSON.parse(await readFile(file, "utf8")); event.resultCode = "TAMPERED";
    await writeFile(file, JSON.stringify(event), { mode: 0o600 });
    const result = await startOperationFixtureAgent(fixture, data.name, data.request.id).done; assert.equal(result.code, 1); assert.match(result.stderr, /OPS_JOURNAL_INVALID/);
    passed("journal content tampering is rejected before claim or side effects");
  }
  {
    const data = await create("repeated-receipt-recovery");
    const first = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "terminal:durable" });
    await first.waitFor("terminal:durable"); first.stop(); await first.done; await leaseExpiry(client, data.request.id);
    const effects = (await readdir(path.join(data.root, "synthetic-effects"))).sort();
    for (let attempt = 0; attempt < 2; attempt++) {
      const recovery = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "writeback:before" });
      await recovery.waitFor("writeback:before"); recovery.stop(); await recovery.done; await leaseExpiry(client, data.request.id);
    }
    const result = await startOperationFixtureAgent(fixture, data.name, data.request.id).done; assert.equal(result.code, 0, result.stderr);
    assert.equal((await getControlledOperationRequest(actor, data.request.id)).status, "SUCCEEDED");
    assert.deepEqual((await readdir(path.join(data.root, "synthetic-effects"))).sort(), effects);
    passed("repeated receipt-only recovery SIGKILL retains durable success and never repeats effects");
  }
  {
    const data = await create("child-lock-inheritance"); const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { effectDelayMs: 3000 });
    await active.waitFor("child:started"); active.stop(); await active.done;
    assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 75);
    await delay(3200); await leaseExpiry(client, data.request.id);
    assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 0);
    assert.equal((await getControlledOperationRequest(actor, data.request.id)).failureCode, "NEEDS_RECONCILIATION");
    assert.equal((await readdir(path.join(data.root, "synthetic-effects"))).filter(name => !name.startsWith(".")).length, 1);
    passed("child inherits all locks after parent SIGKILL; uncertain effect is never repeated");
  }
}
async function leaseExpiry(client: PrismaClient, id: string) {
  const row = await client.controlledOperationRequest.findUniqueOrThrow({ where: { id } });
  await delay(Math.max(0, (row.leaseExpiresAt?.getTime() ?? 0) - Date.now()) + 100);
}
