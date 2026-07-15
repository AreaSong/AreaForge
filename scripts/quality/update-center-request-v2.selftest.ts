import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  UPDATE_REQUEST_CHECK_TTL_MS,
  UPDATE_REQUEST_CLOCK_SKEW_MS,
  UPDATE_REQUEST_MUTATION_TTL_HARD_MAX_MS,
  UPDATE_REQUEST_MUTATION_TTL_MS,
  UpdateRequestV2Error,
  atomicPublishUpdateRequest,
  buildUpdateRequestV2,
  canonicalStringify,
  computeStatusSnapshotHash,
  parseVerifiedStatusSnapshot,
  updateRequestCommandSchema,
  verifyUpdateRequestHashes,
  type UpdateRequestCommand,
  type UpdateRequestV2,
  type UpdateStatusSnapshotV2,
} from "../../apps/web/lib/system/update-request-v2";

const fixedNow = new Date("2026-07-15T08:00:00.000Z");
const currentImage = `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`;
const targetImage = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const rollbackImage = `ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"c".repeat(64)}`;

async function main(): Promise<void> {
  assert(UPDATE_REQUEST_CLOCK_SKEW_MS === 30_000, "clock skew must remain 30 seconds");
  assert(UPDATE_REQUEST_MUTATION_TTL_MS === 300_000, "mutation TTL must remain 5 minutes");
  assert(UPDATE_REQUEST_MUTATION_TTL_HARD_MAX_MS === 600_000, "mutation hard max must remain 10 minutes");
  assert(UPDATE_REQUEST_CHECK_TTL_MS === 900_000, "check TTL must remain 15 minutes");

  testCanonicalJsonAgainstJq();
  const snapshot = testSnapshotHashValidation();
  testStrictApiSchema(snapshot.snapshotHash);
  testRequestHashesAndActions(snapshot);
  await testAtomicPublish(snapshot);
  await testAtomicPublishDoesNotOverwrite(snapshot);
  await testAtomicPublishDirectorySyncUncertain(snapshot);
  await testStatusBindingAndPublicProjection(snapshot);
  console.log("update center request V2 selftest passed.");
}

function testCanonicalJsonAgainstJq(): void {
  const fixtureDir = path.join(process.cwd(), "scripts/quality/fixtures/update-request-v2");
  const value = JSON.parse(readFileSync(path.join(fixtureDir, "canonical-request.json"), "utf8")) as unknown;
  const expected = readFileSync(path.join(fixtureDir, "canonical-request.expected.json"), "utf8").trim();
  const jq = spawnSync("jq", ["-cS", "."], {
    input: JSON.stringify(value),
    encoding: "utf8",
  });
  assert(jq.status === 0, `jq canonicalization failed: ${jq.stderr}`);
  assert(jq.stdout.trim() === expected, "jq canonical JSON must match the checked-in golden fixture");
  assert(canonicalStringify(value) === expected, "Node canonical JSON must match the checked-in golden fixture");
}

function testSnapshotHashValidation(): UpdateStatusSnapshotV2 {
  const unsigned = {
    currentVersion: "0.1.7",
    currentImage,
    autoApply: "none" as const,
    signatureRequired: true,
    verifiedTarget: {
      releaseId: 180018,
      manifestSha256: `sha256:${"d".repeat(64)}`,
      manifestVersion: "0.1.8",
      webImageDigest: targetImage,
    },
    rollback: {
      available: true,
      targetVersion: "0.1.6",
      targetImage: rollbackImage,
      sourceRecordSha256: `sha256:${"e".repeat(64)}`,
    },
  };
  const snapshot: UpdateStatusSnapshotV2 = {
    snapshotSchemaVersion: 2,
    snapshotHash: computeStatusSnapshotHash(unsigned),
    ...unsigned,
  };
  assert(parseVerifiedStatusSnapshot(snapshot)?.snapshotHash === snapshot.snapshotHash, "valid agent snapshot must pass");
  assert(parseVerifiedStatusSnapshot({ ...snapshot, currentVersion: "0.1.6" }) === null, "tampered snapshot must fail");
  assert(parseVerifiedStatusSnapshot({ ...snapshot, unknown: true })?.snapshotHash === snapshot.snapshotHash, "status may retain unrelated public fields");
  return snapshot;
}

function testStrictApiSchema(snapshotHash: string): void {
  const common = { confirmedSnapshotHash: snapshotHash, idempotencyKey: randomUUID() };
  assert(updateRequestCommandSchema.safeParse({ action: "check", ...common }).success, "strict check body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "apply", tag: "v0.1.8", ...common }).success, "strict apply body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "rollback", ...common }).success, "strict rollback body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "set_auto_apply", autoApply: "patch", ...common }).success, "strict policy body must pass");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", tag: "v0.1.8", ...common }).success, "action-foreign field must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", extra: true, ...common }).success, "unknown field must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", confirmedSnapshotHash: snapshotHash, idempotencyKey: "same" }).success, "invalid UUID must fail");
}

function testRequestHashesAndActions(snapshot: UpdateStatusSnapshotV2): void {
  const apply = requestFor({
    action: "apply",
    tag: "v0.1.8",
    confirmedSnapshotHash: snapshot.snapshotHash,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
  }, snapshot, "update_1786780800000_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert(verifyUpdateRequestHashes(apply), "apply hashes must verify");
  assert(apply.actorEmailHash === createHash("sha256").update("owner@example.com").digest("hex"), "actor hash must be redacted and normalized");
  assert(apply.target.releaseId === snapshot.verifiedTarget?.releaseId, "apply must bind verified release identity");
  assert(ttlOf(apply) === UPDATE_REQUEST_MUTATION_TTL_MS, "apply must use 5 minute TTL");
  assertJqHash(apply, "{domain:\"areaforge.update-request.expected-before.v2\",expectedBefore:.expectedBefore}", apply.expectedBeforeHash);
  assertJqHash(apply, "{domain:\"areaforge.update-request.semantic.v2\",action,params,target,expectedBefore}", apply.semanticHash);
  assertJqHash(apply, "{domain:\"areaforge.update-request.v2\",schemaVersion,id,idempotencyKey,action,requestedAt,expiresAt,actorEmailHash,params,target,expectedBefore,expectedBeforeHash,semanticHash}", apply.requestHash);
  assert(Object.keys(apply).sort().join(",") === [
    "action", "actorEmailHash", "expectedBefore", "expectedBeforeHash", "expiresAt", "id", "idempotencyKey",
    "params", "requestHash", "requestedAt", "schemaVersion", "semanticHash", "status", "target",
  ].sort().join(","), "request top-level fields must be exact");

  const check = requestFor(command("check", snapshot.snapshotHash), snapshot);
  assert(ttlOf(check) === UPDATE_REQUEST_CHECK_TTL_MS, "check must use 15 minute TTL");
  assert(Object.values(check.target).every((value) => value === null), "check target must be null projection");

  const rollback = requestFor(command("rollback", snapshot.snapshotHash), snapshot);
  assert(rollback.expectedBefore.rollbackSourceRecordSha256 === snapshot.rollback.sourceRecordSha256, "rollback must bind source record hash");
  assert(Object.values(rollback.target).every((value) => value === null), "rollback release target must remain null");

  const policy = requestFor({
    action: "set_auto_apply",
    autoApply: "patch",
    confirmedSnapshotHash: snapshot.snapshotHash,
    idempotencyKey: randomUUID(),
  }, snapshot);
  assert(policy.params.autoApply === "patch" && policy.params.tag === null, "policy params must be action-discriminated");

  expectCode(() => requestFor(command("check", `sha256:${"f".repeat(64)}`), snapshot), "STATUS_SNAPSHOT_CHANGED");
  expectCode(() => requestFor({
    action: "apply",
    tag: "v0.1.9",
    confirmedSnapshotHash: snapshot.snapshotHash,
    idempotencyKey: randomUUID(),
  }, snapshot), "UPDATE_TARGET_UNVERIFIED");
  expectCode(() => requestFor({
    action: "apply",
    tag: "v0.1.7",
    confirmedSnapshotHash: snapshot.snapshotHash,
    idempotencyKey: randomUUID(),
  }, snapshot), "UPDATE_TARGET_NOT_NEWER");
  expectCode(() => requestFor({
    action: "set_auto_apply",
    autoApply: "none",
    confirmedSnapshotHash: snapshot.snapshotHash,
    idempotencyKey: randomUUID(),
  }, snapshot), "AUTO_APPLY_POLICY_UNCHANGED");
  expectCode(() => requestFor(command("rollback", snapshot.snapshotHash), {
    ...snapshot,
    rollback: { ...snapshot.rollback, sourceRecordSha256: null },
  }), "ROLLBACK_TARGET_UNVERIFIED");
  assert(!verifyUpdateRequestHashes({ ...apply, semanticHash: `sha256:${"0".repeat(64)}` }), "tampered hash must fail");
}

async function testAtomicPublish(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-atomic-"));
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    const publish = await atomicPublishUpdateRequest(tempDir, request);
    const finalPath = publish.path;
    const files = await readdir(tempDir);
    assert(files.join(",") === `${request.id}.json`, "atomic publish must leave only the final request file");
    assert(finalPath === path.join(tempDir, `${request.id}.json`), "published filename must match request id");
    assert(publish.directorySync === "synced", "successful directory fsync must be reported");
    assert((JSON.parse(await readFile(finalPath, "utf8")) as UpdateRequestV2).requestHash === request.requestHash, "published request must be complete");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testAtomicPublishDirectorySyncUncertain(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-fsync-"));
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    const publish = await atomicPublishUpdateRequest(tempDir, request, {
      syncDirectory: async () => {
        throw new Error("injected directory fsync failure");
      },
    });
    assert(publish.directorySync === "uncertain", "post-publish directory fsync failure must be explicit without reporting enqueue failure");
    assert((JSON.parse(await readFile(publish.path, "utf8")) as UpdateRequestV2).requestHash === request.requestHash, "uncertain durability result must still point to the published complete request");
    assert((await readdir(tempDir)).join(",") === `${request.id}.json`, "directory fsync failure must not leave a temporary request");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testAtomicPublishDoesNotOverwrite(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-conflict-"));
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    const finalPath = path.join(tempDir, `${request.id}.json`);
    await writeFile(finalPath, "existing immutable request\n");
    let rejected = false;
    try {
      await atomicPublishUpdateRequest(tempDir, request);
    } catch {
      rejected = true;
    }
    assert(rejected, "atomic publish must reject an existing request id");
    assert(await readFile(finalPath, "utf8") === "existing immutable request\n", "atomic publish must not overwrite an existing request");
    assert((await readdir(tempDir)).join(",") === `${request.id}.json`, "failed atomic publish must remove its temporary file");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testStatusBindingAndPublicProjection(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-status-"));
  process.env.AREAFORGE_OPS_STATE_DIR = stateDir;
  try {
    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({
      ...snapshot,
      latestVersion: "v0.1.8",
      updateAvailable: true,
    }));
    const { createUpdateRequest } = await import("../../apps/web/lib/system/update-center");
    const operation = await createUpdateRequest({
      actorEmail: "owner@example.com",
      command: command("check", snapshot.snapshotHash),
    });
    assert(Object.keys(operation).sort().join(",") === ["action", "finishedAt", "id", "message", "requestedAt", "status"].sort().join(","), "public response must not expose hashes or expected-before");

    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({ currentVersion: "0.1.7", autoApply: "none" }));
    await expectAsyncCode(() => createUpdateRequest({
      actorEmail: "owner@example.com",
      command: {
        action: "apply",
        tag: "v0.1.8",
        confirmedSnapshotHash: snapshot.snapshotHash,
        idempotencyKey: randomUUID(),
      },
    }), "LEGACY_MUTATION_UNBOUND");
  } finally {
    delete process.env.AREAFORGE_OPS_STATE_DIR;
    await rm(stateDir, { recursive: true, force: true });
  }
}

function requestFor(commandValue: UpdateRequestCommand, snapshot: UpdateStatusSnapshotV2, id = `update_${fixedNow.getTime()}_${randomUUID()}`): UpdateRequestV2 {
  return buildUpdateRequestV2({ command: commandValue, actorEmail: "Owner@Example.com", snapshot, now: fixedNow, id });
}

function command(action: "check" | "rollback", snapshotHash: string): UpdateRequestCommand {
  return { action, confirmedSnapshotHash: snapshotHash, idempotencyKey: randomUUID() };
}

function ttlOf(request: UpdateRequestV2): number {
  return Date.parse(request.expiresAt) - Date.parse(request.requestedAt);
}

function assertJqHash(request: UpdateRequestV2, filter: string, expected: string): void {
  const jq = spawnSync("jq", ["-cS", filter], { input: JSON.stringify(request), encoding: "utf8" });
  assert(jq.status === 0, `jq hash projection failed: ${jq.stderr}`);
  const actual = `sha256:${createHash("sha256").update(jq.stdout.trim()).digest("hex")}`;
  assert(actual === expected, `Node hash must match jq projection ${filter}`);
}

function expectCode(run: () => unknown, code: string): void {
  try {
    run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    assert(error instanceof UpdateRequestV2Error && error.code === code, `expected ${code}, got ${String(error)}`);
  }
}

async function expectAsyncCode(run: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await run();
    throw new Error(`expected ${code}`);
  } catch (error) {
    assert(error instanceof UpdateRequestV2Error && error.code === code, `expected ${code}, got ${String(error)}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
