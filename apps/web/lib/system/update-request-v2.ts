import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const UPDATE_REQUEST_EXPECTED_BEFORE_DOMAIN = "areaforge.update-request.expected-before.v2";
export const UPDATE_REQUEST_SEMANTIC_DOMAIN = "areaforge.update-request.semantic.v2";
export const UPDATE_REQUEST_DOMAIN = "areaforge.update-request.v2";
export const UPDATE_REQUEST_CLOCK_SKEW_MS = 30_000;
export const UPDATE_REQUEST_MUTATION_TTL_MS = 5 * 60_000;
export const UPDATE_REQUEST_MUTATION_TTL_HARD_MAX_MS = 10 * 60_000;
export const UPDATE_REQUEST_CHECK_TTL_MS = 15 * 60_000;

const tagPattern = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const hashSchema = z.string().regex(SHA256_PATTERN);
const idempotencyKeySchema = z.string().uuid();

export const updateRequestCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("check"),
    confirmedSnapshotHash: hashSchema,
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("apply"),
    confirmedSnapshotHash: hashSchema,
    idempotencyKey: idempotencyKeySchema,
    tag: z.string().regex(tagPattern),
  }).strict(),
  z.object({
    action: z.literal("rollback"),
    confirmedSnapshotHash: hashSchema,
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
  z.object({
    action: z.literal("set_auto_apply"),
    autoApply: z.enum(["none", "patch", "minor", "all"]),
    confirmedSnapshotHash: hashSchema,
    idempotencyKey: idempotencyKeySchema,
  }).strict(),
]);

export type UpdateRequestCommand = z.infer<typeof updateRequestCommandSchema>;
export type UpdateRequestAction = UpdateRequestCommand["action"];
export type UpdateRequestAutoApply = Extract<UpdateRequestCommand, { action: "set_auto_apply" }>["autoApply"];

export interface VerifiedUpdateTarget {
  releaseId: number;
  manifestSha256: string;
  manifestVersion: string;
  webImageDigest: string;
}

export interface UpdateStatusSnapshotV2 {
  snapshotSchemaVersion: 2;
  snapshotHash: string;
  currentVersion: string;
  currentImage: string | null;
  autoApply: UpdateRequestAutoApply;
  signatureRequired: boolean;
  verifiedTarget: VerifiedUpdateTarget | null;
  rollback: {
    available: boolean;
    targetVersion: string | null;
    targetImage: string | null;
    sourceRecordSha256: string | null;
  };
}

export interface UpdateRequestV2 {
  schemaVersion: 2;
  id: string;
  action: UpdateRequestAction;
  status: "queued";
  requestedAt: string;
  expiresAt: string;
  actorEmailHash: string;
  idempotencyKey: string;
  params: {
    tag: string | null;
    autoApply: UpdateRequestAutoApply | null;
  };
  target: {
    releaseId: number | null;
    manifestSha256: string | null;
    manifestVersion: string | null;
    webImageDigest: string | null;
  };
  expectedBefore: {
    currentVersion: string;
    currentImage: string | null;
    autoApply: UpdateRequestAutoApply;
    signatureRequired: boolean;
    rollbackTargetVersion: string | null;
    rollbackTargetImage: string | null;
    rollbackSourceRecordSha256: string | null;
  };
  expectedBeforeHash: string;
  semanticHash: string;
  requestHash: string;
}

export type UpdateRequestV2ErrorCode =
  | "AUTO_APPLY_POLICY_UNCHANGED"
  | "LEGACY_MUTATION_UNBOUND"
  | "STATUS_SNAPSHOT_INVALID"
  | "STATUS_SNAPSHOT_CHANGED"
  | "UPDATE_TARGET_NOT_NEWER"
  | "UPDATE_TARGET_UNVERIFIED"
  | "ROLLBACK_TARGET_UNVERIFIED";

export class UpdateRequestV2Error extends Error {
  constructor(public readonly code: UpdateRequestV2ErrorCode) {
    super(code);
  }
}

const verifiedTargetSchema = z.object({
  releaseId: z.number().int().positive(),
  manifestSha256: hashSchema,
  manifestVersion: z.string().min(1),
  webImageDigest: z.string().regex(/@sha256:[0-9a-f]{64}$/),
}).strict();

const statusSnapshotSchema = z.object({
  snapshotSchemaVersion: z.literal(2),
  snapshotHash: hashSchema,
  currentVersion: z.string().min(1),
  currentImage: z.string().min(1).nullable(),
  autoApply: z.enum(["none", "patch", "minor", "all"]),
  signatureRequired: z.boolean(),
  verifiedTarget: verifiedTargetSchema.nullable(),
  rollback: z.object({
    available: z.boolean(),
    targetVersion: z.string().min(1).nullable(),
    targetImage: z.string().min(1).nullable(),
    sourceRecordSha256: hashSchema.nullable(),
  }).passthrough(),
}).passthrough();

export function parseVerifiedStatusSnapshot(raw: unknown): UpdateStatusSnapshotV2 | null {
  const parsed = statusSnapshotSchema.safeParse(raw);
  if (!parsed.success) return null;

  const snapshot: UpdateStatusSnapshotV2 = {
    snapshotSchemaVersion: 2,
    snapshotHash: parsed.data.snapshotHash,
    currentVersion: parsed.data.currentVersion,
    currentImage: parsed.data.currentImage,
    autoApply: parsed.data.autoApply,
    signatureRequired: parsed.data.signatureRequired,
    verifiedTarget: parsed.data.verifiedTarget,
    rollback: {
      available: parsed.data.rollback.available,
      targetVersion: parsed.data.rollback.targetVersion,
      targetImage: parsed.data.rollback.targetImage,
      sourceRecordSha256: parsed.data.rollback.sourceRecordSha256,
    },
  };

  return computeStatusSnapshotHash(snapshot) === snapshot.snapshotHash ? snapshot : null;
}

export function computeStatusSnapshotHash(snapshot: Omit<UpdateStatusSnapshotV2, "snapshotHash" | "snapshotSchemaVersion">): string {
  return sha256Canonical({
    currentVersion: snapshot.currentVersion,
    currentImage: snapshot.currentImage,
    autoApply: snapshot.autoApply,
    signatureRequired: snapshot.signatureRequired,
    verifiedTarget: snapshot.verifiedTarget,
    rollback: {
      available: snapshot.rollback.available,
      targetVersion: snapshot.rollback.targetVersion,
      targetImage: snapshot.rollback.targetImage,
      sourceRecordSha256: snapshot.rollback.sourceRecordSha256,
    },
  });
}

export function buildUpdateRequestV2(input: {
  command: UpdateRequestCommand;
  actorEmail: string;
  snapshot: UpdateStatusSnapshotV2;
  now?: Date;
  id?: string;
}): UpdateRequestV2 {
  if (input.command.confirmedSnapshotHash !== input.snapshot.snapshotHash) {
    throw new UpdateRequestV2Error("STATUS_SNAPSHOT_CHANGED");
  }
  if (input.command.action === "apply" && !isTargetVersionNewer(input.command.tag, input.snapshot.currentVersion)) {
    throw new UpdateRequestV2Error("UPDATE_TARGET_NOT_NEWER");
  }
  if (input.command.action === "set_auto_apply" && input.command.autoApply === input.snapshot.autoApply) {
    throw new UpdateRequestV2Error("AUTO_APPLY_POLICY_UNCHANGED");
  }

  const requestedAt = input.now ?? new Date();
  const id = input.id ?? `update_${requestedAt.getTime()}_${randomUUID()}`;
  const params = commandParams(input.command);
  const target = commandTarget(input.command, input.snapshot);
  const expectedBefore = {
    currentVersion: input.snapshot.currentVersion,
    currentImage: input.snapshot.currentImage,
    autoApply: input.snapshot.autoApply,
    signatureRequired: input.snapshot.signatureRequired,
    rollbackTargetVersion: input.snapshot.rollback.targetVersion,
    rollbackTargetImage: input.snapshot.rollback.targetImage,
    rollbackSourceRecordSha256: input.snapshot.rollback.sourceRecordSha256,
  };
  const expectedBeforeHash = sha256Canonical({
    domain: UPDATE_REQUEST_EXPECTED_BEFORE_DOMAIN,
    expectedBefore,
  });
  const semanticHash = sha256Canonical({
    domain: UPDATE_REQUEST_SEMANTIC_DOMAIN,
    action: input.command.action,
    params,
    target,
    expectedBefore,
  });
  const immutableEnvelope = {
    schemaVersion: 2 as const,
    id,
    action: input.command.action,
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + ttlMilliseconds(input.command.action)).toISOString(),
    actorEmailHash: createHash("sha256").update(input.actorEmail.trim().toLowerCase()).digest("hex"),
    idempotencyKey: input.command.idempotencyKey,
    params,
    target,
    expectedBefore,
    expectedBeforeHash,
    semanticHash,
  };

  return {
    ...immutableEnvelope,
    status: "queued",
    requestHash: sha256Canonical({
      domain: UPDATE_REQUEST_DOMAIN,
      ...immutableEnvelope,
    }),
  };
}

export function verifyUpdateRequestHashes(request: UpdateRequestV2): boolean {
  const expectedBeforeHash = sha256Canonical({
    domain: UPDATE_REQUEST_EXPECTED_BEFORE_DOMAIN,
    expectedBefore: request.expectedBefore,
  });
  const semanticHash = sha256Canonical({
    domain: UPDATE_REQUEST_SEMANTIC_DOMAIN,
    action: request.action,
    params: request.params,
    target: request.target,
    expectedBefore: request.expectedBefore,
  });
  const immutableEnvelope = {
    schemaVersion: request.schemaVersion,
    id: request.id,
    action: request.action,
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    actorEmailHash: request.actorEmailHash,
    idempotencyKey: request.idempotencyKey,
    params: request.params,
    target: request.target,
    expectedBefore: request.expectedBefore,
    expectedBeforeHash: request.expectedBeforeHash,
    semanticHash: request.semanticHash,
  };
  const requestHash = sha256Canonical({ domain: UPDATE_REQUEST_DOMAIN, ...immutableEnvelope });
  return request.expectedBeforeHash === expectedBeforeHash
    && request.semanticHash === semanticHash
    && request.requestHash === requestHash;
}

export async function atomicPublishUpdateRequest(requestsDir: string, request: UpdateRequestV2): Promise<string> {
  await mkdir(requestsDir, { recursive: true, mode: 0o700 });
  const finalPath = path.join(requestsDir, `${request.id}.json`);
  const temporaryPath = path.join(requestsDir, `.${request.id}.${randomUUID()}.tmp`);
  let temporaryExists = false;

  try {
    const file = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await file.writeFile(`${JSON.stringify(request, null, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }

    await rename(temporaryPath, finalPath);
    temporaryExists = false;
    const directory = await open(requestsDir, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return finalPath;
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch(() => undefined);
  }
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value: unknown): string {
  return sha256Text(canonicalStringify(value));
}

function commandParams(command: UpdateRequestCommand): UpdateRequestV2["params"] {
  return {
    tag: command.action === "apply" ? normalizeTag(command.tag) : null,
    autoApply: command.action === "set_auto_apply" ? command.autoApply : null,
  };
}

function commandTarget(command: UpdateRequestCommand, snapshot: UpdateStatusSnapshotV2): UpdateRequestV2["target"] {
  if (command.action === "rollback") {
    if (!snapshot.rollback.available
      || !snapshot.rollback.targetVersion
      || !snapshot.rollback.targetImage
      || !snapshot.rollback.sourceRecordSha256) {
      throw new UpdateRequestV2Error("ROLLBACK_TARGET_UNVERIFIED");
    }
    return emptyTarget();
  }
  if (command.action !== "apply") return emptyTarget();
  const target = snapshot.verifiedTarget;
  if (!target || normalizeTag(target.manifestVersion) !== normalizeTag(command.tag)) {
    throw new UpdateRequestV2Error("UPDATE_TARGET_UNVERIFIED");
  }
  return { ...target };
}

function emptyTarget(): UpdateRequestV2["target"] {
  return {
    releaseId: null,
    manifestSha256: null,
    manifestVersion: null,
    webImageDigest: null,
  };
}

function ttlMilliseconds(action: UpdateRequestAction): number {
  return action === "check" ? UPDATE_REQUEST_CHECK_TTL_MS : UPDATE_REQUEST_MUTATION_TTL_MS;
}

function normalizeTag(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
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
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!/^[\x20-\x7E]*$/.test(value)) throw new TypeError("canonical JSON strings must be printable ASCII");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("canonical JSON numbers must be safe integers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  throw new TypeError("unsupported canonical JSON value");
}
