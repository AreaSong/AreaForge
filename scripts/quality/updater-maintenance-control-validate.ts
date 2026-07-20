import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type UpdaterMaintenanceControlIssue = { field: string; message: string };

const requiredDoesNotProve = [
  "production maintenance hold installed",
  "systemd timers stopped",
  "active updater process terminated",
  "queue mutation prevented in production",
  "hold and claim queue-control lock ordering or concurrent exclusion",
  "production drain observation",
];

export function validateUpdaterMaintenanceControl(raw: string): UpdaterMaintenanceControlIssue[] {
  const issues: UpdaterMaintenanceControlIssue[] = [];
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return [{ field: "record", message: "must be valid JSON" }];
  }
  if (!isRecord(body)) return [{ field: "record", message: "must be an object" }];
  exactKeys(body, ["schemaVersion", "mode", "status", "hold", "queue", "claims", "doesNotProve", "safetyFacts", "recordHash"], "record", issues);
  if (body.schemaVersion !== 1) issues.push({ field: "schemaVersion", message: "must be 1" });
  if (body.mode !== "fixture_only_updater_maintenance_control") issues.push({ field: "mode", message: "must be fixture_only_updater_maintenance_control" });
  if (!["drained", "waiting_for_active_claim", "waiting_for_production_lock"].includes(String(body.status))) issues.push({ field: "status", message: "must be drained, waiting_for_active_claim, or waiting_for_production_lock" });
  validateHold(body.hold, issues);
  validateQueue(body.queue, issues);
  validateClaims(body.claims, body.status, issues);
  validateDoesNotProve(body.doesNotProve, issues);
  validateSafety(body.safetyFacts, issues);
  rejectSensitiveContent(raw, issues);
  if (!isSha256(body.recordHash)) issues.push({ field: "recordHash", message: "must be sha256" });
  else if (computeUpdaterMaintenanceControlHash(body) !== body.recordHash) issues.push({ field: "recordHash", message: "does not match canonical record" });
  return issues;
}

function validateHold(value: unknown, issues: UpdaterMaintenanceControlIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "hold", message: "must be an object" });
    return;
  }
  exactKeys(value, ["enabled", "source", "reasonCode", "webCanWriteHold"], "hold", issues);
  if (value.enabled !== true) issues.push({ field: "hold.enabled", message: "must be true" });
  if (value.source !== "root_only_fixture") issues.push({ field: "hold.source", message: "must be root_only_fixture" });
  if (typeof value.reasonCode !== "string" || !/^[A-Z0-9_]{2,80}$/.test(value.reasonCode)) issues.push({ field: "hold.reasonCode", message: "must be a stable redacted code" });
  if (value.webCanWriteHold !== false) issues.push({ field: "hold.webCanWriteHold", message: "must be false" });
}

function validateQueue(value: unknown, issues: UpdaterMaintenanceControlIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "queue", message: "must be an object" });
    return;
  }
  exactKeys(value, ["newClaimsAllowed", "automaticUpdaterRunAllowed", "queuedRequestsPreserved"], "queue", issues);
  if (value.newClaimsAllowed !== false) issues.push({ field: "queue.newClaimsAllowed", message: "must be false" });
  if (value.automaticUpdaterRunAllowed !== false) issues.push({ field: "queue.automaticUpdaterRunAllowed", message: "must be false" });
  if (value.queuedRequestsPreserved !== true) issues.push({ field: "queue.queuedRequestsPreserved", message: "must be true" });
}

function validateClaims(value: unknown, status: unknown, issues: UpdaterMaintenanceControlIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "claims", message: "must be an object" });
    return;
  }
  exactKeys(value, ["activeClaimState", "productionStateLockState", "drainResult", "claimDeleted"], "claims", issues);
  if (value.activeClaimState !== "none" && value.activeClaimState !== "active") issues.push({ field: "claims.activeClaimState", message: "must be none or active" });
  if (value.productionStateLockState !== "free" && value.productionStateLockState !== "busy") issues.push({ field: "claims.productionStateLockState", message: "must be free or busy" });
  if (value.drainResult !== "drained" && value.drainResult !== "waiting") issues.push({ field: "claims.drainResult", message: "must be drained or waiting" });
  if (value.claimDeleted !== false) issues.push({ field: "claims.claimDeleted", message: "must be false" });
  if (status === "drained" && !(value.activeClaimState === "none" && value.productionStateLockState === "free" && value.drainResult === "drained")) issues.push({ field: "claims", message: "drained requires no active claim and a free production-state lock" });
  if (status === "waiting_for_active_claim" && !(value.activeClaimState === "active" && value.drainResult === "waiting")) issues.push({ field: "claims", message: "waiting status must preserve the active claim" });
  if (status === "waiting_for_production_lock" && !(value.activeClaimState === "none" && value.productionStateLockState === "busy" && value.drainResult === "waiting")) issues.push({ field: "claims", message: "production-lock waiting requires no active claim and a busy production-state lock" });
}

function validateDoesNotProve(value: unknown, issues: UpdaterMaintenanceControlIssue[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ field: "doesNotProve", message: "must be an array of strings" });
    return;
  }
  for (const required of requiredDoesNotProve) if (!value.includes(required)) issues.push({ field: "doesNotProve", message: `must include ${required}` });
}

function validateSafety(value: unknown, issues: UpdaterMaintenanceControlIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ field: "safetyFacts", message: "must be an object" });
    return;
  }
  const keys = ["readOnly", "serverCommandAttempted", "timerChanged", "queueWriteAttempted", "claimDeleted", "productionWriteAttempted", "secretValuePrinted", "residualLedgerUpdated"];
  exactKeys(value, keys, "safetyFacts", issues);
  for (const key of keys) {
    const expected = key === "readOnly";
    if (value[key] !== expected) issues.push({ field: `safetyFacts.${key}`, message: `must be ${String(expected)}` });
  }
}

function rejectSensitiveContent(raw: string, issues: UpdaterMaintenanceControlIssue[]): void {
  for (const marker of ["postgresql://", "DATABASE_URL", "/etc/", "/opt/", "/Users/", "AUTH_SESSION_SECRET"]) {
    if (raw.includes(marker)) issues.push({ field: "record", message: `must not contain sensitive marker ${marker}` });
  }
}

export function computeUpdaterMaintenanceControlHash(value: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(stableStringify({ ...value, recordHash: "" })).digest("hex")}`;
}

function exactKeys(value: Record<string, unknown>, keys: string[], field: string, issues: UpdaterMaintenanceControlIssue[]): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) issues.push({ field, message: `keys must be exactly ${[...keys].sort().join(", ")}` });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

if (process.argv[1] && process.argv[1].endsWith("updater-maintenance-control-validate.ts")) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: pnpm updater:maintenance-control:validate <fixture.json>");
    process.exit(2);
  }
  const issues = validateUpdaterMaintenanceControl(readFileSync(file, "utf8"));
  if (issues.length) {
    for (const issue of issues) console.error(`FAIL ${issue.field}: ${issue.message}`);
    process.exit(1);
  }
  console.log("updater maintenance-control fixture validation passed: declared hold/drain states are valid; lock ordering and production concurrency remain unproven.");
}
