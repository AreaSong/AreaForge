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
import {
  getUpdateCenterHealth,
  UPDATE_CENTER_STATUS_FRESHNESS_MS,
} from "../../apps/web/lib/system/update-center-health";
import {
  acknowledgeUpdateRequestIdempotencyKey,
  bindUpdateRequestIdempotencyRequest,
  buildUpdateRequestIdempotencyIntent,
  reuseUpdateRequestIdempotencyKey,
  settleUpdateRequestIdempotencyFromOperation,
  shouldAcknowledgeUpdateRequestAttempt,
  type UpdateRequestIdempotencyStorage,
} from "../../apps/web/lib/system/update-request-idempotency";

const fixedNow = new Date("2026-07-15T08:00:00.000Z");
const currentImage = `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}`;
const targetImage = `ghcr.io/areasong/areaforge-web:v0.1.8@sha256:${"b".repeat(64)}`;
const rollbackImage = `ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"c".repeat(64)}`;

async function main(): Promise<void> {
  assert(UPDATE_REQUEST_CLOCK_SKEW_MS === 30_000, "clock skew must remain 30 seconds");
  assert(UPDATE_REQUEST_MUTATION_TTL_MS === 300_000, "mutation TTL must remain 5 minutes");
  assert(UPDATE_REQUEST_MUTATION_TTL_HARD_MAX_MS === 600_000, "mutation hard max must remain 10 minutes");
  assert(UPDATE_REQUEST_CHECK_TTL_MS === 900_000, "check TTL must remain 15 minutes");

  testClientIdempotencyRetry();
  testCanonicalJsonAgainstJq();
  const snapshot = testSnapshotHashValidation();
  testUpdateCenterHealthProjection(snapshot);
  testStrictApiSchema(snapshot.snapshotHash);
  testRequestHashesAndActions(snapshot);
  testSemanticHashIdentity(snapshot);
  await testAtomicPublish(snapshot);
  await testAtomicPublishDoesNotOverwrite(snapshot);
  await testConcurrentAtomicPublish(snapshot);
  await testAtomicPublishFileSyncFailure(snapshot);
  await testAtomicPublishDirectorySyncUncertain(snapshot);
  await testAtomicPublishDirectoryCreationSync(snapshot);
  await testAtomicPublishTemporaryCleanupUncertain(snapshot);
  await testStatusBindingAndPublicProjection(snapshot);
  console.log("update center request V2 selftest passed.");
}

function testClientIdempotencyRetry(): void {
  const storage = createMemoryStorage();
  const pending = new Map<string, string>();
  let generated = 0;
  const createKey = () => `key-${++generated}`;

  const first = reuseUpdateRequestIdempotencyKey(pending, "apply:snapshot-a", createKey, storage);
  const retry = reuseUpdateRequestIdempotencyKey(pending, "apply:snapshot-a", createKey, storage);
  assert(first === retry, "network-uncertain retry must reuse the same idempotency key");

  const remountedPending = new Map<string, string>();
  const remountedRetry = reuseUpdateRequestIdempotencyKey(remountedPending, "apply:snapshot-a", createKey, storage);
  assert(remountedRetry === first, "component remounts must reuse the session idempotency key");

  acknowledgeUpdateRequestIdempotencyKey(remountedPending, "apply:snapshot-a", first, storage);
  const afterResponse = reuseUpdateRequestIdempotencyKey(remountedPending, "apply:snapshot-a", createKey, storage);
  assert(afterResponse !== first, "a durable response must close the prior idempotency attempt");

  const responseBody = (publishDurability: "synced" | "uncertain") => ({
    request: {
      id: "update-response",
      action: "apply",
      status: "queued",
      requestedAt: fixedNow.toISOString(),
      publishDurability,
    },
  });
  assert(!shouldAcknowledgeUpdateRequestAttempt({ responseOk: true, responseStatus: 202, responseBody: responseBody("uncertain") }), "directory durability uncertainty must retain the retry key");
  assert(!shouldAcknowledgeUpdateRequestAttempt({ responseOk: false, responseStatus: 503, responseBody: { error: "INTERNAL_ERROR" } }), "server-side uncertainty must retain the retry key");
  assert(!shouldAcknowledgeUpdateRequestAttempt({ responseOk: false, responseStatus: 429, responseBody: { error: "RATE_LIMITED" } }), "rate limiting must retain the retry key");
  assert(shouldAcknowledgeUpdateRequestAttempt({ responseOk: true, responseStatus: 202, responseBody: responseBody("synced") }), "durable publication must close the retry key");
  assert(shouldAcknowledgeUpdateRequestAttempt({ responseOk: false, responseStatus: 409, responseBody: { error: "STATUS_SNAPSHOT_CHANGED" } }), "deterministic client conflicts must close the stale retry key");
  assert(!shouldAcknowledgeUpdateRequestAttempt({ responseOk: false, responseStatus: 409, responseBody: null }), "an invalid conflict response must retain the retry key");
  assert(!shouldAcknowledgeUpdateRequestAttempt({ responseOk: false, responseStatus: 0, responseBody: null }), "an opaque or missing response must retain the retry key");
  assert(!shouldAcknowledgeUpdateRequestAttempt({ responseOk: true, responseStatus: 202, responseBody: { request: { publishDurability: "synced" } } }), "an incomplete success response must retain the retry key");

  const otherEntryPending = new Map<string, string>();
  const crossEntryRetry = reuseUpdateRequestIdempotencyKey(otherEntryPending, "apply:snapshot-a", createKey, storage);
  assert(crossEntryRetry === afterResponse, "separate update center entries must share the uncertain retry key");

  const changedIntent = reuseUpdateRequestIdempotencyKey(remountedPending, "apply:snapshot-b", createKey, storage);
  assert(changedIntent !== afterResponse, "a changed confirmed intent must receive a new idempotency key");
  assert(remountedPending.size === 2, "independent uncertain request intents must not overwrite each other");
  assert(reuseUpdateRequestIdempotencyKey(new Map(), "apply:snapshot-a", createKey, storage) === afterResponse, "switching intents must preserve the earlier uncertain key");

  const popoverIntent = buildUpdateRequestIdempotencyIntent({
    action: "apply",
    tag: "v0.1.8",
    confirmedSnapshotHash: "sha256:snapshot-a",
  });
  const settingsIntent = buildUpdateRequestIdempotencyIntent({
    action: "apply",
    tag: "v0.1.8",
    autoApply: "patch",
    confirmedSnapshotHash: "sha256:snapshot-a",
  });
  assert(popoverIntent === settingsIntent, "the same apply intent must be identical across update center entries");

  const rejectingStorage: UpdateRequestIdempotencyStorage = {
    getItem: () => null,
    removeItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
  const fallbackPending = new Map<string, string>();
  const fallbackFirst = reuseUpdateRequestIdempotencyKey(fallbackPending, popoverIntent, createKey, rejectingStorage);
  const fallbackRetry = reuseUpdateRequestIdempotencyKey(fallbackPending, popoverIntent, createKey, rejectingStorage);
  assert(fallbackRetry === fallbackFirst, "storage write failures must retain the uncertain retry key in memory");

  const competingStorage = createMemoryStorage();
  const uncertainPending = new Map([[popoverIntent, "uncertain-key"]]);
  competingStorage.setItem("areaforge.update-request.pending.v2", JSON.stringify({
    entries: [{ intent: popoverIntent, key: "newer-key" }],
  }));
  assert(
    reuseUpdateRequestIdempotencyKey(uncertainPending, popoverIntent, createKey, competingStorage) === "uncertain-key",
    "a component-local uncertain attempt must keep its original key when another entry changes shared storage",
  );
  acknowledgeUpdateRequestIdempotencyKey(uncertainPending, popoverIntent, "uncertain-key", competingStorage);
  assert(
    JSON.parse(competingStorage.getItem("areaforge.update-request.pending.v2") ?? "{}")?.entries?.[0]?.key === "newer-key",
    "acknowledging one attempt must not delete a different key published by another update center entry",
  );

  const legacyStorage = createMemoryStorage();
  legacyStorage.setItem("areaforge.update-request.pending.v2", JSON.stringify({ intent: popoverIntent, key: "legacy-key" }));
  assert(reuseUpdateRequestIdempotencyKey(new Map(), popoverIntent, createKey, legacyStorage) === "legacy-key", "single-entry session storage must remain readable during the V2 collection transition");

  const terminalStorage = createMemoryStorage();
  const terminalPending = new Map<string, string>();
  const terminalKey = reuseUpdateRequestIdempotencyKey(terminalPending, popoverIntent, createKey, terminalStorage, fixedNow.getTime());
  bindUpdateRequestIdempotencyRequest(popoverIntent, terminalKey, "update-terminal", terminalStorage, fixedNow.getTime());
  settleUpdateRequestIdempotencyFromOperation(
    terminalPending,
    { id: "update-terminal", status: "succeeded" },
    terminalStorage,
    fixedNow.getTime() + 1,
  );
  assert(
    reuseUpdateRequestIdempotencyKey(terminalPending, popoverIntent, createKey, terminalStorage, fixedNow.getTime() + 2) !== terminalKey,
    "a terminal status for the bound request must close an uncertain idempotency attempt",
  );

  const lostResponseStorage = createMemoryStorage();
  const lostResponsePending = new Map<string, string>();
  const lostResponseKey = reuseUpdateRequestIdempotencyKey(lostResponsePending, popoverIntent, createKey, lostResponseStorage, fixedNow.getTime());
  assert(
    reuseUpdateRequestIdempotencyKey(lostResponsePending, popoverIntent, createKey, lostResponseStorage, fixedNow.getTime() + UPDATE_REQUEST_MUTATION_TTL_MS + UPDATE_REQUEST_CLOCK_SKEW_MS + 1) !== lostResponseKey,
    "an attempt without a response must expire after the generated mutation TTL and clock-skew window",
  );

  const checkIntent = buildUpdateRequestIdempotencyIntent({ action: "check", confirmedSnapshotHash: "sha256:snapshot-a" });
  const lostCheckPending = new Map<string, string>();
  const lostCheckKey = reuseUpdateRequestIdempotencyKey(lostCheckPending, checkIntent, createKey, lostResponseStorage, fixedNow.getTime());
  assert(
    reuseUpdateRequestIdempotencyKey(lostCheckPending, checkIntent, createKey, lostResponseStorage, fixedNow.getTime() + UPDATE_REQUEST_CHECK_TTL_MS + UPDATE_REQUEST_CLOCK_SKEW_MS + 1) !== lostCheckKey,
    "an uncertain check must not pin one historical idempotency decision forever",
  );
}

function createMemoryStorage(): UpdateRequestIdempotencyStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function testUpdateCenterHealthProjection(snapshot: UpdateStatusSnapshotV2): void {
  const base = {
    currentVersion: snapshot.currentVersion,
    currentImage: snapshot.currentImage,
    appUrl: null,
    deployMode: "unknown" as const,
    releaseUrl: null,
    latestVersion: null,
    latestPublishedAt: null,
    updateAvailable: false,
    autoApply: snapshot.autoApply,
    signatureRequired: snapshot.signatureRequired,
    timerEnabled: null,
    timerActive: null,
    lastCheckedAt: null,
    lastOperation: null,
    rollback: snapshot.rollback,
    blocker: null,
    requestQueueLength: null,
    statusUpdatedAt: null,
    snapshotSchemaVersion: null,
    snapshotHash: null,
    verifiedTarget: null,
  };
  const now = fixedNow.getTime();
  const verified = { ...base, snapshotSchemaVersion: 2, snapshotHash: snapshot.snapshotHash };
  assert(getUpdateCenterHealth(base, now) === "unknown", "missing V2 status snapshot must remain unknown");
  assert(getUpdateCenterHealth({ ...verified, statusUpdatedAt: fixedNow.toISOString() }, now) === "healthy", "verified stable status must be healthy");
  assert(getUpdateCenterHealth({ ...verified, statusUpdatedAt: fixedNow.toISOString(), updateAvailable: true }, now) === "update_available", "verified update must be update_available");
  assert(getUpdateCenterHealth({
    ...verified,
    statusUpdatedAt: fixedNow.toISOString(),
    lastOperation: {
      id: "update_reconciliation",
      action: "apply",
      status: "needs_reconciliation",
      requestedAt: fixedNow.toISOString(),
      finishedAt: fixedNow.toISOString(),
      message: "manual reconciliation required",
    },
  }, now) === "blocked", "reconciliation state must block further mutations");
  assert(getUpdateCenterHealth({ ...verified, statusUpdatedAt: new Date(now - UPDATE_CENTER_STATUS_FRESHNESS_MS - 1).toISOString() }, now) === "stale", "old verified status must be stale");
  assert(getUpdateCenterHealth({ ...verified, statusUpdatedAt: "not-a-date" }, now) === "unknown", "invalid status timestamp must remain unknown");
  assert(getUpdateCenterHealth({ ...verified, statusUpdatedAt: new Date(now + 30_001).toISOString() }, now) === "unknown", "future status timestamp must remain unknown");
  assert(getUpdateCenterHealth({ ...base, blocker: "agent unavailable" }, now) === "blocked", "blocker must take priority over health state");
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
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, { currentVersion: "release-0.1.7" })) === null, "malformed current version must fail before enqueue");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, { currentImage: `registry.example/areaforge:v0.1.7@sha256:${"a".repeat(64)}` })) === null, "non-GHCR current image must fail before enqueue");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, { currentImage: `ghcr.io/${"a".repeat(430)}/areaforge-web:v0.1.7@sha256:${"a".repeat(64)}` })) === null, "oversized current image must fail before enqueue and stay aligned with the root schema");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, { currentImage: `ghcr.io/areasong/areaforge-web:v0.1.6@sha256:${"a".repeat(64)}` })) === null, "current image tag must match the current version");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    verifiedTarget: snapshot.verifiedTarget ? { ...snapshot.verifiedTarget, manifestVersion: "release-0.1.8" } : null,
  })) === null, "malformed manifest version must fail before enqueue");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    verifiedTarget: snapshot.verifiedTarget ? { ...snapshot.verifiedTarget, webImageDigest: `registry.example/areaforge:v0.1.8@sha256:${"b".repeat(64)}` } : null,
  })) === null, "non-GHCR target image must fail before enqueue");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    verifiedTarget: snapshot.verifiedTarget ? { ...snapshot.verifiedTarget, webImageDigest: `ghcr.io/areasong/areaforge-web:v0.1.9@sha256:${"b".repeat(64)}` } : null,
  })) === null, "target image tag must match the verified manifest version");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    rollback: { ...snapshot.rollback, targetImage: `registry.example/areaforge:v0.1.6@sha256:${"c".repeat(64)}` },
  })) === null, "non-GHCR rollback image must fail before enqueue");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    rollback: { ...snapshot.rollback, targetImage: `ghcr.io/areasong/areaforge-web:v0.1.5@sha256:${"c".repeat(64)}` },
  })) === null, "rollback image tag must match the rollback target version");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    rollback: { ...snapshot.rollback, available: false },
  })) === null, "rollback availability must agree with complete target evidence");
  assert(parseVerifiedStatusSnapshot(resignSnapshot(snapshot, {
    rollback: { available: true, targetVersion: null, targetImage: null, sourceRecordSha256: null },
  })) === null, "available rollback must include all target evidence");
  return snapshot;
}

function resignSnapshot(
  snapshot: UpdateStatusSnapshotV2,
  override: Partial<Omit<UpdateStatusSnapshotV2, "snapshotSchemaVersion" | "snapshotHash">>,
): UpdateStatusSnapshotV2 {
  const unsigned = {
    currentVersion: override.currentVersion ?? snapshot.currentVersion,
    currentImage: override.currentImage ?? snapshot.currentImage,
    autoApply: override.autoApply ?? snapshot.autoApply,
    signatureRequired: override.signatureRequired ?? snapshot.signatureRequired,
    verifiedTarget: override.verifiedTarget ?? snapshot.verifiedTarget,
    rollback: override.rollback ?? snapshot.rollback,
  };
  return {
    snapshotSchemaVersion: 2,
    snapshotHash: computeStatusSnapshotHash(unsigned),
    ...unsigned,
  };
}

function testStrictApiSchema(snapshotHash: string): void {
  const common = { confirmedSnapshotHash: snapshotHash, idempotencyKey: randomUUID() };
  assert(updateRequestCommandSchema.safeParse({ action: "check", ...common }).success, "strict check body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "check", idempotencyKey: randomUUID() }).success, "snapshot-less check fallback body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "apply", tag: "v0.1.8", ...common }).success, "strict apply body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "rollback", ...common }).success, "strict rollback body must pass");
  assert(updateRequestCommandSchema.safeParse({ action: "set_auto_apply", autoApply: "patch", ...common }).success, "strict policy body must pass");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", tag: "v0.1.8", ...common }).success, "action-foreign field must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", extra: true, ...common }).success, "unknown field must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", confirmedSnapshotHash: snapshotHash, idempotencyKey: "same" }).success, "invalid UUID must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", confirmedSnapshotHash: snapshotHash, idempotencyKey: "00000000-0000-0000-0000-000000000000" }).success, "nil UUID must fail downstream-compatible validation");
  assert(!updateRequestCommandSchema.safeParse({ action: "check", confirmedSnapshotHash: snapshotHash, idempotencyKey: ["018f4f8e", "7f31", "7cc2", "8e42", "5a7c556b7e13"].join("-") }).success, "UUID versions newer than the updater contract must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "apply", tag: "v0.1.8-rc.1", ...common }).success, "release tags outside the stable workflow contract must fail");
  assert(!updateRequestCommandSchema.safeParse({ action: "set_auto_apply", autoApply: "minor", ...common }).success, "minor auto policy must remain closed");
  assert(!updateRequestCommandSchema.safeParse({ action: "set_auto_apply", autoApply: "all", ...common }).success, "all auto policy must remain closed");
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
  assertJqHash(apply, "{domain:\"areaforge.update-request.v2\",schemaVersion,id,idempotencyKey,action,status,requestedAt,expiresAt,actorEmailHash,params,target,expectedBefore,expectedBeforeHash,semanticHash}", apply.requestHash);
  assert(Object.keys(apply).sort().join(",") === [
    "action", "actorEmailHash", "expectedBefore", "expectedBeforeHash", "expiresAt", "id", "idempotencyKey",
    "params", "requestHash", "requestedAt", "schemaVersion", "semanticHash", "status", "target",
  ].sort().join(","), "request top-level fields must be exact");

  const check = requestFor(command("check", snapshot.snapshotHash), snapshot);
  assert(ttlOf(check) === UPDATE_REQUEST_CHECK_TTL_MS, "check must use 15 minute TTL");
  assert(Object.values(check.target).every((value) => value === null), "check target must be null projection");
  const snapshotLessV2Check = requestFor({ action: "check", idempotencyKey: randomUUID() }, snapshot);
  assert(verifyUpdateRequestHashes(snapshotLessV2Check), "read-only V2 check may omit a confirmed snapshot hash");

  const rollback = requestFor(command("rollback", snapshot.snapshotHash), snapshot);
  assert(rollback.expectedBefore.rollbackAvailable === true, "rollback must bind availability as well as target evidence");
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
  assert(!verifyUpdateRequestHashes({ ...apply, params: { ...apply.params, tag: "v0.1.9" } }), "tampered params must fail");
  assert(!verifyUpdateRequestHashes({ ...apply, target: { ...apply.target, releaseId: 180019 } }), "tampered target must fail");
  assert(!verifyUpdateRequestHashes({ ...apply, expectedBefore: { ...apply.expectedBefore, autoApply: "patch" } }), "tampered expected-before must fail");
  assert(!verifyUpdateRequestHashes({ ...apply, actorEmailHash: "0".repeat(64) }), "tampered envelope must fail");
  assert(!verifyUpdateRequestHashes({ ...apply, status: "running" as never }), "tampered request status must fail the immutable envelope hash");
}

function testSemanticHashIdentity(snapshot: UpdateStatusSnapshotV2): void {
  const commandValue: UpdateRequestCommand = {
    action: "apply",
    tag: "v0.1.8",
    confirmedSnapshotHash: snapshot.snapshotHash,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  };
  const first = buildUpdateRequestV2({
    command: commandValue,
    actorEmail: "first@example.com",
    snapshot,
    now: fixedNow,
    id: "update_1786780800000_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  const second = buildUpdateRequestV2({
    command: { ...commandValue, idempotencyKey: "33333333-3333-4333-8333-333333333333" },
    actorEmail: "second@example.com",
    snapshot,
    now: new Date(fixedNow.getTime() + 1_000),
    id: "update_1786780801000_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  assert(first.semanticHash === second.semanticHash, "semantic hash must exclude request identity, actor, time, and idempotency key");
  assert(first.requestHash !== second.requestHash, "request hash must bind the immutable request envelope");

  const changed = buildUpdateRequestV2({
    command: { ...commandValue, tag: "v0.1.9" },
    actorEmail: "first@example.com",
    snapshot: {
      ...snapshot,
      verifiedTarget: snapshot.verifiedTarget ? { ...snapshot.verifiedTarget, manifestVersion: "0.1.9" } : null,
    },
    now: fixedNow,
  });
  assert(first.semanticHash !== changed.semanticHash, "semantic changes must produce a different semantic hash");
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

async function testAtomicPublishDirectoryCreationSync(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-directory-create-"));
  const requestsDir = path.join(tempDir, "state", "requests");
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    const syncedDirectories: string[] = [];
    const publish = await atomicPublishUpdateRequest(requestsDir, request, {
      syncDirectory: async (directory) => {
        syncedDirectories.push(directory);
      },
    });
    assert(publish.directorySync === "synced", "new request directories may report synced only after their parent chain is synchronized");
    assert(syncedDirectories[0] === requestsDir, "the request directory must be synchronized before its parent chain");
    assert(syncedDirectories.includes(path.join(tempDir, "state")) && syncedDirectories.includes(tempDir), "recursive directory creation must synchronize every new parent entry through the existing ancestor");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testAtomicPublishTemporaryCleanupUncertain(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-temp-cleanup-"));
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    const publish = await atomicPublishUpdateRequest(tempDir, request, {
      unlinkTemporary: async () => {
        throw new Error("injected temporary unlink failure");
      },
    });
    const files = await readdir(tempDir);
    assert(publish.directorySync === "uncertain", "temporary link cleanup failure must not overstate publication durability");
    assert(files.includes(`${request.id}.json`), "temporary cleanup uncertainty must preserve the complete final request");
    assert(files.some((file) => file.startsWith(`.${request.id}.`) && file.endsWith(".tmp")), "persistent cleanup failure must remain visible as a hidden temporary link");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testAtomicPublishFileSyncFailure(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-file-fsync-"));
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    let rejected = false;
    try {
      await atomicPublishUpdateRequest(tempDir, request, {
        syncFile: async () => {
          throw new Error("injected file fsync failure");
        },
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "pre-publish file fsync failure must reject the request");
    assert((await readdir(tempDir)).length === 0, "file fsync failure must not publish or retain a temporary request");
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

async function testConcurrentAtomicPublish(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-race-"));
  try {
    const request = requestFor(command("check", snapshot.snapshotHash), snapshot);
    const results = await Promise.allSettled([
      atomicPublishUpdateRequest(tempDir, request),
      atomicPublishUpdateRequest(tempDir, request),
    ]);
    assert(results.filter((result) => result.status === "fulfilled").length === 1, "concurrent publishers must produce exactly one winner");
    assert(results.filter((result) => result.status === "rejected").length === 1, "concurrent duplicate publish must fail closed");
    const finalPath = path.join(tempDir, `${request.id}.json`);
    assert((JSON.parse(await readFile(finalPath, "utf8")) as UpdateRequestV2).requestHash === request.requestHash, "concurrent publish winner must leave one complete request");
    assert((await readdir(tempDir)).join(",") === `${request.id}.json`, "concurrent publish must not leave temporary files");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function testStatusBindingAndPublicProjection(snapshot: UpdateStatusSnapshotV2): Promise<void> {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "areaforge-update-v2-status-"));
  process.env.AREAFORGE_OPS_STATE_DIR = stateDir;
  process.env.AREAFORGE_IMAGE = currentImage;
  try {
    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({
      ...snapshot,
      latestVersion: "v0.1.8",
      updateAvailable: true,
      blocker: "signature verification is not enabled",
      statusUpdatedAt: new Date().toISOString(),
    }));
    const { createUpdateRequest } = await import("../../apps/web/lib/system/update-center");
    const operation = await createUpdateRequest({
      actorEmail: "owner@example.com",
      command: command("check", snapshot.snapshotHash),
    });
    assert(Object.keys(operation).sort().join(",") === ["action", "finishedAt", "id", "message", "publishDurability", "requestedAt", "status"].sort().join(","), "public response must expose only safe operation and durability fields");
    assert(operation.publishDurability === "synced", "successful publication must report synced durability");

    for (const commandValue of [
      { action: "apply", tag: "v0.1.8", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
      { action: "rollback", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
      { action: "set_auto_apply", autoApply: "patch", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
    ] satisfies UpdateRequestCommand[]) {
      await expectAsyncCode(() => createUpdateRequest({ actorEmail: "owner@example.com", command: commandValue }), "UPDATE_BLOCKED");
    }

    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({
      ...snapshot,
      blocker: null,
      lastOperation: {
        id: "update_reconciliation_fixture",
        action: "apply",
        status: "needs_reconciliation",
        requestedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        message: "manual reconciliation required",
      },
      statusUpdatedAt: new Date().toISOString(),
    }));
    await expectAsyncCode(() => createUpdateRequest({
      actorEmail: "owner@example.com",
      command: { action: "apply", tag: "v0.1.8", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
    }), "UPDATE_BLOCKED");
    assert((await readdir(path.join(stateDir, "requests"))).length === 1, "reconciliation-blocked mutation must not publish a request");

    const nullableUnsigned = {
      currentVersion: snapshot.currentVersion,
      currentImage: null,
      autoApply: snapshot.autoApply,
      signatureRequired: snapshot.signatureRequired,
      verifiedTarget: snapshot.verifiedTarget,
      rollback: {
        available: false,
        targetVersion: null,
        targetImage: null,
        sourceRecordSha256: null,
      },
    };
    const nullableSnapshot: UpdateStatusSnapshotV2 = {
      snapshotSchemaVersion: 2,
      snapshotHash: computeStatusSnapshotHash(nullableUnsigned),
      ...nullableUnsigned,
    };
    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({
      ...nullableSnapshot,
      currentImage: null,
      rollback: {
        ...nullableSnapshot.rollback,
        targetVersion: null,
        targetImage: null,
      },
      statusUpdatedAt: new Date().toISOString(),
    }));
    await createUpdateRequest({
      actorEmail: "owner@example.com",
      command: command("check", nullableSnapshot.snapshotHash),
    });
    const nullableFiles = await readdir(path.join(stateDir, "requests"));
    const nullableRequest = await readPublishedNullableRequest(stateDir, nullableFiles);
    assert(nullableRequest.expectedBefore.currentImage === null, "verified null current image must not fall back to the Web environment");
    assert(nullableRequest.expectedBefore.rollbackAvailable === false, "unavailable rollback must remain explicitly bound");
    assert(nullableRequest.expectedBefore.rollbackTargetVersion === null, "verified null rollback version must not fall back to stale status fields");
    assert(nullableRequest.expectedBefore.rollbackTargetImage === null, "verified null rollback image must not fall back to stale status fields");

    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({
      ...snapshot,
      statusUpdatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }));
    await expectAsyncCode(() => createUpdateRequest({
      actorEmail: "owner@example.com",
      command: { action: "apply", tag: "v0.1.8", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
    }), "STATUS_SNAPSHOT_INVALID");
    assert((await readdir(path.join(stateDir, "requests"))).length === 2, "stale mutation must not publish a request");

    await writeFile(path.join(stateDir, "status.json"), JSON.stringify({ currentVersion: "0.1.7", autoApply: "none" }));
    const fallbackCheck = await createUpdateRequest({
      actorEmail: "owner@example.com",
      command: { action: "check", idempotencyKey: randomUUID() },
    });
    assert(fallbackCheck.action === "check" && fallbackCheck.status === "queued", "invalid V2 status must still allow read-only check recovery");
    const fallbackFiles = await readdir(path.join(stateDir, "requests"));
    assert(fallbackFiles.length === 3, "snapshot-less check must add exactly one legacy request");
    const fallbackRequest = await readPublishedRequest(stateDir, fallbackFiles, 1);
    assert(fallbackRequest.schemaVersion === 1 && fallbackRequest.action === "check", "snapshot-less recovery must use legacy check only");
    for (const commandValue of [
      { action: "apply", tag: "v0.1.8", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
      { action: "rollback", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
      { action: "set_auto_apply", autoApply: "patch", confirmedSnapshotHash: snapshot.snapshotHash, idempotencyKey: randomUUID() },
    ] satisfies UpdateRequestCommand[]) {
      await expectAsyncCode(() => createUpdateRequest({
        actorEmail: "owner@example.com",
        command: commandValue,
      }), "LEGACY_MUTATION_UNBOUND");
    }
  } finally {
    delete process.env.AREAFORGE_OPS_STATE_DIR;
    delete process.env.AREAFORGE_IMAGE;
    await rm(stateDir, { recursive: true, force: true });
  }
}

async function readPublishedNullableRequest(
  stateDir: string,
  files: string[],
): Promise<UpdateRequestV2> {
  for (const file of files) {
    const value = JSON.parse(await readFile(path.join(stateDir, "requests", file), "utf8")) as UpdateRequestV2;
    if (value.schemaVersion === 2 && value.expectedBefore?.currentImage === null) return value;
  }
  throw new Error("published request with nullable expected-before projection not found");
}

async function readPublishedRequest(
  stateDir: string,
  files: string[],
  schemaVersion: number,
): Promise<Record<string, unknown>> {
  for (const file of files) {
    const value = JSON.parse(await readFile(path.join(stateDir, "requests", file), "utf8")) as Record<string, unknown>;
    if (value.schemaVersion === schemaVersion) return value;
  }
  throw new Error(`published request schema ${schemaVersion} not found`);
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
