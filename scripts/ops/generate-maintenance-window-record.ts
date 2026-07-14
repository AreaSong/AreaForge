import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

const readinessPath = process.env.AREAFORGE_MAINTENANCE_READINESS_FILE ?? null;
const evidenceBundlePath = process.env.AREAFORGE_MAINTENANCE_EVIDENCE_BUNDLE_FILE ?? null;
const alertPreviewPath = process.env.AREAFORGE_MAINTENANCE_ALERT_PREVIEW_FILE ?? null;
const residualReviewPath = process.env.AREAFORGE_MAINTENANCE_RESIDUAL_REVIEW_FILE ?? null;

function main(): void {
  const required = requiredEnv();
  if (required.missing.length > 0) {
    console.error(`FAIL maintenance window record generation: missing ${required.missing.join(", ")}`);
    process.exit(1);
  }

  const readinessText = readinessPath ? readRequiredFile(path.resolve(readinessPath)) : "";
  const evidenceBundleText = evidenceBundlePath ? readRequiredFile(path.resolve(evidenceBundlePath)) : "";
  const alertPreviewText = alertPreviewPath ? readRequiredFile(path.resolve(alertPreviewPath)) : "";
  const residualReviewText = residualReviewPath ? readRequiredFile(path.resolve(residualReviewPath)) : "";
  const readinessJson = readinessText ? parseLastJson(readinessText) : {};
  const evidenceBundleJson = evidenceBundleText ? parseLastJson(evidenceBundleText) : {};
  const alertPreviewJson = alertPreviewText ? parseLastJson(alertPreviewText) : {};
  const residualReviewJson = residualReviewText ? parseLastJson(residualReviewText) : {};

  const startedAt = process.env.AREAFORGE_MAINTENANCE_STARTED_AT ?? stringOrNull(readinessJson.checkedAt) ?? new Date().toISOString();
  const finishedAt = process.env.AREAFORGE_MAINTENANCE_FINISHED_AT ?? stringOrNull(evidenceBundleJson.generatedAt) ?? stringOrNull(alertPreviewJson.generatedAt) ?? new Date().toISOString();
  const dueResidualRiskIds = normalizeRiskIds(process.env.AREAFORGE_MAINTENANCE_DUE_RESIDUAL_IDS ?? inferDueResidualIds(residualReviewJson));
  const residualRiskIds = normalizeRiskIds(process.env.AREAFORGE_MAINTENANCE_RESIDUAL_RISK_IDS ?? inferResidualRiskIds(readinessJson, evidenceBundleJson, alertPreviewJson, residualReviewJson, dueResidualRiskIds));
  const residualReviewStatus = normalizeResidualReviewStatus(process.env.AREAFORGE_MAINTENANCE_RESIDUAL_REVIEW_STATUS ?? inferResidualReviewStatus(dueResidualRiskIds, residualReviewJson));
  const evidenceFreshness = inferEvidenceFreshness(readinessJson, evidenceBundleJson, alertPreviewJson);
  const result = applyFreshnessResult(
    normalizeResult(process.env.AREAFORGE_MAINTENANCE_RESULT ?? inferResult(readinessJson, evidenceBundleJson, alertPreviewJson, dueResidualRiskIds)),
    evidenceFreshness.status,
  );

  const record = [
    `windowId: ${process.env.AREAFORGE_MAINTENANCE_WINDOW_ID ?? `maintenance-window-${compactTimestamp(startedAt)}`}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `operator: ${required.values.operator}`,
    `cadence: ${required.values.cadence}`,
    `environment: ${required.values.environment}`,
    `commandsRun: ${commandsRun()}`,
    `readinessOverall: ${summaryStatus(readinessJson.overall, ["pass", "warn", "fail", "blocked", "unknown"])}`,
    `evidenceBundleStatus: ${summaryStatus(evidenceBundleJson.status, ["ready", "needs_attention", "blocked"])}`,
    `alertPreviewStatus: ${summaryStatus(alertPreviewJson.status, ["ok", "watch", "warning", "critical"])}`,
    `healthStatus: ${signalStatus(readinessJson, "health")}`,
    `updateAgentStatus: ${signalStatus(readinessJson, "updateAgent")}`,
    `authenticatedSmokeStatus: ${signalStatus(readinessJson, "authenticatedSmoke")}`,
    `backupStatus: ${signalStatus(readinessJson, "backup")}`,
    `infrastructureStatus: ${signalStatus(readinessJson, "infrastructure")}`,
    `readinessSummaryHash: ${readinessText ? `sha256:${sha256(readinessText)}` : "not-applicable"}`,
    `evidenceBundleHash: ${evidenceBundleHash(evidenceBundleJson, evidenceBundleText)}`,
    `alertPreviewHash: ${alertPreviewText ? `sha256:${sha256(alertPreviewText)}` : "not-applicable"}`,
    `residualReviewHash: ${residualReviewText ? `sha256:${sha256(residualReviewText)}` : "not-applicable"}`,
    `evidenceFreshnessStatus: ${evidenceFreshness.status}`,
    `evidenceFreshnessMaxAgeSeconds: ${evidenceFreshness.maxAgeSeconds}`,
    `latestEvidenceCheckedAt: ${evidenceFreshness.latestCheckedAt}`,
    `residualReviewStatus: ${residualReviewStatus}`,
    `dueResidualRiskIds: ${dueResidualRiskIds}`,
    "claimBoundary:",
    "  doesNotProve: production health without live evidence, updater apply completion, backup/restore execution, migration execution, rollback execution, residual risk closure",
    `decisions: ${stringOrNull(process.env.AREAFORGE_MAINTENANCE_DECISIONS) ?? defaultDecisions(result)}`,
    `followUpTasks: ${stringOrNull(process.env.AREAFORGE_MAINTENANCE_FOLLOW_UPS) ?? "tasks/indexes/residuals.md"}`,
    `result: ${result}`,
    `residualRiskIds: ${residualRiskIds}`,
    "safetyFacts:",
    `  productionWriteAttempted: ${yesNoEnv("AREAFORGE_MAINTENANCE_PRODUCTION_WRITE_ATTEMPTED")}`,
    `  serverCommandAttempted: ${yesNoEnv("AREAFORGE_MAINTENANCE_SERVER_COMMAND_ATTEMPTED")}`,
    `  backupRestoreAttempted: ${yesNoEnv("AREAFORGE_MAINTENANCE_BACKUP_RESTORE_ATTEMPTED")}`,
    `  migrationAttempted: ${yesNoEnv("AREAFORGE_MAINTENANCE_MIGRATION_ATTEMPTED")}`,
    `  updaterApplyAttempted: ${yesNoEnv("AREAFORGE_MAINTENANCE_UPDATER_APPLY_ATTEMPTED")}`,
    `  rollbackAttempted: ${yesNoEnv("AREAFORGE_MAINTENANCE_ROLLBACK_ATTEMPTED")}`,
    "  secretValuePrinted: no",
    "",
  ].join("\n");

  process.stdout.write(record);
}

function requiredEnv(): {
  missing: string[];
  values: {
    operator: string;
    cadence: "daily" | "weekly" | "monthly" | "release" | "incident";
    environment: "production" | "staging" | "local" | "ci";
  };
} {
  const entries = {
    operator: stringOrNull(process.env.AREAFORGE_MAINTENANCE_OPERATOR),
    cadence: oneOf(process.env.AREAFORGE_MAINTENANCE_CADENCE, ["daily", "weekly", "monthly", "release", "incident"]),
    environment: oneOf(process.env.AREAFORGE_MAINTENANCE_ENVIRONMENT, ["production", "staging", "local", "ci"]),
  };
  return {
    missing: Object.entries(entries).filter(([, value]) => !value).map(([key]) => envNameFor(key)),
    values: entries as {
      operator: string;
      cadence: "daily" | "weekly" | "monthly" | "release" | "incident";
      environment: "production" | "staging" | "local" | "ci";
    },
  };
}

function commandsRun(): string {
  return stringOrNull(process.env.AREAFORGE_MAINTENANCE_COMMANDS_RUN) ??
    "pnpm enterprise:operability:preflight, pnpm maintenance:cadence:preflight, pnpm residuals:review-due, pnpm ops:readiness:summary, pnpm ops:evidence:bundle, pnpm ops:alert:preview";
}

function summaryStatus(value: unknown, allowed: string[]): string {
  return typeof value === "string" && allowed.includes(value) ? value : "not-applicable";
}

function signalStatus(source: JsonObject, signalName: string): string {
  const signals = source.signals;
  if (!signals || typeof signals !== "object") return "not-applicable";
  const signal = (signals as JsonObject)[signalName];
  if (!signal || typeof signal !== "object") return "not-applicable";
  return summaryStatus((signal as JsonObject).status, ["pass", "warn", "fail", "blocked", "unknown"]);
}

function inferDueResidualIds(...sources: JsonObject[]): string {
  const ids = new Set<string>();
  for (const source of sources) {
    for (const id of collectRiskIds(source, ["dueResidualRiskIds", "dueItems"])) {
      ids.add(id);
    }
  }
  return ids.size > 0 ? [...ids].sort().join(",") : "none";
}

function evidenceBundleHash(evidenceBundleJson: JsonObject, evidenceBundleText: string): string {
  const bundleHash = stringOrNull(evidenceBundleJson.bundleHash);
  if (bundleHash) {
    return bundleHash.startsWith("sha256:") ? bundleHash : `sha256:${bundleHash}`;
  }
  return evidenceBundleText ? `sha256:${sha256(evidenceBundleText)}` : "not-applicable";
}

function inferResidualRiskIds(...sources: Array<JsonObject | string>): string {
  const ids = new Set<string>();
  for (const source of sources) {
    if (typeof source === "string") {
      for (const id of source.match(/AF-RISK-[A-Z]+-\d+/g) ?? []) ids.add(id);
      continue;
    }
    for (const id of collectRiskIds(source, ["residualRiskIds", "dueResidualRiskIds", "items", "alerts", "signals"])) {
      ids.add(id);
    }
  }
  return ids.size > 0 ? [...ids].sort().join(",") : "none";
}

function collectRiskIds(value: unknown, keys: string[]): string[] {
  const ids: string[] = [];
  if (typeof value === "string") {
    ids.push(...(value.match(/AF-RISK-[A-Z]+-\d+/g) ?? []));
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) ids.push(...collectRiskIds(item, keys));
    return ids;
  }
  if (!value || typeof value !== "object") return ids;
  for (const [key, item] of Object.entries(value as JsonObject)) {
    if (keys.includes(key)) ids.push(...collectAnyRiskIds(item));
    if (typeof item === "object" && item) ids.push(...collectRiskIds(item, keys));
  }
  return [...new Set(ids)];
}

function collectAnyRiskIds(value: unknown): string[] {
  const ids: string[] = [];
  if (typeof value === "string") {
    ids.push(...(value.match(/AF-RISK-[A-Z]+-\d+/g) ?? []));
    return ids;
  }
  if (Array.isArray(value)) {
    for (const item of value) ids.push(...collectAnyRiskIds(item));
    return [...new Set(ids)];
  }
  if (!value || typeof value !== "object") return ids;
  for (const item of Object.values(value as JsonObject)) {
    ids.push(...collectAnyRiskIds(item));
  }
  return [...new Set(ids)];
}

function inferResult(readiness: JsonObject, evidenceBundle: JsonObject, alertPreview: JsonObject, dueResidualRiskIds: string): "pass" | "warn" | "fail" | "blocked" {
  const statuses = [
    normalizeStatus(stringOrNull(readiness.overall)),
    normalizeBundleStatus(stringOrNull(evidenceBundle.status)),
    normalizeAlertStatus(stringOrNull(alertPreview.status)),
  ].filter((status): status is "pass" | "warn" | "fail" | "blocked" => Boolean(status));
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return dueResidualRiskIds === "none" ? "pass" : "warn";
}

function inferResidualReviewStatus(dueResidualRiskIds: string, residualReview: JsonObject): "pass" | "warn" | "fail" {
  const counts = typeof residualReview.counts === "object" && residualReview.counts
    ? residualReview.counts as JsonObject
    : {};
  if (Number(counts.overdue ?? 0) > 0 || Number(counts.dueToday ?? 0) > 0) return "fail";
  return dueResidualRiskIds === "none" ? "pass" : "warn";
}

function inferEvidenceFreshness(...sources: JsonObject[]): {
  status: "fresh" | "stale" | "unknown";
  maxAgeSeconds: number;
  latestCheckedAt: string;
} {
  const maxAgeSeconds = inferFreshnessMaxAgeSeconds(sources);
  const statuses = sources
    .map((source) => freshnessStatus(source, maxAgeSeconds))
    .filter((status): status is "fresh" | "stale" | "unknown" => Boolean(status));
  const checkedAtValues = sources
    .flatMap((source) => checkedAtCandidates(source))
    .filter((value): value is string => Boolean(value));
  return {
    status: worstFreshnessStatus(statuses),
    maxAgeSeconds,
    latestCheckedAt: latestIso(checkedAtValues) ?? "unknown",
  };
}

function inferFreshnessMaxAgeSeconds(sources: JsonObject[]): number {
  const sourceMaxAge = sources
    .map((source) => nestedNumber(source, ["freshness", "maxAgeSeconds"]))
    .find((value): value is number => Number.isInteger(value) && value > 0);
  if (sourceMaxAge) return sourceMaxAge;
  const envMaxAge = Number(process.env.AREAFORGE_MAINTENANCE_EVIDENCE_MAX_AGE_SECONDS ?? "");
  return Number.isInteger(envMaxAge) && envMaxAge > 0 ? envMaxAge : 1209600;
}

function freshnessStatus(source: JsonObject, maxAgeSeconds: number): "fresh" | "stale" | "unknown" | null {
  const explicit = nestedString(source, ["freshness", "latestEvidenceFreshnessStatus"]);
  if (explicit === "fresh" || explicit === "stale" || explicit === "unknown") return explicit;
  const timestamp = stringOrNull(source.checkedAt) ?? stringOrNull(source.generatedAt) ?? nestedString(source, ["summary", "checkedAt"]);
  if (timestamp) return timestampFreshness(timestamp, maxAgeSeconds) ?? "unknown";
  return null;
}

function timestampFreshness(timestamp: string, maxAgeSeconds: number): "fresh" | "stale" | null {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return null;
  const ageSeconds = (Date.now() - time) / 1000;
  return ageSeconds <= maxAgeSeconds ? "fresh" : "stale";
}

function worstFreshnessStatus(statuses: Array<"fresh" | "stale" | "unknown">): "fresh" | "stale" | "unknown" {
  if (statuses.length === 0) return "unknown";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("unknown")) return "unknown";
  return "fresh";
}

function checkedAtCandidates(source: JsonObject): string[] {
  return [
    stringOrNull(source.checkedAt),
    stringOrNull(source.generatedAt),
    nestedString(source, ["summary", "checkedAt"]),
  ].filter((value): value is string => Boolean(value) && !Number.isNaN(Date.parse(value)));
}

function latestIso(values: string[]): string | null {
  const latest = values
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  return latest ? latest.toISOString() : null;
}

function nestedString(source: JsonObject, keys: string[]): string | null {
  const value = nestedValue(source, keys);
  return stringOrNull(value);
}

function nestedNumber(source: JsonObject, keys: string[]): number | null {
  const value = nestedValue(source, keys);
  return typeof value === "number" ? value : null;
}

function nestedValue(source: JsonObject, keys: string[]): unknown {
  let value: unknown = source;
  for (const key of keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = (value as JsonObject)[key];
  }
  return value;
}

function normalizeResult(value: string): "pass" | "warn" | "fail" | "blocked" {
  const normalized = oneOf(value, ["pass", "warn", "fail", "blocked"]);
  return normalized as "pass" | "warn" | "fail" | "blocked" | null ?? "warn";
}

function applyFreshnessResult(
  result: "pass" | "warn" | "fail" | "blocked",
  freshnessStatus: "fresh" | "stale" | "unknown",
): "pass" | "warn" | "fail" | "blocked" {
  if (result === "pass" && freshnessStatus !== "fresh") return "warn";
  return result;
}

function normalizeResidualReviewStatus(value: string): "pass" | "warn" | "fail" {
  const normalized = oneOf(value, ["pass", "warn", "fail"]);
  return normalized as "pass" | "warn" | "fail" | null ?? "warn";
}

function normalizeStatus(value: string | null): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "pass" || value === "warn" || value === "fail" || value === "blocked") return value;
  if (value === "unknown") return "warn";
  return null;
}

function normalizeBundleStatus(value: string | null): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "ready") return "pass";
  if (value === "needs_attention") return "warn";
  if (value === "blocked") return "blocked";
  return normalizeStatus(value);
}

function normalizeAlertStatus(value: string | null): "pass" | "warn" | "fail" | "blocked" | null {
  if (value === "ok") return "pass";
  if (value === "watch" || value === "warning") return "warn";
  if (value === "critical") return "blocked";
  return normalizeStatus(value);
}

function normalizeRiskIds(value: string): string {
  const ids = [...new Set(value.match(/AF-RISK-[A-Z]+-\d+/g) ?? [])].sort();
  return ids.length > 0 ? ids.join(",") : "none";
}

function defaultDecisions(result: string): string {
  return result === "pass"
    ? "no production write; no residual due in this window"
    : "no production write; keep listed residuals open until required evidence is present";
}

function parseLastJson(text: string): JsonObject {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as JsonObject;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? JSON.parse(trimmed.slice(start, end + 1)) as JsonObject : {};
}

function oneOf(value: string | undefined, allowed: string[]): string | null {
  return value && allowed.includes(value.toLowerCase()) ? value.toLowerCase() : null;
}

function yesNoEnv(name: string): "yes" | "no" {
  return process.env[name] === "yes" ? "yes" : "no";
}

function envNameFor(key: string): string {
  const names: Record<string, string> = {
    operator: "AREAFORGE_MAINTENANCE_OPERATOR",
    cadence: "AREAFORGE_MAINTENANCE_CADENCE",
    environment: "AREAFORGE_MAINTENANCE_ENVIRONMENT",
  };
  return names[key] ?? key;
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readRequiredFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

main();
