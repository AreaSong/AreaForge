import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
}

export interface CreateUpdateRequestInput {
  action: UpdateAction;
  tag?: string;
  autoApply?: AutoApplyPolicy;
  actorEmail: string;
}

export type UpdateRequestValidationCode =
  | "UPDATE_TAG_REQUIRED"
  | "UPDATE_TARGET_NOT_NEWER"
  | "ROLLBACK_TARGET_UNAVAILABLE"
  | "AUTO_APPLY_POLICY_REQUIRED"
  | "AUTO_APPLY_POLICY_UNCHANGED";

export async function getUpdateCenterStatus(): Promise<UpdateCenterStatus> {
  const status = await readJsonFile<Partial<UpdateCenterStatus>>(statusPath);
  const currentVersion = process.env.APP_VERSION ?? status?.currentVersion ?? "0.1.0";
  const currentImage = process.env.AREAFORGE_IMAGE ?? status?.currentImage ?? null;
  const latestVersion = status?.latestVersion ?? null;

  return {
    currentVersion,
    currentImage,
    appUrl: process.env.APP_URL ?? status?.appUrl ?? null,
    deployMode: detectDeployMode(currentImage),
    releaseUrl: status?.releaseUrl ?? releaseUrlFor(latestVersion ?? currentVersion),
    latestVersion,
    latestPublishedAt: status?.latestPublishedAt ?? null,
    updateAvailable: Boolean(status?.updateAvailable),
    autoApply: normalizeAutoApply(status?.autoApply),
    signatureRequired: Boolean(status?.signatureRequired),
    timerEnabled: typeof status?.timerEnabled === "boolean" ? status.timerEnabled : null,
    timerActive: typeof status?.timerActive === "boolean" ? status.timerActive : null,
    lastCheckedAt: status?.lastCheckedAt ?? null,
    lastOperation: status?.lastOperation ?? null,
    rollback: {
      available: Boolean(status?.rollback?.available),
      targetVersion: status?.rollback?.targetVersion ?? null,
      targetImage: status?.rollback?.targetImage ?? null,
    },
    blocker: status?.blocker ?? null,
    requestQueueLength: typeof status?.requestQueueLength === "number" ? status.requestQueueLength : null,
    statusUpdatedAt: status?.statusUpdatedAt ?? null,
  };
}

export async function createUpdateRequest(input: CreateUpdateRequestInput): Promise<UpdateOperation> {
  await mkdir(requestsDir, { recursive: true });

  const now = new Date().toISOString();
  const request: UpdateOperation & {
    actorEmailHash: string;
    autoApply?: AutoApplyPolicy;
  } = {
    id: `update_${Date.now()}_${randomUUID()}`,
    action: input.action,
    status: "queued",
    requestedAt: now,
    finishedAt: null,
    message: null,
    actorEmailHash: await hashText(input.actorEmail),
  };

  if (input.tag) request.tag = input.tag;
  if (input.autoApply) request.autoApply = input.autoApply;

  const requestPath = path.join(requestsDir, `${request.id}.json`);
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 });
  return request;
}

export function validateUpdateRequestAgainstStatus(
  input: Pick<CreateUpdateRequestInput, "action" | "tag" | "autoApply">,
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

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    return null;
  }
}

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

async function hashText(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
