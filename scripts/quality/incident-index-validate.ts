import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildIncidentIndex, resolveIncidentIndexSourceRoot, type IncidentIndex } from "./incident-index-common";
import { scanForSecrets, sha256, type ValidationIssue } from "./record-validator-common";

const indexPathArg = process.argv[2];
const sourceRootArg = process.argv[3];
const topLevelKeys = [
  "schemaVersion", "mode", "sourceRoot", "sourcePattern", "sourceSetSha256", "latestIncidentId", "incidents", "doesNotProve", "safetyFacts",
].sort();
const incidentKeys = [
  "incidentId", "recordPath", "recordSha256", "detectedAt", "recordedAt", "environment", "severity", "incidentType",
  "publicHealthStatus", "rollbackDecision", "residualRiskIds", "followUpTasks",
].sort();
const safetyKeys = [
  "readOnly", "networkRequested", "serverCommandAttempted", "productionWriteAttempted", "secretValuePrinted", "indexWritten",
  "incidentActionExecuted", "residualLedgerUpdated",
].sort();

function main(): void {
  if (!indexPathArg) {
    console.error("Usage: pnpm exec tsx scripts/quality/incident-index-validate.ts <index.json> [source-root]");
    process.exit(2);
  }

  const raw = readStrictUtf8File(path.resolve(indexPathArg));
  const issues: ValidationIssue[] = [];
  let parsed: IncidentIndex;
  try {
    parsed = JSON.parse(raw) as IncidentIndex;
  } catch {
    console.error("FAIL index: must be valid JSON");
    process.exit(1);
  }

  validateShape(raw, parsed, issues);
  if (issues.length === 0) {
    try {
      const rebuilt = buildIncidentIndex(resolveIncidentIndexSourceRoot(parsed.sourceRoot, sourceRootArg));
      if (JSON.stringify(parsed) !== JSON.stringify(rebuilt)) {
        issues.push({ field: "index", message: "does not match a deterministic rebuild from current source records" });
      }
    } catch (error) {
      issues.push({ field: "sourceRoot", message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`incident index validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }

  console.log("incident index validation passed: the deterministic read-only index matches all current resolved incident records.");
  console.log(`incidentIndexEvidenceHash: sha256:${sha256(raw)}`);
  console.log(`sourceSetSha256: ${parsed.sourceSetSha256}`);
  console.log("safetyFacts: readOnlyValidation=true networkRequested=false serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false indexWritten=false incidentActionExecuted=false residualLedgerUpdated=false");
}

function validateShape(raw: string, value: unknown, issues: ValidationIssue[]): void {
  if (!isObject(value)) {
    issues.push({ field: "index", message: "must be a JSON object" });
    scanForSecrets(raw, issues);
    return;
  }
  const index = value as unknown as IncidentIndex;
  if (!hasExactKeys(value, topLevelKeys)) issues.push({ field: "index", message: "contains missing or unknown top-level fields" });
  if (index.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (index.mode !== "read_only_resolved_incident_index") issues.push({ field: "mode", message: "must be read_only_resolved_incident_index" });
  if (typeof index.sourceRoot !== "string" || index.sourceRoot.length === 0) issues.push({ field: "sourceRoot", message: "must be a non-empty string" });
  if (index.sourcePattern !== "incident-*/incident-record.txt") issues.push({ field: "sourcePattern", message: "must use the fixed incident record pattern" });
  if (!isSha256(index.sourceSetSha256)) issues.push({ field: "sourceSetSha256", message: "must be sha256:<64 hex>" });

  if (!Array.isArray(index.incidents)) {
    issues.push({ field: "incidents", message: "must be an array" });
  } else {
    for (const [position, incident] of index.incidents.entries()) validateIncident(incident, position, issues);
    if (index.latestIncidentId !== (index.incidents[0]?.incidentId ?? null)) {
      issues.push({ field: "latestIncidentId", message: "must equal the first deterministically sorted incident" });
    }
  }

  if (!Array.isArray(index.doesNotProve) || !index.doesNotProve.every((item) => typeof item === "string")) {
    issues.push({ field: "doesNotProve", message: "must be an array of strings" });
  } else {
    for (const boundary of ["current production health", "incident action execution", "residual risk closure"]) {
      if (!index.doesNotProve.includes(boundary)) issues.push({ field: "doesNotProve", message: `must include ${boundary}` });
    }
  }

  validateSafetyFacts(index.safetyFacts, issues);
  scanForSecrets(raw, issues);
}

function validateIncident(value: unknown, position: number, issues: ValidationIssue[]): void {
  const field = `incidents[${position}]`;
  if (!isObject(value)) {
    issues.push({ field, message: "must be an object" });
    return;
  }
  if (!hasExactKeys(value, incidentKeys)) issues.push({ field, message: "contains missing or unknown fields" });
  const incident = value as Record<string, unknown>;
  for (const key of ["incidentId", "recordPath", "detectedAt", "recordedAt", "environment", "severity", "incidentType", "publicHealthStatus", "rollbackDecision"]) {
    if (typeof incident[key] !== "string" || incident[key].length === 0) issues.push({ field: `${field}.${key}`, message: "must be a non-empty string" });
  }
  if (!isSha256(incident.recordSha256)) issues.push({ field: `${field}.recordSha256`, message: "must be sha256:<64 hex>" });
  for (const key of ["residualRiskIds", "followUpTasks"]) {
    if (!Array.isArray(incident[key]) || !(incident[key] as unknown[]).every((item) => typeof item === "string")) {
      issues.push({ field: `${field}.${key}`, message: "must be an array of strings" });
    }
  }
}

function validateSafetyFacts(value: unknown, issues: ValidationIssue[]): void {
  if (!isObject(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  if (!hasExactKeys(value, safetyKeys)) issues.push({ field: "safetyFacts", message: "contains missing or unknown fields" });
  const safety = value as Record<string, unknown>;
  if (safety.readOnly !== true || safety.networkRequested !== false || safety.serverCommandAttempted !== false
    || safety.productionWriteAttempted !== false || safety.secretValuePrinted !== false || safety.indexWritten !== false
    || safety.incidentActionExecuted !== false || safety.residualLedgerUpdated !== false) {
    issues.push({ field: "safetyFacts", message: "must preserve the read-only no-action boundary" });
  }
}

function readStrictUtf8File(filePath: string): string {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    console.error(`FAIL index: file not found: ${filePath}`);
    process.exit(2);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    console.error("FAIL index: must be a regular non-symlink file");
    process.exit(1);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(filePath));
  } catch {
    console.error("FAIL index: must be valid UTF-8");
    process.exit(1);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value);
}

main();
