import { readFileSync } from "node:fs";
import path from "node:path";
import { buildMaintenanceWindowIndex, resolveIndexSourceRoot, type MaintenanceWindowIndex } from "./maintenance-window-index-common";
import { scanForSecrets, sha256, type ValidationIssue } from "./record-validator-common";

const indexPathArg = process.argv[2];
const sourceRootArg = process.argv[3];
const topLevelKeys = ["schemaVersion", "mode", "sourceRoot", "sourcePattern", "sourceSetSha256", "latestWindowId", "windows", "doesNotProve", "safetyFacts"].sort();
const windowKeys = ["windowId", "recordPath", "recordSha256", "startedAt", "finishedAt", "cadence", "environment", "result", "evidenceFreshnessStatus", "evidenceFreshnessMaxAgeSeconds", "latestEvidenceCheckedAt", "dueResidualRiskIds", "residualRiskIds"].sort();

function main(): void {
  if (!indexPathArg) {
    console.error("Usage: pnpm maintenance:window:index:validate <index.json> [source-root]");
    process.exit(2);
  }
  const raw = readFileSync(path.resolve(indexPathArg), "utf8");
  const issues: ValidationIssue[] = [];
  let parsed: MaintenanceWindowIndex;
  try {
    parsed = JSON.parse(raw) as MaintenanceWindowIndex;
  } catch {
    console.error("FAIL index: must be valid JSON");
    process.exit(1);
  }

  validateShape(raw, parsed, issues);
  if (issues.length === 0) {
    try {
      const rebuilt = buildMaintenanceWindowIndex(resolveIndexSourceRoot(parsed.sourceRoot, sourceRootArg));
      if (JSON.stringify(parsed) !== JSON.stringify(rebuilt)) issues.push({ field: "index", message: "does not match a deterministic rebuild from current source records" });
    } catch (error) {
      issues.push({ field: "sourceRoot", message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    console.error(`maintenance window index validation failed: ${issues.length} issue(s).`);
    process.exit(1);
  }
  console.log("maintenance window index validation passed: the deterministic index matches all current validated maintenance records.");
  console.log(`maintenanceWindowIndexEvidenceHash: sha256:${sha256(raw)}`);
  console.log(`sourceSetSha256: ${parsed.sourceSetSha256}`);
  console.log("safetyFacts: readOnlyValidation=true networkRequested=false serverCommandAttempted=false productionWriteAttempted=false secretValuePrinted=false");
}

function validateShape(raw: string, index: MaintenanceWindowIndex, issues: ValidationIssue[]): void {
  if (JSON.stringify(Object.keys(index).sort()) !== JSON.stringify(topLevelKeys)) issues.push({ field: "index", message: "contains missing or unknown top-level fields" });
  if (index.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (index.mode !== "read_only_maintenance_window_index") issues.push({ field: "mode", message: "must be read_only_maintenance_window_index" });
  if (index.sourcePattern !== "maintenance-window-*/maintenance-window.txt") issues.push({ field: "sourcePattern", message: "must use the fixed maintenance record pattern" });
  if (!/^sha256:[a-f0-9]{64}$/i.test(index.sourceSetSha256 ?? "")) issues.push({ field: "sourceSetSha256", message: "must be sha256:<64 hex>" });
  if (!Array.isArray(index.windows)) {
    issues.push({ field: "windows", message: "must be an array" });
  } else {
    for (const [position, window] of index.windows.entries()) {
      if (JSON.stringify(Object.keys(window).sort()) !== JSON.stringify(windowKeys)) issues.push({ field: `windows[${position}]`, message: "contains missing or unknown fields" });
      if (!/^sha256:[a-f0-9]{64}$/i.test(window.recordSha256)) issues.push({ field: `windows[${position}].recordSha256`, message: "must be sha256:<64 hex>" });
    }
    if (index.latestWindowId !== (index.windows[0]?.windowId ?? null)) issues.push({ field: "latestWindowId", message: "must equal the first deterministically sorted window" });
  }
  const safety = index.safetyFacts;
  if (safety?.readOnly !== true || safety?.networkRequested !== false || safety?.serverCommandAttempted !== false
    || safety?.productionWriteAttempted !== false || safety?.secretValuePrinted !== false || safety?.indexWritten !== false
    || safety?.maintenanceActionExecuted !== false || safety?.residualLedgerUpdated !== false) {
    issues.push({ field: "safetyFacts", message: "must preserve the read-only no-write boundary" });
  }
  for (const boundary of ["production health", "maintenance action execution", "residual risk closure"]) {
    if (!index.doesNotProve?.includes(boundary)) issues.push({ field: "doesNotProve", message: `must include ${boundary}` });
  }
  scanForSecrets(raw, issues);
}

main();
