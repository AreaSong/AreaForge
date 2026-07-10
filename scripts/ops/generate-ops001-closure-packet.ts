import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  parseIndentedKeyValueRecord,
  readRequiredFile,
  sha256,
} from "../quality/record-validator-common";

type JsonRecord = Record<string, unknown>;

const [smokeRecordPath, updateStatusRecordPath, evidenceBundlePath] = process.argv.slice(2);

function main(): void {
  if (!smokeRecordPath || !updateStatusRecordPath || !evidenceBundlePath) {
    console.error("Usage: pnpm ops:ops-001:closure <prod-readonly-smoke-record.txt> <redacted-update-status.json> <operational-evidence-bundle.json>");
    process.exit(2);
  }

  const absoluteSmokeRecordPath = path.resolve(smokeRecordPath);
  const absoluteUpdateStatusRecordPath = path.resolve(updateStatusRecordPath);
  const absoluteEvidenceBundlePath = path.resolve(evidenceBundlePath);

  runValidator("production readonly smoke record", "scripts/quality/prod-readonly-smoke-validate.ts", absoluteSmokeRecordPath);
  runValidator("update-agent status record", "scripts/quality/update-agent-status-validate.ts", absoluteUpdateStatusRecordPath);
  runValidator("operational evidence bundle", "scripts/quality/operational-evidence-bundle-validate.ts", absoluteEvidenceBundlePath);

  const smokeRecord = readRequiredFile(absoluteSmokeRecordPath);
  const smokeFields = parseIndentedKeyValueRecord(smokeRecord);
  const updateStatusRecord = readRequiredFile(absoluteUpdateStatusRecordPath);
  const updateStatus = parseUpdateStatus(updateStatusRecord);
  const evidenceBundleRecord = readRequiredFile(absoluteEvidenceBundlePath);
  const evidenceBundle = parseJsonRecord(extractJson(evidenceBundleRecord), "operational evidence bundle");

  const generatedAt = new Date().toISOString();
  const packet = [
    `packetId: ops-001-closure-${compactTimestamp(generatedAt)}`,
    `generatedAt: ${generatedAt}`,
    "residualRiskId: AF-RISK-OPS-001",
    `environment: ${field(smokeFields, "environment")}`,
    `baseUrl: ${field(smokeFields, "baseUrl")}`,
    `expectedVersion: ${field(smokeFields, "expectedVersion")}`,
    `releaseTag: ${field(smokeFields, "releaseTag")}`,
    `smokeRecordHash: sha256:${sha256(smokeRecord)}`,
    "smokeValidation: pass",
    `smokeCheckedAt: ${field(smokeFields, "checkedAt")}`,
    `smokeStatus: ${field(smokeFields, "smokeStatus")}`,
    `smokePasswordReadFromFile: ${field(smokeFields, "smokePasswordReadFromFile")}`,
    `smokeUpdateStatusIncluded: ${field(smokeFields, "updateStatusIncluded")}`,
    `updateAgentStatusRecordHash: sha256:${sha256(updateStatusRecord)}`,
    "updateAgentValidation: pass",
    `updateAgentCurrentVersion: ${stringValue(updateStatus.currentVersion, "unknown")}`,
    `updateAgentAutoApply: ${stringValue(updateStatus.autoApply, "unknown")}`,
    `updateAgentSignatureRequired: ${String(updateStatus.signatureRequired)}`,
    `updateAgentBlocker: ${updateStatus.blocker == null ? "null" : singleLine(String(updateStatus.blocker))}`,
    `updateAgentRollbackAvailable: ${String(asRecord(updateStatus.rollback).available)}`,
    `operationalEvidenceBundleHash: sha256:${stringValue(evidenceBundle.bundleHash, "unknown")}`,
    "operationalEvidenceBundleValidation: pass",
    `operationalEvidenceBundleStatus: ${stringValue(evidenceBundle.status, "unknown")}`,
    `authenticatedSmokeSignalStatus: ${signalStatus(evidenceBundle, "signal:authenticatedSmoke")}`,
    `updateAgentSignalStatus: ${signalStatus(evidenceBundle, "signal:updateAgent")}`,
    `updaterEnvSummary: ${field(smokeFields, "updaterEnvSummary")}`,
    `updateRecordSummary: ${field(smokeFields, "updateRecordSummary")}`,
    "closeConditionEvidence: server extra smoke command configured, smoke password file used, production read-only smoke passed, update-agent status validated, evidence bundle indexed",
    "residualLedgerAction: ready-for-human-close-after-review",
    "followUpTasks: docs/development/residual-risk-ledger.md and tasks/indexes/residuals.md",
    "safetyFacts:",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  productionWriteAttempted: no",
    "  secretValuePrinted: no",
    "  updaterApplyAttempted: no",
    "  residualLedgerUpdated: no",
    "",
  ].join("\n");

  process.stdout.write(packet);
}

function runValidator(label: string, scriptPath: string, targetPath: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", scriptPath, targetPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(`FAIL OPS-001 closure packet: ${label} validation failed`);
    if (result.stdout.trim()) console.error(result.stdout.trim());
    if (result.stderr.trim()) console.error(result.stderr.trim());
    process.exit(1);
  }
}

function parseUpdateStatus(raw: string): JsonRecord {
  const body = parseJsonRecord(raw, "update-agent status record");
  return isRecord(body.status) ? body.status : body;
}

function parseJsonRecord(raw: string, label: string): JsonRecord {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function extractJson(raw: string): string {
  const firstBrace = raw.indexOf("{");
  return firstBrace >= 0 ? raw.slice(firstBrace).trim() : raw.trim();
}

function field(fields: Map<string, string>, key: string): string {
  return singleLine(fields.get(key) ?? "unknown");
}

function signalStatus(bundle: JsonRecord, key: string): string {
  const items = Array.isArray(bundle.items) ? bundle.items : [];
  const match = items.find((item) => isRecord(item) && item.key === key);
  return isRecord(match) ? stringValue(match.status, "unknown") : "unknown";
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? singleLine(value) : fallback;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactTimestamp(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 14) || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

try {
  main();
} catch (error) {
  console.error(`FAIL OPS-001 closure packet generation: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
