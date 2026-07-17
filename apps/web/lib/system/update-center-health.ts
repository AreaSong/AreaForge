import type { UpdateCenterStatus } from "./update-center";

export const UPDATE_CENTER_STATUS_FRESHNESS_MS = 5 * 60_000;

export type UpdateCenterHealth = "blocked" | "unknown" | "stale" | "update_available" | "healthy";

export function getUpdateCenterHealth(status: UpdateCenterStatus, now = Date.now()): UpdateCenterHealth {
  if (status.blocker) return "blocked";
  if (status.lastOperation?.status === "needs_reconciliation") return "blocked";
  if (!status.snapshotHash || status.snapshotSchemaVersion !== 2 || !status.statusUpdatedAt) return "unknown";
  const updatedAt = Date.parse(status.statusUpdatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 30_000) return "unknown";
  if (now - updatedAt > UPDATE_CENTER_STATUS_FRESHNESS_MS) return "stale";
  if (status.updateAvailable) return "update_available";
  return "healthy";
}
