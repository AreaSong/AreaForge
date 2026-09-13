import { stableStringify } from "./ai-draft";
import { hashDataExportBytes, redactDataExportValueWithSummary, type DataExportRecordInput } from "./data-lifecycle";

export const DATA_EXPORT_JOB_PROTOCOL = "data-export-job-v1" as const;
export const DATA_EXPORT_POLICY_VERSION = "owner-export-v1" as const;
export const DATA_EXPORT_ARCHIVE_PROTOCOL = "areaforge-data-export-archive" as const;
export const DATA_EXPORT_ARCHIVE_VERSION = 2 as const;
export const DATA_EXPORT_MAX_BYTES = 512 * 1024 * 1024;
export const DATA_EXPORT_MAX_ENTRIES = 100_000;

export interface DataExportWorkspaceBinding {
  id: string;
  ownerId: string;
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  membership: { id: string; role: "OWNER" | "ADMIN" | "COACH" | "MEMBER" | "VIEWER"; status: "ACTIVE" | "LEFT" | "REMOVED"; revision: number } | null;
}
export interface DataExportAuthorization {
  authRevision: number;
  workspaces: DataExportWorkspaceBinding[];
}
export interface DataExportJobPayload {
  protocol: typeof DATA_EXPORT_JOB_PROTOCOL;
  policyVersion: typeof DATA_EXPORT_POLICY_VERSION;
  requesterId: string;
  scope: "ACCOUNT" | "WORKSPACE";
  workspaceId: string | null;
  requestedAt: string;
  authorization: DataExportAuthorization;
}

export class DataExportError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    if (!/^DATA_EXPORT_[A-Z_]{1,70}$/.test(code)) throw new TypeError("DATA_EXPORT_ERROR_CODE_INVALID");
    this.name = "DataExportError";
  }
}

export function parseDataExportJob(value: unknown): DataExportJobPayload {
  const input = exact(value, ["protocol", "policyVersion", "requesterId", "scope", "workspaceId", "requestedAt", "authorization"]);
  if (input.protocol !== DATA_EXPORT_JOB_PROTOCOL || input.policyVersion !== DATA_EXPORT_POLICY_VERSION
    || typeof input.scope !== "string" || !["ACCOUNT", "WORKSPACE"].includes(input.scope)) invalid();
  const scope = input.scope as DataExportJobPayload["scope"];
  const workspaceId = input.workspaceId === null ? null : exportIdentifier(input.workspaceId);
  if ((scope === "ACCOUNT") !== (workspaceId === null)) invalid();
  if (typeof input.requestedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.requestedAt)
    || !Number.isFinite(Date.parse(input.requestedAt)) || new Date(input.requestedAt).toISOString() !== input.requestedAt) invalid();
  const payload: DataExportJobPayload = {
    protocol: DATA_EXPORT_JOB_PROTOCOL, policyVersion: DATA_EXPORT_POLICY_VERSION,
    requesterId: exportIdentifier(input.requesterId), scope, workspaceId, requestedAt: input.requestedAt,
    authorization: parseDataExportAuthorization(input.authorization),
  };
  if (scope === "WORKSPACE" && (payload.authorization.workspaces.length !== 1 || payload.authorization.workspaces[0]?.id !== workspaceId)) invalid();
  return payload;
}

export function parseDataExportAuthorization(value: unknown): DataExportAuthorization {
  const input = exact(value, ["authRevision", "workspaces"]);
  if (!Array.isArray(input.workspaces) || input.workspaces.length > DATA_EXPORT_MAX_ENTRIES) invalid();
  const workspaces = input.workspaces.map(parseWorkspace);
  if (workspaces.some((item, index) => index > 0 && workspaces[index - 1]!.id >= item.id)) invalid();
  return { authRevision: revision(input.authRevision), workspaces };
}

function parseWorkspace(value: unknown): DataExportWorkspaceBinding {
  const input = exact(value, ["id", "ownerId", "status", "revision", "membership"]);
  if (input.status !== "ACTIVE" && input.status !== "ARCHIVED") invalid();
  let membership: DataExportWorkspaceBinding["membership"] = null;
  if (input.membership !== null) {
    const member = exact(input.membership, ["id", "role", "status", "revision"]);
    if (typeof member.role !== "string" || !["OWNER", "ADMIN", "COACH", "MEMBER", "VIEWER"].includes(member.role)
      || typeof member.status !== "string" || !["ACTIVE", "LEFT", "REMOVED"].includes(member.status)) invalid();
    membership = { id: exportIdentifier(member.id), role: member.role as NonNullable<DataExportWorkspaceBinding["membership"]>["role"], status: member.status as NonNullable<DataExportWorkspaceBinding["membership"]>["status"], revision: revision(member.revision) };
  }
  return { id: exportIdentifier(input.id), ownerId: exportIdentifier(input.ownerId), status: input.status, revision: revision(input.revision), membership };
}

export function dataExportJobFingerprint(value: unknown): string {
  // 协议已限制为 ASCII 标识/枚举/日期；不能用会删掉 authorization 的导出脱敏 hash。
  const canonical = `areaforge:data-export-job:v1\n${stableStringify(parseDataExportJob(value))}`;
  return hashDataExportBytes(Uint8Array.from([...canonical].map(character => character.charCodeAt(0))));
}

export function assertDataExportJobBinding(row: { queueVersion: number; kind: string; scope: string; requestedByUserId: string; workspaceId: string | null; requestFingerprint: string; resultJson: unknown }): DataExportJobPayload {
  const payload = parseDataExportJob(row.resultJson);
  if (row.queueVersion !== 1 || row.kind !== "EXPORT" || row.scope !== payload.scope || row.requestedByUserId !== payload.requesterId
    || row.workspaceId !== payload.workspaceId || row.requestFingerprint !== dataExportJobFingerprint(payload)) {
    throw new DataExportError("DATA_EXPORT_JOB_BINDING_INVALID");
  }
  return payload;
}

export function exportIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid();
  return value;
}

const studySessionReferences = new Set(["masteryEvidence", "studySessionCloseout", "studySessionDevicePresence", "studySessionKnowledgePoint", "knowledgeEvidence"]);
export function portableDataExportRecord(record: DataExportRecordInput) {
  let value = record.data;
  if (studySessionReferences.has(record.kind) && value && typeof value === "object" && !Array.isArray(value) && "sessionId" in value) {
    // 保留学习证据的外键，不放宽全局 session 凭据脱敏规则。
    const { sessionId, ...rest } = value;
    value = { ...rest, studySessionId: sessionId };
  }
  const redacted = redactDataExportValueWithSummary(value);
  return { kind: exportIdentifier(record.kind), id: exportIdentifier(record.id), data: redacted.value, omittedFieldCount: redacted.omittedFieldCount };
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const input = value as Record<string, unknown>;
  if (Reflect.ownKeys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) invalid();
  return input;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid();
  return value;
}
function invalid(): never { throw new DataExportError("DATA_EXPORT_PAYLOAD_INVALID"); }
