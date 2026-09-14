import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createPrismaClient, prisma, operationContextHash, operationExpectedBeforeHash, type OperationParameters, type PrismaClient } from "../../packages/db/src/index";
import { loadOperationFixture, operationFixtureEnvironment, verifyOperationFixtureLedger, type ControlledOperationFixture } from "./controlled-operation-fixture";
import { prepareOperationCase, publishOperationFixtureContext } from "./controlled-operation-fixture-driver";
import { createOperationFixtureRequest, operationRequestBinding, seedOperationActors } from "./controlled-operation-runtime-data";
import { startOperationFixtureAgent } from "./controlled-operation-process";
import { cancelControlledOperationRequest, createControlledOperationRequest, getControlledOperationRequest, holdControlledOperationRequest, resumeControlledOperationRequest } from "../../apps/web/lib/system/controlled-operation-request-service";
import { readOperationJournal, operationJournalDirectory } from "../../ops/controlled-operation-agent/journal";
import { testOperationRaces } from "./controlled-operation-race-runtime";

async function main() {
  const fixture = loadOperationFixture(process.argv[2] ?? ""); const environment = operationFixtureEnvironment(fixture);
  Object.assign(process.env, environment);
  const client = createPrismaClient(environment.DATABASE_URL); let passed = 0;
  const done = (label: string) => { passed++; console.log(`PASS ${label}`); };
  try {
    assert.equal(await verifyOperationFixtureLedger(client, fixture), 53); done("canonical 53-migration ledger");
    const actors = await seedOperationActors(client, fixture);
    const makeCase = async (name: string, operation?: OperationParameters) => {
      const data = await prepareOperationCase(fixture, `${name}-${randomUUID().slice(0, 8)}`);
      return { ...data, request: await createOperationFixtureRequest(actors.operator, data.context, operation) };
    };
    for (const operation of [{ operation: "CHECK_RELEASE", tag: "v9.9.1" }, { operation: "BACKUP_PREVIEW", scope: "FULL" }, { operation: "DIAGNOSTIC_HEALTH", includeCapacity: true },
      { operation: "APPLY_RELEASE", tag: "v9.9.1" }, { operation: "ROLLBACK_RELEASE", targetVersion: "9.8.9" }, { operation: "MAINTENANCE_HOLD", reasonCode: "RELEASE" }] as OperationParameters[]) {
      const data = await makeCase(operation.operation.toLowerCase().replaceAll("_", "-"), operation);
      const result = await startOperationFixtureAgent(fixture, data.name, data.request.id).done;
      assert.equal(result.code, 0, result.stderr);
      const row = await client.controlledOperationRequest.findUniqueOrThrow({ where: { id: data.request.id } });
      assert.equal(row.status, "SUCCEEDED", result.stderr); assert.equal(row.resultCode, "LOCAL_FIXTURE_COMPLETED");
      if (operation.operation === "BACKUP_PREVIEW") assert.equal((await readdir(path.join(data.root, "synthetic-effects"))).length, 0);
      const before = await effects(data.root);
      assert.equal((await startOperationFixtureAgent(fixture, data.name, row.id).done).code, 0);
      assert.deepEqual(await effects(data.root), before);
      done(`${operation.operation}: root process, durable journal, replay without execution`);
    }
    {
      const data = await makeCase("controls");
      const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started" });
      try {
        await active.waitFor("validation:started");
        assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 75);
        const current = await getControlledOperationRequest(actors.operator, data.request.id);
        const held = await holdControlledOperationRequest(actors.operator, current.id, { ...operationRequestBinding(current), reasonCode: "CAPACITY" });
        assert.equal(held.status, "HELD"); assert.ok(held.workerId); assert.equal(held.holdReasonCode, "CAPACITY");
        await assert.rejects(resumeControlledOperationRequest(actors.operator, current.id, operationRequestBinding(held)));
        active.continue(); assert.equal((await active.done).code, 0);
        const acknowledged = await getControlledOperationRequest(actors.operator, current.id); assert.equal(acknowledged.workerId, null); assert.equal(acknowledged.status, "HELD");
        const resumed = await resumeControlledOperationRequest(actors.operator, current.id, operationRequestBinding(acknowledged)); assert.equal(resumed.status, "QUEUED");
        assert.equal((await startOperationFixtureAgent(fixture, data.name, current.id).done).code, 0);
        assert.equal((await client.controlledOperationRequest.findUniqueOrThrow({ where: { id: current.id } })).status, "SUCCEEDED");
      } finally { active.stop(); await active.done; }
      done("cross-process lock, hold acknowledgement barrier and explicit resume");
    }
    {
      const data = await makeCase("cancel"); const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started" });
      try {
        await active.waitFor("validation:started"); let current = await getControlledOperationRequest(actors.operator, data.request.id);
        current = await cancelControlledOperationRequest(actors.operator, current.id, operationRequestBinding(current));
        current = await cancelControlledOperationRequest(actors.operator, current.id, operationRequestBinding(current));
        assert.equal(current.status, "CANCEL_REQUESTED"); assert.ok(current.workerId);
        active.continue(); assert.equal((await active.done).code, 0);
        assert.equal((await getControlledOperationRequest(actors.operator, current.id)).status, "CANCELLED"); assert.equal((await effects(data.root)).length, 0);
      } finally { active.stop(); await active.done; }
      done("repeated cancellation preserves lease until confirmed stop");
    }
    {
      const data = await makeCase("second-guard"); const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started" });
      try {
        await active.waitFor("validation:started"); const context = structuredClone(data.context); context.expectedBefore.autoApply = "patch"; context.snapshotHash = operationContextHash(context);
        await writeFile(path.join(data.root, "live-context.json"), JSON.stringify(context), { mode: 0o600 });
        active.continue(); assert.equal((await active.done).code, 0);
        assert.equal((await getControlledOperationRequest(actors.operator, data.request.id)).failureCode, "EXPECTED_BEFORE_CHANGED"); assert.equal((await effects(data.root)).length, 0);
      } finally { active.stop(); await active.done; }
      done("second expected-before comparison rejects live drift with zero effects");
    }
    {
      const data = await makeCase("operator-revoked"); const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "validation:started" });
      try {
        await active.waitFor("validation:started"); await client.user.update({ where: { id: actors.operator.id }, data: { status: "SUSPENDED" } });
        active.continue(); assert.equal((await active.done).code, 0); assert.equal((await effects(data.root)).length, 0);
        assert.notEqual((await client.controlledOperationRequest.findUniqueOrThrow({ where: { id: data.request.id } })).status, "SUCCEEDED");
      } finally { active.stop(); await active.done; await client.user.update({ where: { id: actors.operator.id }, data: { status: "ACTIVE" } }); }
      done("actual operator suspension fences execution");
    }
    for (const point of ["admission:complete", "validation:started", "backup:started", "backup:effect", "prepare:effect", "migration:started", "migration:effect", "switch:started", "switch:effect", "health:started", "smoke:started", "terminal:durable"]) {
      const data = await makeCase(`kill-${point.replace(":", "-")}`);
      const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: point });
      await active.waitFor(point); active.stop(); assert.equal((await active.done).signal, "SIGKILL");
      const before = await effects(data.root); await waitLease(client, data.request.id);
      const result = await startOperationFixtureAgent(fixture, data.name, data.request.id).done; assert.equal(result.code, 0, result.stderr);
      const row = await client.controlledOperationRequest.findUniqueOrThrow({ where: { id: data.request.id } });
      const safeBefore = ["admission:complete", "validation:started"].includes(point);
      assert.equal(row.status, safeBefore || point === "terminal:durable" ? "SUCCEEDED" : "FAILED");
      if (!safeBefore) assert.deepEqual(await effects(data.root), before);
      if (!safeBefore && point !== "terminal:durable") assert.equal(row.failureCode, "NEEDS_RECONCILIATION");
      done(`real SIGKILL ${point}: durable recovery / no uncertain replay`);
    }
    for (const scenario of [{ operation: { operation: "ROLLBACK_RELEASE", targetVersion: "9.8.9" }, point: "rollback:effect" },
      { operation: { operation: "MAINTENANCE_HOLD", reasonCode: "INCIDENT" }, point: "maintenance:effect" }] as { operation: OperationParameters; point: string }[]) {
      const data = await makeCase(`kill-${scenario.point.replace(":", "-")}`, scenario.operation);
      const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: scenario.point });
      await active.waitFor(scenario.point); active.stop(); await active.done;
      const before = await effects(data.root); await waitLease(client, data.request.id);
      assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 0);
      assert.deepEqual(await effects(data.root), before);
      assert.equal((await getControlledOperationRequest(actors.operator, data.request.id)).failureCode, "NEEDS_RECONCILIATION");
      done(`real SIGKILL ${scenario.point}: fixed action is not repeated`);
    }
    {
      const data = await makeCase("db-writeback"); const active = startOperationFixtureAgent(fixture, data.name, data.request.id, { pauseAt: "writeback:before" });
      const blocker = createPrismaClient(environment.DATABASE_URL);
      let blocking: Promise<void> | undefined;
      try {
        await active.waitFor("writeback:before");
        let acquired!: () => void; const locked = new Promise<void>(resolve => { acquired = resolve; });
        blocking = blocker.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "ControlledOperationRequest" WHERE id=${data.request.id} FOR UPDATE`;
          acquired(); await delay(6500);
        }, { timeout: 15_000 });
        await locked;
        active.continue(); const result = await active.done; assert.equal(result.code, 1);
        await blocking; const before = await effects(data.root); await waitLease(client, data.request.id);
        const recovery = await startOperationFixtureAgent(fixture, data.name, data.request.id).done; assert.equal(recovery.code, 0, recovery.stderr);
        assert.deepEqual(await effects(data.root), before); assert.equal((await getControlledOperationRequest(actors.operator, data.request.id)).status, "SUCCEEDED");
      } finally { active.stop(); await active.done; await blocking; await blocker.$disconnect(); }
      done("real database writeback timeout: replay receipt only, not effects");
    }
    {
      const data = await makeCase("tampered"); assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 0);
      const directory = operationJournalDirectory(data.root, data.request.requestHash); const journal = await readOperationJournal(directory);
      const before = await effects(data.root); await unlink(path.join(directory, `${String(journal.length).padStart(6, "0")}.json`));
      assert.equal((await startOperationFixtureAgent(fixture, data.name, data.request.id).done).code, 1); assert.deepEqual(await effects(data.root), before);
      done("journal tail truncation rejected against database projection anchor");
    }
    {
      const data = await makeCase("disabled"); const result = await startOperationFixtureAgent(fixture, data.name, data.request.id, { enabled: false }).done;
      assert.equal(result.code, 1); assert.equal((await client.controlledOperationRequest.findUniqueOrThrow({ where: { id: data.request.id } })).status, "QUEUED");
      await publishOperationFixtureContext(fixture, data.context);
      await assert.rejects(createControlledOperationRequest(actors.member, { operation: { operation: "DIAGNOSTIC_HEALTH", includeCapacity: false }, expectedBeforeHash: operationExpectedBeforeHash(data.context.expectedBefore), executionSnapshotHash: data.context.snapshotHash, idempotencyKey: randomUUID(), requestedReason: "not operator" }));
      done("default-off entry and Workspace owner cannot become platform Operator");
    }
    await testOperationRaces(client, fixture, actors.operator, done);
    console.log(JSON.stringify({ passed, migrations: 53, environment: "local_fixture", productionTouched: false }));
  } finally { await client.$disconnect(); await prisma.$disconnect(); }
}
async function effects(root: string) { return (await readdir(path.join(root, "synthetic-effects"))).filter(name => !name.startsWith(".")).sort(); }
async function waitLease(client: PrismaClient, id: string) {
  const row = await client.controlledOperationRequest.findUniqueOrThrow({ where: { id } });
  await delay(Math.max(0, (row.leaseExpiresAt?.getTime() ?? 0) - Date.now()) + 100);
}
main().catch(error => { console.error(error instanceof Error ? error.stack : "OPS_RUNTIME_FAILED"); process.exitCode = 1; });
