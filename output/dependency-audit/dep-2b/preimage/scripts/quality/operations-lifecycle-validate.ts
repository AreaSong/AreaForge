import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  readResidualLedgerV2,
  validateResidualLedgerV2,
  type ResidualLedgerV2,
} from "./residual-ledger-common";

type JsonRecord = Record<string, unknown>;
export interface ValidationIssue {
  field: string;
  message: string;
}
const contractPath = "docs/development/operations-lifecycle.json";
const residualPath = "docs/development/residual-risk-ledger.json";
const topLevelKeys = [
  "schemaVersion",
  "mode",
  "effectiveAt",
  "reviewAt",
  "sourcePrinciples",
  "doesNotProve",
  "slos",
  "incidentLifecycle",
  "capabilities",
  "safetyFacts",
];
const sloKeys = [
  "id",
  "name",
  "category",
  "status",
  "target",
  "windowSeconds",
  "measurementSource",
  "residualRiskIds",
  "notes",
];
const targetKeys = ["operator", "value", "unit"];
const measurementKeys = ["kind", "paths", "commands", "fields", "metrics"];
const incidentKeys = ["statuses", "activeStatuses", "resolvedStatus", "allowedTransitions"];
const transitionKeys = ["from", "to", "requires"];
const capabilityKeys = [
  "id",
  "name",
  "lifecycleStatus",
  "executionState",
  "owner",
  "entrypoint",
  "closeCondition",
  "residualRiskIds",
  "notes",
];
const safetyKeys = [
  "readOnly",
  "networkRequested",
  "productionAccessed",
  "serverCommandAttempted",
  "productionWriteAttempted",
  "databaseWriteAttempted",
  "secretFileReadAttempted",
  "secretValuePrinted",
  "residualLedgerUpdated",
  "incidentRuntimeChanged",
];
const sloCategories = new Set([
  "health_observation",
  "authenticated_readonly_smoke_freshness",
  "security_zero_tolerance",
  "availability",
  "latency",
  "rto",
  "rpo",
]);
const activeSloCategories = new Set([
  "health_observation",
  "authenticated_readonly_smoke_freshness",
  "security_zero_tolerance",
]);
const draftSloCategories = new Set(["availability", "latency", "rto", "rpo"]);
const incidentStatuses = new Set(["open", "mitigated", "follow-up", "resolved"]);
const activeIncidentStatuses = new Set(["open", "mitigated", "follow-up"]);
const requiredTransitions = new Set([
  "open->mitigated",
  "open->follow-up",
  "open->resolved",
  "mitigated->open",
  "mitigated->follow-up",
  "mitigated->resolved",
  "follow-up->open",
  "follow-up->mitigated",
  "follow-up->resolved",
]);
const lifecycleStatuses = new Set(["planned", "active", "deprecated", "retiring", "archived"]);
const executionStates = new Set(["closed", "preview_only", "fixture_only", "confirmed_apply", "production_scoped", "suspended"]);
const closingLifecycleStatuses = new Set(["deprecated", "retiring", "archived"]);
const secretPatterns = [
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { label: "bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i },
  { label: "GitHub token", pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{16,}\b/i },
  { label: "database URL", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/i },
  { label: "sensitive assignment", pattern: /\b(?:DATABASE_URL|AUTH_SESSION_SECRET|AI_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|password|passwd|api[_-]?key)\s*[:=]\s*[^\s,;]+/i },
];
const forbiddenEvidenceCommands = /(?:^|\s)(?:ssh|scp|rsync|curl|wget)\b|\b(?:migrate|deploy|restore|rollback|apply)\b/i;
const forbiddenEvidencePaths = /(?:^|\/)(?:\.env(?:\.|$)|id_(?:rsa|ed25519)|credentials?(?:\.|$))/i;

export function validateOperationsLifecycle(body: unknown, ledger: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(body)) return [{ field: "contract", message: "must be a JSON object" }];
  const ledgerValidation = validateResidualLedgerV2(ledger, { validateTaskBindings: false });
  if (ledgerValidation.issues.length > 0) {
    return ledgerValidation.issues.map((issue) => ({
      field: `residualLedger.${issue.field}`,
      message: issue.message,
    }));
  }

  exactKeys(body, topLevelKeys, "contract", issues);
  requireValue(body.schemaVersion, 1, "schemaVersion", issues);
  requireValue(body.mode, "areaforge_operations_lifecycle", "mode", issues);
  validateDates(body.effectiveAt, body.reviewAt, issues);
  stringArray(body.sourcePrinciples, "sourcePrinciples", issues, 2);
  stringArray(body.doesNotProve, "doesNotProve", issues, 4);

  const residuals = residualMap(ledgerValidation.ledger, issues);
  const seenIds = new Set<string>();
  validateSlos(body.slos, residuals, seenIds, issues);
  validateIncidentLifecycle(body.incidentLifecycle, issues);
  validateCapabilities(body.capabilities, residuals, seenIds, issues);
  validateSafetyFacts(body.safetyFacts, issues);
  scanSecrets(body, issues);
  return issues;
}
function validateDates(effectiveAt: unknown, reviewAt: unknown, issues: ValidationIssue[]): void {
  const effective = parseDate(effectiveAt, "effectiveAt", issues);
  const review = parseDate(reviewAt, "reviewAt", issues);
  if (effective !== null && review !== null && review <= effective) {
    issues.push({ field: "reviewAt", message: "must be later than effectiveAt" });
  }
}
function parseDate(value: unknown, field: string, issues: ValidationIssue[]): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push({ field, message: "must be a valid YYYY-MM-DD date" });
    return null;
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    issues.push({ field, message: "must be a valid calendar date" });
    return null;
  }
  return timestamp;
}
function validateSlos(
  value: unknown,
  residuals: Map<string, string>,
  seenIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field: "slos", message: "must be a non-empty array" });
    return;
  }
  const activeCategories = new Set<string>();
  const draftCategories = new Set<string>();
  for (const [index, item] of value.entries()) {
    const field = `slos[${index}]`;
    if (!isRecord(item)) {
      issues.push({ field, message: "must be an object" });
      continue;
    }
    exactKeys(item, sloKeys, field, issues);
    const id = requireId(item.id, /^AF-SLO-[A-Z]+-\d{3}$/, `${field}.id`, seenIds, issues);
    requireString(item.name, `${field}.name`, issues);
    const category = enumValue(item.category, sloCategories, `${field}.category`, issues);
    const status = enumValue(item.status, new Set(["active", "draft"]), `${field}.status`, issues);
    validateTarget(item.target, category, `${field}.target`, issues);
    if (!Number.isInteger(item.windowSeconds) || Number(item.windowSeconds) <= 0) {
      issues.push({ field: `${field}.windowSeconds`, message: "must be a positive integer" });
    }
    validateMeasurementSource(item.measurementSource, category, status, `${field}.measurementSource`, issues);
    validateResidualIds(item.residualRiskIds, residuals, status === "active", `${field}.residualRiskIds`, issues);
    requireString(item.notes, `${field}.notes`, issues);
    if (id && category && status === "active") activeCategories.add(category);
    if (id && category && status === "draft") draftCategories.add(category);
  }
  requireExactSet(activeCategories, activeSloCategories, "slos.activeCategories", issues);
  requireExactSet(draftCategories, draftSloCategories, "slos.draftCategories", issues);
}
function validateTarget(value: unknown, category: string | null, field: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  exactKeys(value, targetKeys, field, issues);
  enumValue(value.operator, new Set(["lte", "gte", "eq"]), `${field}.operator`, issues);
  if (typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0) {
    issues.push({ field: `${field}.value`, message: "must be a finite non-negative number" });
  }
  enumValue(value.unit, new Set(["seconds", "percent", "count"]), `${field}.unit`, issues);
  const expected: Record<string, [string, string]> = {
    health_observation: ["lte", "seconds"],
    authenticated_readonly_smoke_freshness: ["lte", "seconds"],
    security_zero_tolerance: ["eq", "count"],
    availability: ["gte", "percent"],
    latency: ["lte", "seconds"],
    rto: ["lte", "seconds"],
    rpo: ["lte", "seconds"],
  };
  if (category && expected[category]) {
    const [operator, unit] = expected[category];
    requireValue(value.operator, operator, `${field}.operator`, issues);
    requireValue(value.unit, unit, `${field}.unit`, issues);
  }
  if (category === "security_zero_tolerance") requireValue(value.value, 0, `${field}.value`, issues);
}
function validateMeasurementSource(
  value: unknown,
  category: string | null,
  status: string | null,
  field: string,
  issues: ValidationIssue[],
): void {
  if (value === null) {
    if (status === "active") issues.push({ field, message: "active SLO must define a measurement source" });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ field, message: "must be null or an object" });
    return;
  }
  exactKeys(value, measurementKeys, field, issues);
  const kind = enumValue(value.kind, new Set(["record", "command", "metrics"]), `${field}.kind`, issues);
  const paths = stringArray(value.paths, `${field}.paths`, issues, 0);
  const commands = stringArray(value.commands, `${field}.commands`, issues, 0);
  const fields = stringArray(value.fields, `${field}.fields`, issues, 1);
  const metrics = stringArray(value.metrics, `${field}.metrics`, issues, 0);
  if (status === "active" && paths.length === 0 && commands.length === 0 && metrics.length === 0) {
    issues.push({ field, message: "active SLO measurement source must identify record, command, or metric evidence" });
  }
  if (kind === "metrics" && metrics.length === 0) {
    issues.push({ field: `${field}.metrics`, message: "metrics source must list at least one metric" });
  }
  if (status === "active" && (category === "availability" || category === "latency") && (kind !== "metrics" || metrics.length === 0)) {
    issues.push({ field, message: "active availability or latency SLO requires a non-empty metrics source" });
  }
  for (const [index, command] of commands.entries()) {
    if (forbiddenEvidenceCommands.test(command)) {
      issues.push({ field: `${field}.commands[${index}]`, message: "must remain a local read-only evidence command" });
    }
  }
  for (const [index, sourcePath] of paths.entries()) {
    if (forbiddenEvidencePaths.test(sourcePath)) {
      issues.push({ field: `${field}.paths[${index}]`, message: "must not reference a secret-bearing path" });
    }
  }
}
function validateIncidentLifecycle(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "incidentLifecycle", message: "must be an object" });
    return;
  }
  exactKeys(value, incidentKeys, "incidentLifecycle", issues);
  const statuses = new Set(stringArray(value.statuses, "incidentLifecycle.statuses", issues, 4));
  const active = new Set(stringArray(value.activeStatuses, "incidentLifecycle.activeStatuses", issues, 3));
  requireExactSet(statuses, incidentStatuses, "incidentLifecycle.statuses", issues);
  requireExactSet(active, activeIncidentStatuses, "incidentLifecycle.activeStatuses", issues);
  requireValue(value.resolvedStatus, "resolved", "incidentLifecycle.resolvedStatus", issues);
  if (!Array.isArray(value.allowedTransitions)) {
    issues.push({ field: "incidentLifecycle.allowedTransitions", message: "must be an array" });
    return;
  }
  const transitions = new Set<string>();
  for (const [index, transition] of value.allowedTransitions.entries()) {
    const field = `incidentLifecycle.allowedTransitions[${index}]`;
    if (!isRecord(transition)) {
      issues.push({ field, message: "must be an object" });
      continue;
    }
    exactKeys(transition, transitionKeys, field, issues);
    const from = enumValue(transition.from, incidentStatuses, `${field}.from`, issues);
    const to = enumValue(transition.to, incidentStatuses, `${field}.to`, issues);
    stringArray(transition.requires, `${field}.requires`, issues, 1);
    if (from && to) {
      if (from === to) issues.push({ field, message: "self transition is not allowed" });
      const key = `${from}->${to}`;
      if (transitions.has(key)) issues.push({ field, message: `duplicate transition ${key}` });
      transitions.add(key);
    }
  }
  requireExactSet(transitions, requiredTransitions, "incidentLifecycle.allowedTransitions", issues);
}
function validateCapabilities(
  value: unknown,
  residuals: Map<string, string>,
  seenIds: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ field: "capabilities", message: "must be a non-empty array" });
    return;
  }
  for (const [index, item] of value.entries()) {
    const field = `capabilities[${index}]`;
    if (!isRecord(item)) {
      issues.push({ field, message: "must be an object" });
      continue;
    }
    exactKeys(item, capabilityKeys, field, issues);
    requireId(item.id, /^AF-CAP-[A-Z0-9-]+$/, `${field}.id`, seenIds, issues);
    requireString(item.name, `${field}.name`, issues);
    const lifecycle = enumValue(item.lifecycleStatus, lifecycleStatuses, `${field}.lifecycleStatus`, issues);
    enumValue(item.executionState, executionStates, `${field}.executionState`, issues);
    requireString(item.owner, `${field}.owner`, issues);
    requireString(item.entrypoint, `${field}.entrypoint`, issues);
    if (closingLifecycleStatuses.has(lifecycle ?? "")) {
      requireString(item.closeCondition, `${field}.closeCondition`, issues);
    } else if (item.closeCondition !== null) {
      issues.push({ field: `${field}.closeCondition`, message: "must be null until lifecycle is deprecated, retiring, or archived" });
    }
    validateResidualIds(item.residualRiskIds, residuals, lifecycle === "active", `${field}.residualRiskIds`, issues);
    requireString(item.notes, `${field}.notes`, issues);
  }
}
function validateResidualIds(
  value: unknown,
  residuals: Map<string, string>,
  active: boolean,
  field: string,
  issues: ValidationIssue[],
): void {
  const ids = stringArray(value, field, issues, 1);
  const types: string[] = [];
  for (const [index, id] of ids.entries()) {
    if (!/^AF-RISK-(?:OPS|REL|SC|UX|AI)-\d{3}$/.test(id)) {
      issues.push({ field: `${field}[${index}]`, message: "must be a valid residual risk ID" });
      continue;
    }
    const type = residuals.get(id);
    if (!type) issues.push({ field: `${field}[${index}]`, message: `residual ID does not exist: ${id}` });
    else types.push(type);
  }
  if (active && types.length > 0 && types.every((type) => type === "closed-evidence")) {
    issues.push({ field, message: "active object must not bind only closed-evidence residuals" });
  }
}
function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  exactKeys(value, safetyKeys, "safetyFacts", issues);
  requireValue(value.readOnly, true, "safetyFacts.readOnly", issues);
  for (const key of safetyKeys.filter((item) => item !== "readOnly")) {
    requireValue(value[key], false, `safetyFacts.${key}`, issues);
  }
}
function residualMap(value: ResidualLedgerV2, issues: ValidationIssue[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const [index, item] of value.items.entries()) {
    if (result.has(item.id)) issues.push({ field: `residualLedger.items[${index}].id`, message: "duplicate residual ID" });
    result.set(item.id, item.type);
  }
  return result;
}
function exactKeys(value: JsonRecord, expected: string[], field: string, issues: ValidationIssue[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join("\0") !== wanted.join("\0")) {
    issues.push({ field, message: `must contain exact fields: ${expected.join(", ")}` });
  }
}
function requireId(
  value: unknown,
  pattern: RegExp,
  field: string,
  seen: Set<string>,
  issues: ValidationIssue[],
): string | null {
  if (typeof value !== "string" || !pattern.test(value)) {
    issues.push({ field, message: `must match ${pattern}` });
    return null;
  }
  if (seen.has(value)) issues.push({ field, message: `duplicate ID: ${value}` });
  seen.add(value);
  return value;
}

function requireString(value: unknown, field: string, issues: ValidationIssue[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ field, message: "must be a non-empty string" });
    return null;
  }
  return value;
}

function stringArray(
  value: unknown,
  field: string,
  issues: ValidationIssue[],
  minimum: number,
): string[] {
  if (!Array.isArray(value)) {
    issues.push({ field, message: "must be an array" });
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      issues.push({ field: `${field}[${index}]`, message: "must be a non-empty string" });
      continue;
    }
    if (seen.has(item)) issues.push({ field: `${field}[${index}]`, message: `duplicate value: ${item}` });
    seen.add(item);
    result.push(item);
  }
  if (result.length < minimum) issues.push({ field, message: `must contain at least ${minimum} item(s)` });
  return result;
}

function enumValue(value: unknown, allowed: Set<string>, field: string, issues: ValidationIssue[]): string | null {
  if (typeof value !== "string" || !allowed.has(value)) {
    issues.push({ field, message: `must be one of: ${[...allowed].join(", ")}` });
    return null;
  }
  return value;
}

function requireValue(value: unknown, expected: unknown, field: string, issues: ValidationIssue[]): void {
  if (value !== expected) issues.push({ field, message: `must be ${String(expected)}` });
}

function requireExactSet(actual: Set<string>, expected: Set<string>, field: string, issues: ValidationIssue[]): void {
  if (actual.size !== expected.size || [...actual].some((item) => !expected.has(item))) {
    issues.push({ field, message: `must contain exactly: ${[...expected].join(", ")}` });
  }
}

function scanSecrets(value: unknown, issues: ValidationIssue[]): void {
  walkStrings(value, "contract", (text, field) => {
    for (const item of secretPatterns) {
      if (item.pattern.test(text)) issues.push({ field, message: `must not contain secret-like ${item.label} content` });
    }
  });
}

function walkStrings(value: unknown, field: string, visit: (text: string, field: string) => void): void {
  if (typeof value === "string") {
    visit(value, field);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${field}[${index}]`, visit));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) walkStrings(item, `${field}.${key}`, visit);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function main(): void {
  const input = path.resolve(process.cwd(), process.argv[2] ?? contractPath);
  const ledger = path.resolve(process.cwd(), process.argv[3] ?? residualPath);
  const issues: ValidationIssue[] = [];
  if (!existsSync(input)) issues.push({ field: input, message: "contract file does not exist" });
  if (!existsSync(ledger)) issues.push({ field: ledger, message: "residual ledger file does not exist" });
  if (issues.length === 0) {
    try {
      const residualLedger = readResidualLedgerV2({ root: process.cwd(), file: ledger });
      issues.push(...validateOperationsLifecycle(readJson(input), residualLedger));
    } catch (error) {
      issues.push({ field: "JSON", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (issues.length > 0) {
    console.error(`operations lifecycle validation failed: ${issues.length} issue(s).`);
    for (const issue of issues) console.error(`- ${issue.field}: ${issue.message}`);
    process.exitCode = 1;
    return;
  }
  console.log("operations lifecycle validation passed: exact schema, SLO sources, incident transitions, capability states, residual bindings, secret scan, and read-only safety facts are valid.");
  console.log("safetyFacts: readOnly=true networkRequested=false productionAccessed=false productionWriteAttempted=false databaseWriteAttempted=false secretFileReadAttempted=false residualLedgerUpdated=false incidentRuntimeChanged=false");
}

if (process.argv[1]?.endsWith("operations-lifecycle-validate.ts")) main();
