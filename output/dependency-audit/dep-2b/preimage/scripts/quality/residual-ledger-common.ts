import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export type ResidualType =
  | "current-blocker"
  | "deferred-work"
  | "accepted-exception"
  | "monitoring-gap"
  | "release-follow-up"
  | "historical-reference"
  | "template-marker"
  | "closed-evidence";

export type TaskRefLifecycle = "active" | "backlog" | "done";
export type AcceptedExceptionStatus = "approved" | "revoked" | "expired" | "superseded";
export type EffectiveExceptionStatus = AcceptedExceptionStatus | null;

export interface TaskPromotionWaiverV2 {
  id: string;
  scope: string;
  reason: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export interface AcceptedExceptionV2 {
  status: AcceptedExceptionStatus;
  scope: string;
  reason: string;
  acceptedBy: string;
  acceptedAt: string;
  expiresAt: string;
  reopenConditions: string[];
  basisHash: string;
  sourceRef: string | null;
  revokedBy: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  supersededBy: string | null;
}

export interface ResidualItemV2 {
  id: string;
  type: ResidualType;
  reviewAt: string;
  currentImpact: string;
  executableNow: boolean;
  closeCondition: string;
  requiredEvidence: string;
  ownerSkills: string[];
  taskRefs: string[];
  taskPromotionWaiver: TaskPromotionWaiverV2 | null;
  acceptedException: AcceptedExceptionV2 | null;
}

export interface ResidualLedgerV2 {
  schemaVersion: 2;
  source: string;
  items: ResidualItemV2[];
}

export interface ResidualLedgerIssue {
  field: string;
  message: string;
}

export interface ResidualLedgerValidationOptions {
  root?: string;
  now?: Date;
  source?: string;
  validateTaskBindings?: boolean;
}

export interface ResidualLedgerReadOptions extends ResidualLedgerValidationOptions {
  file?: string;
}

export interface ResidualLedgerValidationResult {
  ledger: ResidualLedgerV2;
  issues: ResidualLedgerIssue[];
}

export interface ResidualProjectionOptions {
  root?: string;
  now?: Date;
}

export class ResidualLedgerValidationError extends Error {
  constructor(public readonly issues: ResidualLedgerIssue[]) {
    super(`invalid residual ledger schema V2: ${issues.length} issue(s)`);
    this.name = "ResidualLedgerValidationError";
  }
}

type JsonRecord = Record<string, unknown>;

const defaultLedgerPath = "docs/development/residual-risk-ledger.json";
const defaultSourcePath = "docs/development/residual-risk-ledger.md";
const itemKeys = [
  "id",
  "type",
  "reviewAt",
  "currentImpact",
  "executableNow",
  "closeCondition",
  "requiredEvidence",
  "ownerSkills",
  "taskRefs",
  "taskPromotionWaiver",
  "acceptedException",
];
const waiverKeys = ["id", "scope", "reason", "approvedBy", "approvedAt", "expiresAt"];
const exceptionKeys = [
  "status",
  "scope",
  "reason",
  "acceptedBy",
  "acceptedAt",
  "expiresAt",
  "reopenConditions",
  "basisHash",
  "sourceRef",
  "revokedBy",
  "revokedAt",
  "revocationReason",
  "supersededBy",
];
const allowedTypes = new Set<ResidualType>([
  "current-blocker",
  "deferred-work",
  "accepted-exception",
  "monitoring-gap",
  "release-follow-up",
  "historical-reference",
  "template-marker",
  "closed-evidence",
]);
const allowedPrefixes = new Set(["OPS", "REL", "SC", "UX", "AI", "DATA"]);
const allowedExceptionStatuses = new Set<AcceptedExceptionStatus>(["approved", "revoked", "expired", "superseded"]);

export function readResidualLedgerV2(options: ResidualLedgerReadOptions = {}): ResidualLedgerV2 {
  const root = canonicalRoot(options.root);
  const file = options.file ?? defaultLedgerPath;
  return parseResidualLedgerV2(readFileSync(path.resolve(root, file), "utf8"), options);
}

export function parseResidualLedgerV2(raw: string, options: ResidualLedgerValidationOptions = {}): ResidualLedgerV2 {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ResidualLedgerValidationError([{
      field: defaultLedgerPath,
      message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }]);
  }
  const result = validateResidualLedgerV2(value, options);
  if (result.issues.length > 0) throw new ResidualLedgerValidationError(result.issues);
  return result.ledger;
}

export function validateResidualLedgerV2(
  value: unknown,
  options: ResidualLedgerValidationOptions = {},
): ResidualLedgerValidationResult {
  const issues: ResidualLedgerIssue[] = [];
  const root = canonicalRoot(options.root);
  const now = options.now ?? new Date();
  const source = options.source ?? defaultSourcePath;
  if (!isRecord(value)) {
    issues.push({ field: defaultLedgerPath, message: "must contain a JSON object" });
    return { ledger: emptyLedger(), issues };
  }

  requireExactKeys(value, ["schemaVersion", "source", "items"], "ledger", issues);
  if (value.schemaVersion !== 2) issues.push({ field: "schemaVersion", message: "must be 2" });
  if (value.source !== source) issues.push({ field: "source", message: `must be ${source}` });
  if (!Array.isArray(value.items) || value.items.length === 0) {
    issues.push({ field: "items", message: "must contain at least one residual item" });
    return { ledger: emptyLedger(), issues };
  }

  const items: ResidualItemV2[] = [];
  const seen = new Set<string>();
  for (const [index, rawItem] of value.items.entries()) {
    const field = `items[${index}]`;
    if (!isRecord(rawItem)) {
      issues.push({ field, message: "must be an object" });
      continue;
    }
    requireExactKeys(rawItem, itemKeys, field, issues);
    const item = toResidualItem(rawItem, field, issues);
    items.push(item);
    validateResidualItem(item, field, seen, now, issues);
  }

  const ledger: ResidualLedgerV2 = { schemaVersion: 2, source, items };
  if (options.validateTaskBindings !== false) validateTaskBindings(ledger, root, now, issues);
  return { ledger, issues };
}

export function computeAcceptedExceptionBasisHash(item: ResidualItemV2): string {
  const exception = item.acceptedException;
  if (!exception) throw new Error(`${item.id} has no acceptedException basis`);
  const basis = {
    id: item.id,
    scope: exception.scope,
    reason: exception.reason,
    closeCondition: item.closeCondition,
    requiredEvidence: item.requiredEvidence,
    ownerSkills: item.ownerSkills,
  };
  return `sha256:${createHash("sha256").update(stableStringify(basis)).digest("hex")}`;
}

export function effectiveExecutableNow(
  item: ResidualItemV2,
  options: ResidualProjectionOptions = {},
): boolean {
  if (!item.executableNow) return false;
  const root = canonicalRoot(options.root);
  const now = options.now ?? new Date();
  if (item.taskRefs.some((taskRef) => activeTaskSupports(item.id, taskRef, root))) return true;
  return isTaskPromotionWaiverEffective(item, now);
}

export function effectiveExceptionStatus(
  item: ResidualItemV2,
  now = new Date(),
): EffectiveExceptionStatus {
  const exception = item.acceptedException;
  if (item.type !== "accepted-exception" || !exception) return null;
  if (exception.status === "approved" && isExpired(exception.expiresAt, now)) return "expired";
  return exception.status;
}

export function isAcceptedExceptionEffective(item: ResidualItemV2, now = new Date()): boolean {
  const exception = item.acceptedException;
  if (!exception || item.type !== "accepted-exception" || effectiveExceptionStatus(item, now) !== "approved") return false;
  if (!exception.sourceRef || exception.reopenConditions.length === 0) return false;
  if (exception.revokedBy || exception.revokedAt || exception.revocationReason || exception.supersededBy) return false;
  return /^sha256:[a-f0-9]{64}$/.test(exception.basisHash)
    && exception.basisHash === computeAcceptedExceptionBasisHash(item);
}

function toResidualItem(value: JsonRecord, field: string, issues: ResidualLedgerIssue[]): ResidualItemV2 {
  const id = requireString(value.id, `${field}.id`, issues) ?? `invalid-item-${field}`;
  const type = requireString(value.type, `${id}.type`, issues) ?? "";
  const waiver = parseWaiver(value.taskPromotionWaiver, `${id}.taskPromotionWaiver`, issues);
  const exception = parseAcceptedException(value.acceptedException, `${id}.acceptedException`, issues);
  if (typeof value.executableNow !== "boolean") {
    issues.push({ field: `${id}.executableNow`, message: "must be a boolean" });
  }
  return {
    id,
    type: type as ResidualType,
    reviewAt: requireString(value.reviewAt, `${id}.reviewAt`, issues) ?? "",
    currentImpact: requireString(value.currentImpact, `${id}.currentImpact`, issues) ?? "",
    executableNow: value.executableNow === true,
    closeCondition: requireString(value.closeCondition, `${id}.closeCondition`, issues) ?? "",
    requiredEvidence: requireString(value.requiredEvidence, `${id}.requiredEvidence`, issues) ?? "",
    ownerSkills: requireStringArray(value.ownerSkills, `${id}.ownerSkills`, issues, false),
    taskRefs: requireStringArray(value.taskRefs, `${id}.taskRefs`, issues, true),
    taskPromotionWaiver: waiver,
    acceptedException: exception,
  };
}

function parseWaiver(value: unknown, field: string, issues: ResidualLedgerIssue[]): TaskPromotionWaiverV2 | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    issues.push({ field, message: "must be null or an object" });
    return null;
  }
  requireExactKeys(value, waiverKeys, field, issues);
  return {
    id: requireString(value.id, `${field}.id`, issues) ?? "",
    scope: requireString(value.scope, `${field}.scope`, issues) ?? "",
    reason: requireString(value.reason, `${field}.reason`, issues) ?? "",
    approvedBy: requireString(value.approvedBy, `${field}.approvedBy`, issues) ?? "",
    approvedAt: requireString(value.approvedAt, `${field}.approvedAt`, issues) ?? "",
    expiresAt: requireString(value.expiresAt, `${field}.expiresAt`, issues) ?? "",
  };
}

function parseAcceptedException(value: unknown, field: string, issues: ResidualLedgerIssue[]): AcceptedExceptionV2 | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    issues.push({ field, message: "must be null or an object" });
    return null;
  }
  requireExactKeys(value, exceptionKeys, field, issues);
  const status = requireString(value.status, `${field}.status`, issues) ?? "";
  validateNullableString(value.sourceRef, `${field}.sourceRef`, issues);
  validateNullableString(value.revokedBy, `${field}.revokedBy`, issues);
  validateNullableString(value.revokedAt, `${field}.revokedAt`, issues);
  validateNullableString(value.revocationReason, `${field}.revocationReason`, issues);
  validateNullableString(value.supersededBy, `${field}.supersededBy`, issues);
  return {
    status: status as AcceptedExceptionStatus,
    scope: requireString(value.scope, `${field}.scope`, issues) ?? "",
    reason: requireString(value.reason, `${field}.reason`, issues) ?? "",
    acceptedBy: requireString(value.acceptedBy, `${field}.acceptedBy`, issues) ?? "",
    acceptedAt: requireString(value.acceptedAt, `${field}.acceptedAt`, issues) ?? "",
    expiresAt: requireString(value.expiresAt, `${field}.expiresAt`, issues) ?? "",
    reopenConditions: requireStringArray(value.reopenConditions, `${field}.reopenConditions`, issues, false),
    basisHash: requireString(value.basisHash, `${field}.basisHash`, issues) ?? "",
    sourceRef: nullableString(value.sourceRef),
    revokedBy: nullableString(value.revokedBy),
    revokedAt: nullableString(value.revokedAt),
    revocationReason: nullableString(value.revocationReason),
    supersededBy: nullableString(value.supersededBy),
  };
}

function validateResidualItem(
  item: ResidualItemV2,
  field: string,
  seen: Set<string>,
  now: Date,
  issues: ResidualLedgerIssue[],
): void {
  const prefix = item.id.match(/^AF-RISK-([A-Z]+)-\d{3}$/)?.[1] ?? "";
  if (!prefix || !allowedPrefixes.has(prefix)) {
    issues.push({ field: `${field}.id`, message: "must match AF-RISK-(OPS|REL|SC|UX|AI|DATA)-NNN" });
  }
  if (seen.has(item.id)) issues.push({ field: `${field}.id`, message: "duplicate residual ID" });
  seen.add(item.id);
  if (!allowedTypes.has(item.type)) issues.push({ field: `${item.id}.type`, message: `invalid type ${item.type}` });
  parseDate(item.reviewAt, `${item.id}.reviewAt`, issues);
  if (new Set(item.ownerSkills).size !== item.ownerSkills.length) {
    issues.push({ field: `${item.id}.ownerSkills`, message: "must not contain duplicates" });
  }
  if (new Set(item.taskRefs).size !== item.taskRefs.length) {
    issues.push({ field: `${item.id}.taskRefs`, message: "must not contain duplicates" });
  }
  validateAcceptedException(item, now, issues);
}

function validateTaskBindings(
  ledger: ResidualLedgerV2,
  root: string,
  now: Date,
  issues: ResidualLedgerIssue[],
): void {
  for (const item of ledger.items) {
    let activeTaskSupportsExecution = false;
    for (const [index, taskRef] of item.taskRefs.entries()) {
      const field = `${item.id}.taskRefs[${index}]`;
      const taskType = validateTaskRef(taskRef, field, root, issues);
      if (!taskType) continue;
      const residualIds = parseTaskResidualRiskIds(taskRef, field, root, issues);
      if (taskType === "active" && residualIds.includes(item.id)) activeTaskSupportsExecution = true;
    }
    const waiverSupportsExecution = validateTaskPromotionWaiver(item, now, issues);
    if (item.executableNow && !activeTaskSupportsExecution && !waiverSupportsExecution) {
      issues.push({
        field: `${item.id}.executableNow`,
        message: "true requires a tasks/active/*.md taskRef with reciprocal residualRiskIds or a current taskPromotionWaiver",
      });
    }
  }
}

function validateTaskRef(
  taskRef: string,
  field: string,
  root: string,
  issues: ResidualLedgerIssue[],
): TaskRefLifecycle | null {
  if (taskRef.includes("\\") || path.posix.isAbsolute(taskRef) || path.posix.normalize(taskRef) !== taskRef || taskRef.includes("\0")) {
    issues.push({ field, message: "must be a normalized safe relative path" });
    return null;
  }
  const absolute = path.resolve(root, taskRef);
  if (!isWithinRoot(absolute, root)) {
    issues.push({ field, message: "must not escape the repository root" });
    return null;
  }
  const match = taskRef.match(/^tasks\/(active|backlog|done)\/[^/]+\.md$/);
  if (!match) {
    issues.push({ field, message: "must reference tasks/(active|backlog|done)/*.md" });
    return null;
  }
  let current = root;
  try {
    for (const segment of taskRef.split("/")) {
      current = path.join(current, segment);
      if (lstatSync(current).isSymbolicLink()) {
        issues.push({ field, message: "must not traverse or reference a symlink" });
        return null;
      }
    }
    if (!lstatSync(absolute).isFile()) {
      issues.push({ field, message: "must reference a regular file" });
      return null;
    }
    if (!isWithinRoot(realpathSync(absolute), root)) {
      issues.push({ field, message: "resolved path must remain within the repository root" });
      return null;
    }
  } catch (error) {
    issues.push({ field, message: `must reference an existing regular file: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
  return match[1] as TaskRefLifecycle;
}

function parseTaskResidualRiskIds(
  taskRef: string,
  field: string,
  root: string,
  issues: ResidualLedgerIssue[],
): string[] {
  const yaml = readFileSync(path.resolve(root, taskRef), "utf8").match(/```yaml\s*\n([\s\S]*?)\n```/)?.[1];
  if (!yaml) {
    issues.push({ field, message: "task must contain a yaml metadata block" });
    return [];
  }
  const lines = yaml.split(/\r?\n/);
  const index = lines.findIndex((line) => /^residualRiskIds:\s*/.test(line));
  if (index < 0) {
    issues.push({ field, message: "task yaml must contain residualRiskIds" });
    return [];
  }
  const inline = lines[index].replace(/^residualRiskIds:\s*/, "").trim();
  if (inline === "[]") return [];
  if (inline !== "") {
    issues.push({ field, message: "task yaml residualRiskIds must be a block list or []" });
    return [];
  }
  const ids: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const listItem = line.match(/^\s{2}-\s+(.+)$/);
    if (listItem) {
      ids.push(listItem[1].trim());
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9]*:/.test(line) || (line.trim() !== "" && !/^\s/.test(line))) break;
  }
  return ids;
}

function validateTaskPromotionWaiver(
  item: ResidualItemV2,
  now: Date,
  issues: ResidualLedgerIssue[],
): boolean {
  const waiver = item.taskPromotionWaiver;
  if (!waiver) return false;
  const field = `${item.id}.taskPromotionWaiver`;
  const before = issues.length;
  const approvedAt = parseDateTime(waiver.approvedAt, `${field}.approvedAt`, issues);
  const expiresAt = parseDateTime(waiver.expiresAt, `${field}.expiresAt`, issues);
  const reviewAt = parseDate(item.reviewAt, `${item.id}.reviewAt`, issues);
  if (approvedAt && isFuture(waiver.approvedAt, now)) {
    issues.push({ field: `${field}.approvedAt`, message: "must not be in the future" });
  }
  if (approvedAt && expiresAt && approvedAt.getTime() > expiresAt.getTime()) {
    issues.push({ field: `${field}.approvedAt`, message: "must not be after expiresAt" });
  }
  if (expiresAt && reviewAt && datePart(waiver.expiresAt) > item.reviewAt) {
    issues.push({ field: `${field}.expiresAt`, message: "must be on or before item.reviewAt" });
  }
  if (expiresAt && isExpired(waiver.expiresAt, now)) {
    issues.push({ field: `${field}.expiresAt`, message: "must not be expired on the current date" });
  }
  return issues.length === before;
}

function isTaskPromotionWaiverEffective(item: ResidualItemV2, now: Date): boolean {
  const issues: ResidualLedgerIssue[] = [];
  return validateTaskPromotionWaiver(item, now, issues) && issues.length === 0;
}

function validateAcceptedException(item: ResidualItemV2, now: Date, issues: ResidualLedgerIssue[]): void {
  const exception = item.acceptedException;
  if (item.type === "accepted-exception" && !exception) {
    issues.push({ field: `${item.id}.acceptedException`, message: "accepted-exception items require an object" });
    return;
  }
  if (item.type !== "accepted-exception" && exception) {
    issues.push({ field: `${item.id}.acceptedException`, message: "must be null unless type is accepted-exception" });
    return;
  }
  if (!exception) return;

  const field = `${item.id}.acceptedException`;
  if (!allowedExceptionStatuses.has(exception.status)) {
    issues.push({ field: `${field}.status`, message: "must be approved, revoked, expired, or superseded" });
  }
  const acceptedAt = parseDateTime(exception.acceptedAt, `${field}.acceptedAt`, issues);
  const expiresAt = parseDateTime(exception.expiresAt, `${field}.expiresAt`, issues);
  if (acceptedAt && isFuture(exception.acceptedAt, now)) {
    issues.push({ field: `${field}.acceptedAt`, message: "must not be in the future" });
  }
  if (acceptedAt && expiresAt && acceptedAt.getTime() > expiresAt.getTime()) {
    issues.push({ field: `${field}.acceptedAt`, message: "must not be after expiresAt" });
  }
  validateBasisHash(item, issues);
  const revokedAt = exception.revokedAt
    ? parseDateTime(exception.revokedAt, `${field}.revokedAt`, issues)
    : null;

  if (!allowedExceptionStatuses.has(exception.status)) return;
  if (exception.status === "approved") {
    if (!exception.sourceRef) issues.push({ field: `${field}.sourceRef`, message: "must be a non-empty string" });
    if (isExpired(exception.expiresAt, now)) {
      issues.push({ field: `${field}.expiresAt`, message: "approved exception must be current and unexpired" });
    }
    requireNull(exception, ["revokedBy", "revokedAt", "revocationReason", "supersededBy"], field, issues);
  } else if (exception.status === "revoked") {
    if (!exception.revokedBy) issues.push({ field: `${field}.revokedBy`, message: "must be a non-empty string" });
    if (!exception.revocationReason) issues.push({ field: `${field}.revocationReason`, message: "must be a non-empty string" });
    if (!revokedAt) issues.push({ field: `${field}.revokedAt`, message: "revoked status requires a valid timestamp" });
    if (revokedAt && isFuture(exception.revokedAt, now)) {
      issues.push({ field: `${field}.revokedAt`, message: "must not be in the future" });
    }
    if (acceptedAt && revokedAt && revokedAt.getTime() < acceptedAt.getTime()) {
      issues.push({ field: `${field}.revokedAt`, message: "must not be before acceptedAt" });
    }
    requireNull(exception, ["supersededBy"], field, issues);
  } else if (exception.status === "expired") {
    if (!isExpired(exception.expiresAt, now)) {
      issues.push({ field: `${field}.expiresAt`, message: "expired status requires a past expiresAt" });
    }
    requireNull(exception, ["revokedBy", "revokedAt", "revocationReason", "supersededBy"], field, issues);
  } else {
    if (!exception.supersededBy) issues.push({ field: `${field}.supersededBy`, message: "must be a non-empty string" });
    requireNull(exception, ["revokedBy", "revokedAt", "revocationReason"], field, issues);
  }
}

function validateBasisHash(item: ResidualItemV2, issues: ResidualLedgerIssue[]): void {
  const basisHash = item.acceptedException?.basisHash ?? "";
  const field = `${item.id}.acceptedException.basisHash`;
  if (!/^sha256:[a-f0-9]{64}$/.test(basisHash)) {
    issues.push({ field, message: "must use sha256:<64 lowercase hex>" });
    return;
  }
  if (basisHash !== computeAcceptedExceptionBasisHash(item)) {
    issues.push({ field, message: "does not match the canonical accepted-exception basis" });
  }
}

function activeTaskSupports(residualId: string, taskRef: string, root: string): boolean {
  const issues: ResidualLedgerIssue[] = [];
  if (validateTaskRef(taskRef, taskRef, root, issues) !== "active") return false;
  return parseTaskResidualRiskIds(taskRef, taskRef, root, issues).includes(residualId) && issues.length === 0;
}

function requireExactKeys(value: JsonRecord, expected: string[], field: string, issues: ResidualLedgerIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    issues.push({ field, message: `must contain exact keys: ${expected.join(", ")}` });
  }
}

function requireString(value: unknown, field: string, issues: ResidualLedgerIssue[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ field, message: "must be a non-empty string" });
    return null;
  }
  return value;
}

function requireStringArray(
  value: unknown,
  field: string,
  issues: ResidualLedgerIssue[],
  allowEmpty: boolean,
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    issues.push({ field, message: `must be a${allowEmpty ? "" : " non-empty"} string array` });
    return [];
  }
  return value as string[];
}

function validateNullableString(value: unknown, field: string, issues: ResidualLedgerIssue[]): void {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) {
    issues.push({ field, message: "must be null or a non-empty string" });
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function requireNull(
  value: AcceptedExceptionV2,
  keys: Array<keyof AcceptedExceptionV2>,
  field: string,
  issues: ResidualLedgerIssue[],
): void {
  for (const key of keys) {
    if (value[key] !== null) issues.push({ field: `${field}.${key}`, message: `must be null for status ${value.status}` });
  }
}

function parseDate(value: unknown, field: string, issues: ResidualLedgerIssue[]): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push({ field, message: "must be YYYY-MM-DD" });
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    issues.push({ field, message: "must be a valid calendar date" });
    return null;
  }
  return parsed;
}

function parseDateTime(value: unknown, field: string, issues: ResidualLedgerIssue[]): Date | null {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) {
    issues.push({ field, message: "must be YYYY-MM-DD or an ISO 8601 timestamp with an explicit timezone" });
    return null;
  }
  const parsed = new Date(value.length === 10 ? `${value}T23:59:59.999Z` : value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    issues.push({ field, message: "must be a valid date or timestamp" });
    return null;
  }
  return parsed;
}

function isExpired(value: string, now: Date): boolean {
  if (value.length === 10) return value < localDate(now);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() < now.getTime();
}

function isFuture(value: string | null, now: Date): boolean {
  if (!value) return true;
  if (value.length === 10) return value > localDate(now);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) || parsed.getTime() > now.getTime();
}

function localDate(now: Date): string {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isWithinRoot(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function canonicalRoot(root = process.cwd()): string {
  return realpathSync(path.resolve(root));
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyLedger(): ResidualLedgerV2 {
  return { schemaVersion: 2, source: defaultSourcePath, items: [] };
}
