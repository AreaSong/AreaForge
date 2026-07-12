import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type EvidenceStatus = "missing" | "valid" | "invalid";
type PreflightStatus = "needs_evidence" | "ready_to_generate_record" | "ready_for_human_close" | "invalid";

type JsonRecord = Record<string, unknown>;

type EvidenceResult = {
  key: string;
  label: string;
  envKey: string;
  path: string | null;
  status: EvidenceStatus;
  detail: string;
  evidenceHash?: string;
};

const previewEnvKey = "AREAFORGE_OPS004_ALERT_PREVIEW";
const drillEnvKey = "AREAFORGE_OPS004_ALERT_DRILL_RECORD";

const secretPatterns = [
  { label: "DATABASE_URL", pattern: /postgres(?:ql)?:\/\/[^ \n]+/i },
  { label: "API key", pattern: /\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/ },
  { label: "AUTH_SESSION_SECRET", pattern: /AUTH_SESSION_SECRET\s*=\s*\S+/i },
  { label: "AI_API_KEY", pattern: /AI_API_KEY\s*=\s*\S+/i },
  { label: "cookie", pattern: /\b(?:session|cookie)\s*[:=]\s*[A-Za-z0-9._=-]{16,}/i },
  { label: "raw prompt", pattern: /\b(prompt|rawResponse|fullReviewText|attachmentContent)\b/i },
];

function main(): void {
  const preview = validateAlertPreview();
  const drill = validateAlertDrillRecord(preview);
  const evidence = [preview, drill];
  const status = preflightStatus(preview, drill);
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "read_only_ops004_alert_evidence_preflight",
    residualRiskId: "AF-RISK-OPS-004",
    status,
    evidence,
    requiredPreflight: [
      "AREAFORGE_READINESS_ENVIRONMENT=production pnpm ops:alert:preview > <ops-alert-preview.json>",
      "AREAFORGE_ALERT_DRILL_ENVIRONMENT=production AREAFORGE_ALERT_DRILL_OPERATOR=<operator> AREAFORGE_ALERT_RECEIVER_TYPE=manual-window AREAFORGE_ALERT_RECEIVER_CONFIGURED=yes AREAFORGE_ALERT_RECEIVER_ACK=yes AREAFORGE_ALERT_DRILL_DETECTION_RESULT=PASS AREAFORGE_ALERT_DRILL_RECOVERY_RESULT=PASS AREAFORGE_ALERT_DRILL_RECOVERY_ACTION='<checked action>' pnpm alert:drill:record <ops-alert-preview.json> > <alert-drill-record.txt>",
      "pnpm alert:drill:validate <alert-drill-record.txt>",
      "AREAFORGE_OPS004_ALERT_PREVIEW=<ops-alert-preview.json> AREAFORGE_OPS004_ALERT_DRILL_RECORD=<alert-drill-record.txt> pnpm ops:ops-004:preflight",
    ],
    nextCommand: nextCommand(status),
    forbiddenActions: [
      "send_notification",
      "call_external_alert_receiver",
      "execute_server_command",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      notificationSent: false,
      externalAlertReceiverCalled: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      residualLedgerUpdated: false,
      secretValuePrinted: false,
    },
  };

  console.log(JSON.stringify(result, null, 2));

  if (status === "invalid" || shouldFail(status, process.env.AREAFORGE_OPS004_PREFLIGHT_FAIL_ON)) {
    process.exit(1);
  }
}

function validateAlertPreview(): EvidenceResult {
  const rawPath = process.env[previewEnvKey]?.trim();
  if (!rawPath) {
    return missing("alertPreview", "alert preview output", previewEnvKey);
  }

  const absolutePath = path.resolve(rawPath);
  if (!existsSync(absolutePath)) {
    return invalid("alertPreview", "alert preview output", previewEnvKey, "configured evidence path does not exist");
  }

  const raw = readFile(absolutePath);
  const secretIssue = findSecretIssue(raw);
  if (secretIssue) {
    return invalid("alertPreview", "alert preview output", previewEnvKey, `must not contain ${secretIssue}`);
  }

  let preview: JsonRecord;
  try {
    preview = parseJsonFromLog(raw) as JsonRecord;
  } catch (error) {
    return invalid("alertPreview", "alert preview output", previewEnvKey, error instanceof Error ? error.message : "invalid JSON");
  }

  const issues = validatePreviewShape(preview);
  if (issues.length > 0) {
    return invalid("alertPreview", "alert preview output", previewEnvKey, issues.join("; "));
  }

  return {
    key: "alertPreview",
    label: "alert preview output",
    envKey: previewEnvKey,
    path: "<redacted path>",
    status: "valid",
    detail: "alert preview is read-only, tracks AF-RISK-OPS-004, and contains no secret-like values",
    evidenceHash: `sha256:${sha256(raw)}`,
  };
}

function validateAlertDrillRecord(preview: EvidenceResult): EvidenceResult {
  const rawPath = process.env[drillEnvKey]?.trim();
  if (!rawPath) {
    return missing("alertDrillRecord", "alert drill record", drillEnvKey);
  }

  const absolutePath = path.resolve(rawPath);
  if (!existsSync(absolutePath)) {
    return invalid("alertDrillRecord", "alert drill record", drillEnvKey, "configured evidence path does not exist");
  }

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/alert-drill-validate.ts", absolutePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    return invalid(
      "alertDrillRecord",
      "alert drill record",
      drillEnvKey,
      sanitizeValidationOutput(validation.stderr || validation.stdout || "alert drill validator failed"),
    );
  }

  const record = readFile(absolutePath);
  const fields = parseIndentedKeyValueRecord(record);
  const recordHash = fields.get("alertPreviewEvidenceHash");
  if (!recordHash) {
    return invalid("alertDrillRecord", "alert drill record", drillEnvKey, "alertPreviewEvidenceHash is missing");
  }

  if (preview.status === "valid" && normalizeHash(recordHash) !== normalizeHash(preview.evidenceHash)) {
    return invalid(
      "alertDrillRecord",
      "alert drill record",
      drillEnvKey,
      "alertPreviewEvidenceHash must match the supplied alert preview file",
    );
  }

  return {
    key: "alertDrillRecord",
    label: "alert drill record",
    envKey: drillEnvKey,
    path: "<redacted path>",
    status: "valid",
    detail: preview.status === "valid"
      ? "alert drill validator passed and preview hash matches"
      : "alert drill validator passed; supply alert preview to prove hash match",
    evidenceHash: buildRecordEvidenceHash(fields),
  };
}

function validatePreviewShape(preview: JsonRecord): string[] {
  const issues: string[] = [];
  if (preview.mode !== "read_only_alert_preview") {
    issues.push(`mode must be read_only_alert_preview, got ${String(preview.mode)}`);
  }
  if (!["ok", "watch", "warning", "critical"].includes(String(preview.status))) {
    issues.push("status must be ok, watch, warning, or critical");
  }
  const safety = isRecord(preview.safetyFacts) ? preview.safetyFacts : {};
  for (const key of ["notificationSent", "externalAlertReceiverCalled", "serverCommandAttempted", "productionWriteAttempted", "secretValuePrinted"]) {
    if (safety[key] !== false) {
      issues.push(`safetyFacts.${key} must be false`);
    }
  }
  const delivery = isRecord(preview.delivery) ? preview.delivery : {};
  if (delivery.enabled !== false) {
    issues.push("delivery.enabled must be false");
  }
  const alerts = Array.isArray(preview.alerts) ? preview.alerts : [];
  const tracksOps004 = alerts.some((alert) =>
    isRecord(alert) &&
    Array.isArray(alert.residualRiskIds) &&
    alert.residualRiskIds.includes("AF-RISK-OPS-004"),
  );
  if (!tracksOps004) {
    issues.push("alerts must include AF-RISK-OPS-004");
  }
  return issues;
}

function preflightStatus(preview: EvidenceResult, drill: EvidenceResult): PreflightStatus {
  if (preview.status === "invalid" || drill.status === "invalid") return "invalid";
  if (preview.status === "valid" && drill.status === "valid") return "ready_for_human_close";
  if (preview.status === "valid" && drill.status === "missing") return "ready_to_generate_record";
  return "needs_evidence";
}

function nextCommand(status: PreflightStatus): string {
  if (status === "ready_for_human_close") return "review AF-RISK-OPS-004 close condition and update residual ledger only after human approval";
  if (status === "ready_to_generate_record") return "pnpm alert:drill:record <ops-alert-preview.json> > <alert-drill-record.txt>";
  if (status === "invalid") return "fix invalid redacted alert evidence and rerun pnpm ops:ops-004:preflight";
  return "collect alert preview and alert drill record evidence, then rerun pnpm ops:ops-004:preflight";
}

function shouldFail(status: PreflightStatus, failOn: string | undefined): boolean {
  if (!failOn) return false;
  const order: PreflightStatus[] = ["ready_for_human_close", "ready_to_generate_record", "needs_evidence", "invalid"];
  const threshold = order.includes(failOn as PreflightStatus) ? failOn as PreflightStatus : "invalid";
  return order.indexOf(status) >= order.indexOf(threshold);
}

function missing(key: string, label: string, envKey: string): EvidenceResult {
  return {
    key,
    label,
    envKey,
    path: null,
    status: "missing",
    detail: `${envKey} is not set`,
  };
}

function invalid(key: string, label: string, envKey: string, detail: string): EvidenceResult {
  return {
    key,
    label,
    envKey,
    path: "<redacted path>",
    status: "invalid",
    detail,
  };
}

function parseJsonFromLog(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const jsonLine = [...raw.split(/\r?\n/)]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error("alert preview output does not contain JSON");
  }
  return JSON.parse(jsonLine);
}

function parseIndentedKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentSection = "";

  for (const rawLine of record.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const value = match[3]?.trim() ?? "";
    if (indent === 0) {
      currentSection = value ? "" : key;
      fields.set(key, value);
      continue;
    }

    if (currentSection) {
      fields.set(`${currentSection}.${key}`, value);
    }
  }

  return fields;
}

function buildRecordEvidenceHash(fields: Map<string, string>): string {
  const keys = [...fields.keys()].sort();
  const bundle = keys.map((key) => [key, fields.get(key) ?? ""]);
  return `sha256:${sha256(JSON.stringify(bundle))}`;
}

function normalizeHash(value: string | undefined): string {
  return (value ?? "").replace(/^sha256:/i, "").toLowerCase();
}

function findSecretIssue(value: string): string | null {
  for (const item of secretPatterns) {
    if (item.pattern.test(value)) return item.label;
  }
  return null;
}

function sanitizeValidationOutput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, "<redacted-token>")
    .replace(/\/[^\s:]+/g, "<redacted-path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function readFile(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

main();
