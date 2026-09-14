import { constants, fstatSync, lstatSync } from "node:fs";
import { link, mkdir, open, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { operationCanonical, operationHash, type OperationClaim } from "../../packages/db/src/index";

export const rootOperationPhases = ["admission", "validation", "backup", "prepare", "migration", "switch", "health", "smoke", "rollback", "maintenance", "preview", "check", "execution", "terminal", "writeback", "reconciliation"] as const;
export type RootOperationPhase = typeof rootOperationPhases[number];
export type RootOperationOutcome = "SUCCEEDED" | "FAILED" | "HELD" | "CANCELLED";
export interface RootOperationEvent {
  schemaVersion: 2; environment: "local_fixture" | "production"; scopeId: string;
  requestId: string; requestHash: string; nonce: string; bindingHash: string;
  generation: number; claimRevision: number; leaseTokenHash: string;
  sequence: number; phase: RootOperationPhase; state: "started" | "complete" | "uncertain";
  executionAttempted: boolean; outcome: RootOperationOutcome | null; resultCode: string;
  detailHash: string | null; createdAt: string; previousEventHash: string | null; eventHash: string;
}
const eventKeys = ["schemaVersion", "environment", "scopeId", "requestId", "requestHash", "nonce", "bindingHash", "generation", "claimRevision", "leaseTokenHash", "sequence", "phase", "state", "executionAttempted", "outcome", "resultCode", "detailHash", "createdAt", "previousEventHash", "eventHash"];
const hashPattern = /^sha256:[a-f0-9]{64}$/;

export async function writeRootJson(directory: string, name: string, value: unknown): Promise<void> {
  assertRootDirectory(directory);
  if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) throw new Error("OPS_JOURNAL_NAME_INVALID");
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(operationCanonical(value) + "\n", "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  try { await link(temporary, path.join(directory, name)); await syncRootDirectory(directory); }
  finally { await unlink(temporary).catch(() => undefined); }
  await syncRootDirectory(directory);
}
export async function readRootJson(file: string): Promise<unknown> {
  assertRootDirectory(path.dirname(file));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 65_536) throw new Error("OPS_JOURNAL_FILE_INVALID");
    return JSON.parse(await handle.readFile("utf8"));
  } finally { await handle.close(); }
}
export async function ensureRootDirectory(directory: string): Promise<void> {
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  assertRootDirectory(directory); await syncRootDirectory(path.dirname(directory));
}
export function assertRootDirectory(directory: string): void {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077) throw new Error("OPS_ROOT_DIRECTORY_INVALID");
}
export async function syncRootDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
export function assertInheritedOperationLocks(root: string): void {
  for (const [index, name] of ["queue-control", "production-state", "agent-local"].entries()) {
    const fd = fstatSync(index + 3); const named = lstatSync(path.join(root, `${name}.lock`));
    if (!fd.isFile() || named.isSymbolicLink() || fd.ino !== named.ino || fd.dev !== named.dev || fd.uid !== process.getuid?.()
      || fd.mode & 0o077) throw new Error("OPS_LOCK_BINDING_INVALID");
  }
}
export function operationJournalDirectory(root: string, requestHash: string): string {
  if (!hashPattern.test(requestHash)) throw new Error("OPS_REQUEST_HASH_INVALID");
  return path.join(root, requestHash.slice(7));
}
export async function readOperationJournal(directory: string): Promise<RootOperationEvent[]> {
  let files: string[];
  try { files = await readdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  assertRootDirectory(directory);
  const entries: RootOperationEvent[] = [];
  const names = files.filter(name => !name.startsWith(".") && name !== "request.json").sort();
  if (names.length > 256 || names.some(name => !/^\d{6}\.json$/.test(name))) throw new Error("OPS_JOURNAL_INVENTORY_INVALID");
  for (const [index, name] of names.entries()) {
    if (name !== `${String(index + 1).padStart(6, "0")}.json`) throw new Error("OPS_JOURNAL_SEQUENCE_INVALID");
    const raw = await readRootJson(path.join(directory, name));
    const entry = validateEvent(raw); const previous = entries.at(-1);
    if (entry.sequence !== index + 1 || entry.previousEventHash !== (previous?.eventHash ?? null)
      || (previous && (entry.requestHash !== previous.requestHash || entry.requestId !== previous.requestId || entry.nonce !== previous.nonce
        || entry.bindingHash !== previous.bindingHash || entry.environment !== previous.environment || entry.scopeId !== previous.scopeId
        || entry.generation < previous.generation || Date.parse(entry.createdAt) <= Date.parse(previous.createdAt)
        || (entry.generation === previous.generation && (entry.claimRevision !== previous.claimRevision || entry.leaseTokenHash !== previous.leaseTokenHash))))) throw new Error("OPS_JOURNAL_CHAIN_INVALID");
    entries.push(entry);
  }
  return entries;
}
export async function appendOperationEvent(directory: string, claim: OperationClaim, data: {
  phase: RootOperationPhase; state: RootOperationEvent["state"]; executionAttempted?: boolean;
  resultCode?: string; outcome?: RootOperationOutcome; detailHash?: string;
}): Promise<RootOperationEvent> {
  const events = await readOperationJournal(directory); const previous = events.at(-1);
  const entry: RootOperationEvent = {
    schemaVersion: 2, environment: claim.operation.execution.context.environment, scopeId: claim.operation.execution.context.scopeId,
    requestId: claim.request.id, requestHash: claim.request.requestHash, nonce: claim.request.nonce,
    bindingHash: claim.operation.execution.bindingHash, generation: claim.generation, claimRevision: claim.request.revision,
    leaseTokenHash: operationHash(claim.token), sequence: events.length + 1, phase: data.phase, state: data.state,
    executionAttempted: data.executionAttempted ?? false, outcome: data.outcome ?? null, resultCode: data.resultCode ?? "NONE",
    detailHash: data.detailHash ?? null, createdAt: new Date(Math.max(Date.now(), Date.parse(previous?.createdAt ?? "1970-01-01") + 1)).toISOString(),
    previousEventHash: previous?.eventHash ?? null, eventHash: "",
  };
  entry.eventHash = eventHash(entry); validateEvent(entry);
  await writeRootJson(directory, `${String(entry.sequence).padStart(6, "0")}.json`, entry);
  return entry;
}
export function rootEventProjection(event: RootOperationEvent) {
  const value = { rawEventHash: event.eventHash, phase: event.phase, state: event.state,
    executionAttempted: event.executionAttempted, environment: event.environment };
  return { ...value, projectionHash: operationHash({ domain: "areaforge.controlled-operation.projection.v2", requestHash: event.requestHash, ...value }) };
}
function validateEvent(raw: unknown): RootOperationEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("OPS_JOURNAL_INVALID");
  const entry = raw as RootOperationEvent;
  if (Object.keys(entry).length !== eventKeys.length || eventKeys.some(key => !Object.hasOwn(entry, key)) || entry.schemaVersion !== 2
    || !["local_fixture", "production"].includes(entry.environment) || !rootOperationPhases.includes(entry.phase)
    || !["started", "complete", "uncertain"].includes(entry.state) || typeof entry.executionAttempted !== "boolean"
    || ![null, "SUCCEEDED", "FAILED", "HELD", "CANCELLED"].includes(entry.outcome)
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(entry.requestId) || !/^[a-f0-9-]{36}$/.test(entry.nonce)
    || !/^[A-Z0-9_]{1,80}$/.test(entry.resultCode) || !Number.isFinite(Date.parse(entry.createdAt))
    || [entry.sequence, entry.generation, entry.claimRevision].some(value => !Number.isSafeInteger(value) || value <= 0)
    || [entry.scopeId, entry.requestHash, entry.bindingHash, entry.leaseTokenHash, entry.eventHash].some(value => !hashPattern.test(value))
    || (entry.detailHash !== null && !hashPattern.test(entry.detailHash)) || (entry.previousEventHash !== null && !hashPattern.test(entry.previousEventHash))
    || eventHash(entry) !== entry.eventHash) throw new Error("OPS_JOURNAL_INVALID");
  if (entry.phase === "terminal" ? entry.state !== "complete" || entry.outcome === null
    : entry.phase === "reconciliation" ? entry.state !== "uncertain" || entry.outcome !== "FAILED"
      : entry.outcome !== null || entry.state === "uncertain") throw new Error("OPS_JOURNAL_PHASE_INVALID");
  return entry;
}
function eventHash(event: RootOperationEvent): string { return operationHash({ domain: "areaforge.controlled-operation.journal.v2", ...event, eventHash: "" }); }
