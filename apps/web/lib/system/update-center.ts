import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  atomicPublishUpdateRequest,
  buildUpdateRequestV2,
  parseVerifiedStatusSnapshot,
  UpdateRequestV2Error,
  type UpdateRequestCommand,
  type UpdateStatusSnapshotV2,
  type VerifiedUpdateTarget,
} from "./update-request-v2";

const defaultStateDir = process.env.APP_ENV === "production"
  ? "/app/ops-state"
  : "/tmp/areaforge-ops-state";

const stateDir = process.env.AREAFORGE_OPS_STATE_DIR ?? defaultStateDir;
const requestsDir = path.join(stateDir, "requests");
const statusPath = path.join(stateDir, "status.json");

export const updateActions = ["check", "apply", "rollback", "set_auto_apply"] as const;
export const autoApplyPolicies = ["none", "patch", "minor", "all"] as const;

export type UpdateAction = typeof updateActions[number];
export type AutoApplyPolicy = typeof autoApplyPolicies[number];

export interface UpdateCenterStatus {
  currentVersion: string;
  currentImage: string | null;
  appUrl: string | null;
  deployMode: "release" | "local_build" | "unknown";
  releaseUrl: string | null;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  updateAvailable: boolean;
  autoApply: AutoApplyPolicy;
  signatureRequired: boolean;
  timerEnabled: boolean | null;
  timerActive: boolean | null;
  lastCheckedAt: string | null;
  lastOperation: UpdateOperation | null;
  rollback: RollbackStatus;
  blocker: string | null;
  requestQueueLength: number | null;
  statusUpdatedAt: string | null;
  snapshotSchemaVersion?: 2 | null;
  snapshotHash?: string | null;
  verifiedTarget?: VerifiedUpdateTarget | null;
}

export interface UpdateOperation {
  id: string;
  action: UpdateAction;
  status: "queued" | "running" | "succeeded" | "failed";
  requestedAt: string;
  finishedAt: string | null;
  message: string | null;
  tag?: string;
}

export interface RollbackStatus {
  available: boolean;
  targetVersion: string | null;
  targetImage: string | null;
  sourceRecordSha256?: string | null;
}

export interface CreateUpdateRequestInput {
  command: UpdateRequestCommand;
  actorEmail: string;
}

export type UpdateRequestValidationCode =
  | "UPDATE_TAG_REQUIRED"
  | "UPDATE_TARGET_NOT_NEWER"
  | "ROLLBACK_TARGET_UNAVAILABLE"
  | "AUTO_APPLY_POLICY_REQUIRED"
  | "AUTO_APPLY_POLICY_UNCHANGED";

export async function getUpdateCenterStatus(): Promise<UpdateCenterStatus> {
  const rawStatus = await readJsonFile(statusPath);
  const source = asRecord(rawStatus);
  const snapshot = parseVerifiedStatusSnapshot(rawStatus);
  const currentVersion = snapshot?.currentVersion ?? process.env.APP_VERSION ?? stringValue(source.currentVersion) ?? "0.1.0";
  const currentImage = snapshot?.currentImage ?? process.env.AREAFORGE_IMAGE ?? nullableString(source.currentImage);
  const latestVersion = nullableString(source.latestVersion);

  return {
    currentVersion,
    currentImage,
    appUrl: process.env.APP_URL ?? nullableString(source.appUrl),
    deployMode: detectDeployMode(currentImage),
    releaseUrl: nullableString(source.releaseUrl) ?? releaseUrlFor(latestVersion ?? currentVersion),
    latestVersion,
    latestPublishedAt: nullableString(source.latestPublishedAt),
    updateAvailable: source.updateAvailable === true,
    autoApply: snapshot?.autoApply ?? normalizeAutoApply(source.autoApply),
    signatureRequired: snapshot?.signatureRequired ?? source.signatureRequired === true,
    timerEnabled: nullableBoolean(source.timerEnabled),
    timerActive: nullableBoolean(source.timerActive),
    lastCheckedAt: nullableString(source.lastCheckedAt),
    lastOperation: normalizeOperation(source.lastOperation),
    rollback: {
      available: snapshot?.rollback.available ?? rollbackField(source, "available") === true,
      targetVersion: snapshot?.rollback.targetVersion ?? rollbackString(source, "targetVersion"),
      targetImage: snapshot?.rollback.targetImage ?? rollbackString(source, "targetImage"),
      sourceRecordSha256: snapshot?.rollback.sourceRecordSha256 ?? null,
    },
    blocker: nullableString(source.blocker),
    requestQueueLength: nullableNumber(source.requestQueueLength),
    statusUpdatedAt: nullableString(source.statusUpdatedAt),
    snapshotSchemaVersion: source.snapshotSchemaVersion === 2 ? 2 : null,
    snapshotHash: snapshot?.snapshotHash ?? null,
    verifiedTarget: snapshot?.verifiedTarget ?? null,
  };
}

export async function createUpdateRequest(input: CreateUpdateRequestInput): Promise<UpdateOperation> {
  const status = await getUpdateCenterStatus();
  const snapshot = statusSnapshot(status, input.command.action);
  const request = buildUpdateRequestV2({
    command: input.command,
    actorEmail: input.actorEmail,
    snapshot,
  });
  const publish = await atomicPublishUpdateRequest(requestsDir, request);
  return publicOperation(request, publish.directorySync);
}

export function validateUpdateRequestAgainstStatus(
  input: { action: UpdateAction; tag?: string; autoApply?: AutoApplyPolicy },
  status: UpdateCenterStatus,
): UpdateRequestValidationCode | null {
  if (input.action === "apply") {
    if (!input.tag) return "UPDATE_TAG_REQUIRED";
    if (!isTargetVersionNewer(input.tag, status.currentVersion)) return "UPDATE_TARGET_NOT_NEWER";
  }
  if (input.action === "rollback" && !status.rollback.available) return "ROLLBACK_TARGET_UNAVAILABLE";
  if (input.action === "set_auto_apply") {
    if (!input.autoApply) return "AUTO_APPLY_POLICY_REQUIRED";
    if (input.autoApply === status.autoApply) return "AUTO_APPLY_POLICY_UNCHANGED";
  }
  return null;
}

export function isUpdateAction(value: unknown): value is UpdateAction {
  return typeof value === "string" && updateActions.includes(value as UpdateAction);
}

export function isAutoApplyPolicy(value: unknown): value is AutoApplyPolicy {
  return typeof value === "string" && autoApplyPolicies.includes(value as AutoApplyPolicy);
}

function statusSnapshot(status: UpdateCenterStatus, action: UpdateAction): UpdateStatusSnapshotV2 {
  if (status.snapshotSchemaVersion !== 2) {
    if (action !== "check") throw new UpdateRequestV2Error("LEGACY_MUTATION_UNBOUND");
    throw new UpdateRequestV2Error("STATUS_SNAPSHOT_INVALID");
  }
  if (!status.snapshotHash) throw new UpdateRequestV2Error("STATUS_SNAPSHOT_INVALID");
  return {
    snapshotSchemaVersion: 2,
    snapshotHash: status.snapshotHash,
    currentVersion: status.currentVersion,
    currentImage: status.currentImage,
    autoApply: status.autoApply,
    signatureRequired: status.signatureRequired,
    verifiedTarget: status.verifiedTarget ?? null,
    rollback: {
      available: status.rollback.available,
      targetVersion: status.rollback.targetVersion,
      targetImage: status.rollback.targetImage,
      sourceRecordSha256: status.rollback.sourceRecordSha256 ?? null,
    },
  };
}

function publicOperation(
  request: ReturnType<typeof buildUpdateRequestV2>,
  directorySync: "synced" | "uncertain",
): UpdateOperation {
  return {
    id: request.id,
    action: request.action,
    status: request.status,
    requestedAt: request.requestedAt,
    finishedAt: null,
    message: directorySync === "uncertain" ? "请求已入队，但目录持久化状态未确认；请先刷新状态，不要重复提交。" : null,
    ...(request.params.tag ? { tag: request.params.tag } : {}),
  };
}

async function readJsonFile(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : stringValue(value);
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rollbackField(source: Record<string, unknown>, field: string): unknown {
  return asRecord(source.rollback)[field];
}

function rollbackString(source: Record<string, unknown>, field: string): string | null {
  return nullableString(rollbackField(source, field));
}

function normalizeOperation(value: unknown): UpdateOperation | null {
  const operation = asRecord(value);
  if (!stringValue(operation.id) || !isUpdateAction(operation.action) || !stringValue(operation.requestedAt)) return null;
  if (!operationStatuses.includes(operation.status as UpdateOperation["status"])) return null;
  return {
    id: operation.id as string,
    action: operation.action,
    status: operation.status as UpdateOperation["status"],
    requestedAt: operation.requestedAt as string,
    finishedAt: nullableString(operation.finishedAt),
    message: nullableString(operation.message),
    ...(stringValue(operation.tag) ? { tag: operation.tag as string } : {}),
  };
}

const operationStatuses: UpdateOperation["status"][] = ["queued", "running", "succeeded", "failed"];

function detectDeployMode(image: string | null): UpdateCenterStatus["deployMode"] {
  if (!image) return "unknown";
  if (image.includes("ghcr.io/")) return "release";
  if (image.includes("local")) return "local_build";
  return "unknown";
}

function normalizeAutoApply(value: unknown): AutoApplyPolicy {
  return isAutoApplyPolicy(value) ? value : "none";
}

function releaseUrlFor(version: string | null): string | null {
  if (!version) return null;
  return `https://github.com/AreaSong/AreaForge/releases/tag/${version.startsWith("v") ? version : `v${version}`}`;
}

function isTargetVersionNewer(targetVersion: string, currentVersion: string): boolean {
  const target = parseVersionCore(targetVersion);
  const current = parseVersionCore(currentVersion);
  if (!target || !current) return false;
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] > current[index]) return true;
    if (target[index] < current[index]) return false;
  }
  return false;
}

function parseVersionCore(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
