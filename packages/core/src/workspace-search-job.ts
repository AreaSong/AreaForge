import { hashDataExportValue } from "./data-lifecycle";
import type { DataJobStatus } from "./data-jobs";

export const WORKSPACE_SEARCH_PROTOCOL = "workspace-search-index-job-v1" as const;
export const WORKSPACE_SEARCH_KINDS = ["SUBJECT", "TASK", "KNOWLEDGE_POINT", "NOTE", "MISTAKE", "RESOURCE"] as const;
export type WorkspaceSearchKind = typeof WORKSPACE_SEARCH_KINDS[number];
export const SEARCH_INDEX_MAX_DOCUMENTS = 10_000;
export const SEARCH_INDEX_MAX_TITLE_BYTES = 8192;
export const SEARCH_INDEX_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export class WorkspaceSearchError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); this.name = "WorkspaceSearchError"; }
}

export interface WorkspaceSearchJob {
  protocol: typeof WORKSPACE_SEARCH_PROTOCOL;
  actorUserId: string;
  workspaceId: string;
  partitionId: string;
  generation: number;
  sourceFingerprint: string;
  requestedAt: string;
}

export interface WorkspaceSearchJobView {
  id: string;
  status: DataJobStatus;
  revision: number;
  generation: number;
  progress: number;
  attempt: number;
  maxAttempts: number;
  retryable: boolean;
  pauseRequested: boolean;
  deadLettered: boolean;
  errorCode: string | null;
  createdAt: string;
  expiresAt: string;
  nextAttemptAt: string | null;
  controls: Array<"PAUSE" | "RESUME" | "CANCEL" | "REPLAY">;
}

export function workspaceSearchIndexEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return ["AUTH_MULTI_USER_ENABLED", "AUTH_RBAC_ENABLED", "SEARCH_INDEX_ENABLED"].every(key => env[key] === "true");
}

export function workspaceSearchQueueEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return workspaceSearchIndexEnabled(env) && env.SEARCH_INDEX_QUEUE_ENABLED === "true" && env.DATA_JOB_WORKER_ENABLED === "true";
}

export function searchIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,191}$/.test(value)) invalid();
  return value;
}

export function searchGeneration(value: unknown, allowZero = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_646) invalid();
  return value;
}

export function parseWorkspaceSearchJob(value: unknown): WorkspaceSearchJob {
  const keys = ["protocol", "actorUserId", "workspaceId", "partitionId", "generation", "sourceFingerprint", "requestedAt"];
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  const row = value as Record<string, unknown>;
  if (Reflect.ownKeys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) || row.protocol !== WORKSPACE_SEARCH_PROTOCOL
    || typeof row.sourceFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.sourceFingerprint)
    || typeof row.requestedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.requestedAt)
    || !Number.isFinite(Date.parse(row.requestedAt)) || new Date(row.requestedAt).toISOString() !== row.requestedAt) invalid();
  return { protocol: WORKSPACE_SEARCH_PROTOCOL, actorUserId: searchIdentifier(row.actorUserId), workspaceId: searchIdentifier(row.workspaceId),
    partitionId: searchIdentifier(row.partitionId), generation: searchGeneration(row.generation),
    sourceFingerprint: row.sourceFingerprint, requestedAt: row.requestedAt };
}

export function workspaceSearchJobFingerprint(value: unknown): string {
  return hashDataExportValue({ domain: WORKSPACE_SEARCH_PROTOCOL, job: parseWorkspaceSearchJob(value) });
}

function invalid(): never { throw new WorkspaceSearchError("SEARCH_INDEX_PAYLOAD_INVALID"); }
