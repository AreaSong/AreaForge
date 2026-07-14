import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type AlertPreview = {
  status?: unknown;
  mode?: unknown;
  generatedAt?: unknown;
  environment?: unknown;
  scope?: unknown;
  delivery?: {
    receiverConfigured?: unknown;
  };
  alerts?: Array<{
    signal?: unknown;
    severity?: unknown;
    wouldNotify?: unknown;
    residualRiskIds?: unknown;
  }>;
  safetyFacts?: {
    notificationSent?: unknown;
    externalAlertReceiverCalled?: unknown;
    serverCommandAttempted?: unknown;
    productionWriteAttempted?: unknown;
    secretValuePrinted?: unknown;
  };
};

const previewPath = process.argv[2] ?? process.env.AREAFORGE_ALERT_PREVIEW_FILE;

function main(): void {
  if (!previewPath) {
    console.error("Usage: pnpm alert:drill:record <ops-alert-preview-output.json>");
    process.exit(2);
  }

  const absolutePreviewPath = path.resolve(previewPath);
  const previewLog = readRequiredFile(absolutePreviewPath);
  const preview = parseAlertPreview(previewLog);
  if (preview.mode !== "read_only_alert_preview") {
    throw new Error(`alert preview mode is ${String(preview.mode)}`);
  }

  const required = requiredEnv();
  if (required.missing.length > 0) {
    console.error(`FAIL alert drill record generation: missing ${required.missing.join(", ")}`);
    process.exit(1);
  }

  const drilledAt = stringOrNull(process.env.AREAFORGE_ALERT_DRILL_AT) ??
    stringOrNull(preview.generatedAt) ??
    new Date().toISOString();
  const environment = resolveEnvironment(stringOrNull(preview.environment), process.env.AREAFORGE_ALERT_DRILL_ENVIRONMENT);
  const scope = resolveScope(stringOrNull(preview.scope), process.env.AREAFORGE_ALERT_DRILL_SCOPE);
  const record = [
    `drillId: ${stringOrNull(process.env.AREAFORGE_ALERT_DRILL_ID) ?? `alert-drill-${compactTimestamp(drilledAt)}`}`,
    `drilledAt: ${drilledAt}`,
    `operator: ${required.values.operator}`,
    `environment: ${environment}`,
    `scope: ${scope}`,
    `scenario: ${normalizeScenario(process.env.AREAFORGE_ALERT_DRILL_SCENARIO ?? inferScenario(preview))}`,
    "alertPreviewCommand: pnpm ops:alert:preview",
    `alertPreviewStatus: ${normalizePreviewStatus(stringOrNull(preview.status))}`,
    `alertPreviewWouldNotify: ${alertPreviewWouldNotify(preview) ? "yes" : "no"}`,
    `alertPreviewEvidenceHash: sha256:${sha256(previewLog)}`,
    `alertReceiverType: ${required.values.receiverType}`,
    `receiverConfigured: ${required.values.receiverConfigured}`,
    `receiverAck: ${required.values.receiverAck}`,
    `detectionResult: ${required.values.detectionResult}`,
    `recoveryResult: ${required.values.recoveryResult}`,
    `recoveryAction: ${required.values.recoveryAction}`,
    "residualRiskIds: AF-RISK-OPS-004",
    `followUpTasks: ${stringOrNull(process.env.AREAFORGE_ALERT_DRILL_FOLLOW_UPS) ?? "tasks/indexes/residuals.md"}`,
    "safetyFacts:",
    `  notificationSent: ${yesNo(process.env.AREAFORGE_ALERT_DRILL_NOTIFICATION_SENT ?? boolToYesNo(preview.safetyFacts?.notificationSent))}`,
    `  externalAlertReceiverCalled: ${yesNo(process.env.AREAFORGE_ALERT_DRILL_EXTERNAL_RECEIVER_CALLED ?? boolToYesNo(preview.safetyFacts?.externalAlertReceiverCalled))}`,
    `  serverCommandAttempted: ${yesNo(boolToYesNo(preview.safetyFacts?.serverCommandAttempted))}`,
    `  productionWriteAttempted: ${yesNo(boolToYesNo(preview.safetyFacts?.productionWriteAttempted))}`,
    `  secretValuePrinted: ${yesNo(boolToYesNo(preview.safetyFacts?.secretValuePrinted))}`,
    "",
  ].join("\n");

  process.stdout.write(record);
}

function requiredEnv(): {
  missing: string[];
  values: {
    operator: string;
    receiverType: "external" | "manual-window";
    receiverConfigured: "yes";
    receiverAck: "yes";
    detectionResult: "PASS";
    recoveryResult: "PASS";
    recoveryAction: string;
  };
} {
  const entries = {
    operator: stringOrNull(process.env.AREAFORGE_ALERT_DRILL_OPERATOR),
    receiverType: normalizeReceiverType(process.env.AREAFORGE_ALERT_RECEIVER_TYPE),
    receiverConfigured: process.env.AREAFORGE_ALERT_RECEIVER_CONFIGURED === "yes" ? "yes" as const : null,
    receiverAck: process.env.AREAFORGE_ALERT_RECEIVER_ACK === "yes" ? "yes" as const : null,
    detectionResult: process.env.AREAFORGE_ALERT_DRILL_DETECTION_RESULT === "PASS" ? "PASS" as const : null,
    recoveryResult: process.env.AREAFORGE_ALERT_DRILL_RECOVERY_RESULT === "PASS" ? "PASS" as const : null,
    recoveryAction: stringOrNull(process.env.AREAFORGE_ALERT_DRILL_RECOVERY_ACTION),
  };
  return {
    missing: Object.entries(entries).filter(([, value]) => !value).map(([key]) => envNameFor(key)),
    values: entries as {
      operator: string;
      receiverType: "external" | "manual-window";
      receiverConfigured: "yes";
      receiverAck: "yes";
      detectionResult: "PASS";
      recoveryResult: "PASS";
      recoveryAction: string;
    },
  };
}

function parseAlertPreview(previewLog: string): AlertPreview {
  const trimmed = previewLog.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as AlertPreview;
  const jsonLine = [...previewLog.split(/\r?\n/)]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error("alert preview output does not contain JSON");
  }
  return JSON.parse(jsonLine) as AlertPreview;
}

function alertPreviewWouldNotify(preview: AlertPreview): boolean {
  return Array.isArray(preview.alerts) && preview.alerts.some((alert) => alert.wouldNotify === true);
}

function inferScenario(preview: AlertPreview): string {
  const alert = Array.isArray(preview.alerts)
    ? preview.alerts.find((item) => Array.isArray(item.residualRiskIds) && item.residualRiskIds.includes("AF-RISK-OPS-004")) ??
      preview.alerts.find((item) => item.wouldNotify === true) ??
      preview.alerts[0]
    : null;
  const signal = stringOrNull(alert?.signal);
  if (signal === "health") return "health_failure";
  if (signal === "authenticatedSmoke") return "smoke_missing";
  if (signal === "backup") return "backup_stale";
  if (signal === "updateAgent") return "update_agent_blocker";
  if (signal === "releaseIdentity") return "release_identity_missing";
  if (signal === "infrastructure") return "cert_expiring";
  return "manual";
}

function envNameFor(key: string): string {
  const names: Record<string, string> = {
    operator: "AREAFORGE_ALERT_DRILL_OPERATOR",
    receiverType: "AREAFORGE_ALERT_RECEIVER_TYPE",
    receiverConfigured: "AREAFORGE_ALERT_RECEIVER_CONFIGURED=yes",
    receiverAck: "AREAFORGE_ALERT_RECEIVER_ACK=yes",
    detectionResult: "AREAFORGE_ALERT_DRILL_DETECTION_RESULT=PASS",
    recoveryResult: "AREAFORGE_ALERT_DRILL_RECOVERY_RESULT=PASS",
    recoveryAction: "AREAFORGE_ALERT_DRILL_RECOVERY_ACTION",
  };
  return names[key] ?? key;
}

function normalizeReceiverType(value: string | undefined): "external" | "manual-window" | null {
  return value === "external" || value === "manual-window" ? value : null;
}

function resolveEnvironment(previewValue: string | null, envValue: string | undefined): "production" | "staging" | "local" | "ci" {
  const value = stringOrNull(envValue) ?? previewValue;
  const allowed = ["production", "staging", "local", "ci"];
  if (allowed.includes(value ?? "")) {
    return value as "production" | "staging" | "local" | "ci";
  }
  throw new Error("alert drill environment must be explicit: set AREAFORGE_ALERT_DRILL_ENVIRONMENT to production, staging, local, or ci when the preview environment is missing or unknown");
}

function resolveScope(previewValue: string | null, envValue: string | undefined): "daily" | "release" | "update" | "migration" | "rollback" {
  const value = stringOrNull(envValue) ?? previewValue;
  const allowed = ["daily", "release", "update", "migration", "rollback"];
  if (allowed.includes(value ?? "")) {
    return value as "daily" | "release" | "update" | "migration" | "rollback";
  }
  throw new Error("alert drill scope must be explicit: set AREAFORGE_ALERT_DRILL_SCOPE to daily, release, update, migration, or rollback when the preview scope is missing or unknown");
}

function normalizeScenario(value: string): string {
  const allowed = ["health_failure", "smoke_missing", "backup_stale", "cert_expiring", "update_agent_blocker", "release_identity_missing", "manual"];
  return allowed.includes(value) ? value : "manual";
}

function normalizePreviewStatus(value: string | null): "ok" | "watch" | "warning" | "critical" {
  const allowed = ["ok", "watch", "warning", "critical"];
  return allowed.includes(value ?? "") ? value as "ok" | "watch" | "warning" | "critical" : "warning";
}

function boolToYesNo(value: unknown): "yes" | "no" {
  return value === true ? "yes" : "no";
}

function yesNo(value: string): "yes" | "no" {
  return value === "yes" ? "yes" : "no";
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
