import assert from "node:assert/strict";
import { getUpdateCenterHealth, UPDATE_CENTER_STATUS_FRESHNESS_MS } from "../../apps/web/lib/system/update-center-health";
import type { UpdateCenterStatus } from "../../apps/web/lib/system/update-center";

const now = Date.parse("2026-07-15T12:00:00.000Z");

assert.equal(getUpdateCenterHealth(status({ blocker: "maintenance hold" }), now), "blocked");
assert.equal(getUpdateCenterHealth(status({ lastOperation: operation("needs_reconciliation") }), now), "blocked");
assert.equal(getUpdateCenterHealth(status({ snapshotHash: null }), now), "unknown");
assert.equal(getUpdateCenterHealth(status({ snapshotSchemaVersion: null }), now), "unknown");
assert.equal(getUpdateCenterHealth(status({ statusUpdatedAt: null }), now), "unknown");
assert.equal(getUpdateCenterHealth(status({ statusUpdatedAt: "invalid" }), now), "unknown");
assert.equal(getUpdateCenterHealth(status({ statusUpdatedAt: new Date(now + 30_001).toISOString() }), now), "unknown");
assert.equal(getUpdateCenterHealth(status({ statusUpdatedAt: new Date(now - UPDATE_CENTER_STATUS_FRESHNESS_MS - 1).toISOString() }), now), "stale");
assert.equal(getUpdateCenterHealth(status({ updateAvailable: true }), now), "update_available");
assert.equal(getUpdateCenterHealth(status(), now), "healthy");

console.log("update center health selftest passed.");

function status(overrides: Partial<UpdateCenterStatus> = {}): UpdateCenterStatus {
  return {
    currentVersion: "0.1.7",
    currentImage: `ghcr.io/areasong/areaforge-web:v0.1.7@sha256:${"1".repeat(64)}`,
    appUrl: "http://127.0.0.1:3102",
    deployMode: "release",
    releaseUrl: null,
    latestVersion: "0.1.7",
    latestPublishedAt: null,
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: new Date(now).toISOString(),
    lastOperation: null,
    rollback: { available: false, targetVersion: null, targetImage: null, sourceRecordSha256: null },
    blocker: null,
    requestQueueLength: 0,
    statusUpdatedAt: new Date(now).toISOString(),
    snapshotSchemaVersion: 2,
    snapshotHash: `sha256:${"2".repeat(64)}`,
    verifiedTarget: null,
    ...overrides,
  };
}

function operation(statusValue: NonNullable<UpdateCenterStatus["lastOperation"]>["status"]): NonNullable<UpdateCenterStatus["lastOperation"]> {
  return {
    id: "update_1",
    action: "check",
    status: statusValue,
    requestedAt: new Date(now).toISOString(),
    finishedAt: null,
    message: null,
  };
}
