import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sha256 } from "../quality/record-validator-common";

type JsonObject = Record<string, unknown>;

const evidencePath = process.argv[2] ?? process.env.AREAFORGE_INCIDENT_EVIDENCE_FILE;
const alertPreviewPath = process.env.AREAFORGE_INCIDENT_ALERT_PREVIEW_FILE;

function main(): void {
  const required = requiredEnv();
  if (required.missing.length > 0) {
    console.error(`FAIL incident record generation: missing ${required.missing.join(", ")}`);
    process.exit(1);
  }

  const evidenceText = evidencePath ? readRequiredFile(path.resolve(evidencePath)) : "";
  const alertText = alertPreviewPath ? readRequiredFile(path.resolve(alertPreviewPath)) : "";
  const evidenceJson = evidenceText ? parseLastJson(evidenceText) : {};
  const alertJson = alertText ? parseLastJson(alertText) : {};
  const now = new Date().toISOString();
  const detectedAt = process.env.AREAFORGE_INCIDENT_DETECTED_AT ?? stringOrNull(evidenceJson.checkedAt) ?? stringOrNull(evidenceJson.generatedAt) ?? now;
  const recordedAt = process.env.AREAFORGE_INCIDENT_RECORDED_AT ?? now;
  const incidentId = process.env.AREAFORGE_INCIDENT_ID ?? `incident-${compactTimestamp(detectedAt)}`;
  const publicHealthStatus = process.env.AREAFORGE_INCIDENT_PUBLIC_HEALTH_STATUS ?? inferHealthStatus(evidenceJson);

  const record = [
    `incidentId: ${incidentId}`,
    `detectedAt: ${detectedAt}`,
    `recordedAt: ${recordedAt}`,
    `operator: ${required.values.operator}`,
    `environment: ${required.values.environment}`,
    `severity: ${required.values.severity}`,
    `status: ${required.values.status}`,
    `incidentType: ${required.values.incidentType}`,
    `source: ${required.values.source}`,
    `evidenceClass: ${required.values.evidenceClass}`,
    `publicHealthStatus: ${publicHealthStatus}`,
    `userImpact: ${required.values.userImpact}`,
    `containmentAction: ${required.values.containmentAction}`,
    `recoveryAction: ${required.values.recoveryAction}`,
    `rollbackDecision: ${required.values.rollbackDecision}`,
    `readinessSummaryHash: ${evidenceText ? `sha256:${sha256(evidenceText)}` : "not-applicable"}`,
    `evidenceBundleHash: ${stringOrNull(evidenceJson.bundleHash) ?? (evidenceText ? `sha256:${sha256(evidenceText)}` : "not-applicable")}`,
    `alertPreviewHash: ${alertText ? `sha256:${sha256(alertText)}` : "not-applicable"}`,
    `highRiskConfirmation: ${required.values.highRiskConfirmation}`,
    `residualRiskIds: ${required.values.residualRiskIds}`,
    `followUpTasks: ${process.env.AREAFORGE_INCIDENT_FOLLOW_UPS ?? "tasks/indexes/residuals.md"}`,
    `postIncidentReview: ${required.values.postIncidentReview}`,
    "safetyFacts:",
    `  productionWriteAttempted: ${yesNoEnv("AREAFORGE_INCIDENT_PRODUCTION_WRITE_ATTEMPTED")}`,
    `  serverCommandAttempted: ${yesNoEnv("AREAFORGE_INCIDENT_SERVER_COMMAND_ATTEMPTED")}`,
    `  backupRestoreAttempted: ${yesNoEnv("AREAFORGE_INCIDENT_BACKUP_RESTORE_ATTEMPTED")}`,
    `  migrationAttempted: ${yesNoEnv("AREAFORGE_INCIDENT_MIGRATION_ATTEMPTED")}`,
    `  updaterApplyAttempted: ${yesNoEnv("AREAFORGE_INCIDENT_UPDATER_APPLY_ATTEMPTED")}`,
    `  rollbackAttempted: ${yesNoEnv("AREAFORGE_INCIDENT_ROLLBACK_ATTEMPTED")}`,
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "",
  ].join("\n");

  process.stdout.write(record);
}

function requiredEnv(): {
  missing: string[];
  values: {
    operator: string;
    environment: string;
    severity: string;
    status: string;
    incidentType: string;
    source: string;
    evidenceClass: string;
    userImpact: string;
    containmentAction: string;
    recoveryAction: string;
    rollbackDecision: string;
    highRiskConfirmation: string;
    residualRiskIds: string;
    postIncidentReview: string;
  };
} {
  const entries = {
    operator: stringOrNull(process.env.AREAFORGE_INCIDENT_OPERATOR),
    environment: oneOf(process.env.AREAFORGE_INCIDENT_ENVIRONMENT, ["production", "staging", "local", "ci"]),
    severity: oneOf(process.env.AREAFORGE_INCIDENT_SEVERITY, ["p0", "p1", "p2", "p3"]),
    status: oneOf(process.env.AREAFORGE_INCIDENT_STATUS, ["open", "mitigated", "resolved", "follow-up"]),
    incidentType: oneOf(process.env.AREAFORGE_INCIDENT_TYPE, ["health", "update", "backup", "release", "security", "ai", "upload", "data", "smoke", "other"]),
    source: stringOrNull(process.env.AREAFORGE_INCIDENT_SOURCE),
    evidenceClass: oneOf(process.env.AREAFORGE_INCIDENT_EVIDENCE_CLASS, ["production", "runtime", "release", "local", "docs-only"]),
    userImpact: stringOrNull(process.env.AREAFORGE_INCIDENT_USER_IMPACT),
    containmentAction: stringOrNull(process.env.AREAFORGE_INCIDENT_CONTAINMENT_ACTION),
    recoveryAction: stringOrNull(process.env.AREAFORGE_INCIDENT_RECOVERY_ACTION),
    rollbackDecision: oneOf(process.env.AREAFORGE_INCIDENT_ROLLBACK_DECISION, ["not-needed", "rollback", "roll-forward", "hold", "defer"]),
    highRiskConfirmation: oneOf(process.env.AREAFORGE_INCIDENT_HIGH_RISK_CONFIRMATION, ["yes", "no", "not-applicable"]),
    residualRiskIds: stringOrNull(process.env.AREAFORGE_INCIDENT_RESIDUAL_RISK_IDS),
    postIncidentReview: oneOf(process.env.AREAFORGE_INCIDENT_POST_REVIEW, ["yes", "no", "not-applicable"]),
  };

  return {
    missing: Object.entries(entries).filter(([, value]) => !value).map(([key]) => envNameFor(key)),
    values: entries as {
      operator: string;
      environment: string;
      severity: string;
      status: string;
      incidentType: string;
      source: string;
      evidenceClass: string;
      userImpact: string;
      containmentAction: string;
      recoveryAction: string;
      rollbackDecision: string;
      highRiskConfirmation: string;
      residualRiskIds: string;
      postIncidentReview: string;
    },
  };
}

function parseLastJson(text: string): JsonObject {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as JsonObject;
  const line = [...text.split(/\r?\n/)].reverse().map((item) => item.trim()).find((item) => item.startsWith("{") && item.endsWith("}"));
  return line ? JSON.parse(line) as JsonObject : {};
}

function inferHealthStatus(evidence: JsonObject): string {
  const health = evidence.health;
  if (typeof health === "object" && health && "status" in health) {
    return oneOf(String((health as JsonObject).status), ["pass", "warn", "fail", "unknown", "not-checked"]) ?? "unknown";
  }
  return oneOf(String(evidence.status ?? ""), ["pass", "warn", "fail", "unknown", "not-checked"]) ?? "unknown";
}

function yesNoEnv(name: string): "yes" | "no" {
  return process.env[name] === "yes" ? "yes" : "no";
}

function oneOf(value: string | undefined, allowed: string[]): string | null {
  return value && allowed.includes(value.toLowerCase()) ? value.toLowerCase() : null;
}

function envNameFor(key: string): string {
  const names: Record<string, string> = {
    operator: "AREAFORGE_INCIDENT_OPERATOR",
    environment: "AREAFORGE_INCIDENT_ENVIRONMENT",
    severity: "AREAFORGE_INCIDENT_SEVERITY",
    status: "AREAFORGE_INCIDENT_STATUS",
    incidentType: "AREAFORGE_INCIDENT_TYPE",
    source: "AREAFORGE_INCIDENT_SOURCE",
    evidenceClass: "AREAFORGE_INCIDENT_EVIDENCE_CLASS",
    userImpact: "AREAFORGE_INCIDENT_USER_IMPACT",
    containmentAction: "AREAFORGE_INCIDENT_CONTAINMENT_ACTION",
    recoveryAction: "AREAFORGE_INCIDENT_RECOVERY_ACTION",
    rollbackDecision: "AREAFORGE_INCIDENT_ROLLBACK_DECISION",
    highRiskConfirmation: "AREAFORGE_INCIDENT_HIGH_RISK_CONFIRMATION",
    residualRiskIds: "AREAFORGE_INCIDENT_RESIDUAL_RISK_IDS",
    postIncidentReview: "AREAFORGE_INCIDENT_POST_REVIEW",
  };
  return names[key] ?? key;
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
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
