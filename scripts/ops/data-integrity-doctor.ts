import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createPrismaClient } from "../../packages/db/src/index";
import {
  validateAttachmentReconciliationSummary,
  type AttachmentReconciliationSummary,
} from "../quality/attachment-reconciliation-summary";

type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface DataIntegritySnapshot {
  activeSessionCount: number;
  staleActiveSessionCount: number;
  runningWithPausedAtCount: number;
  pausedWithoutPausedAtCount: number;
  activeWithEndedAtCount: number;
  terminalWithoutEndedAtCount: number;
  terminalWithPausedAtCount: number;
  negativeSessionMetricsCount: number;
  doneWithoutCompletedAtCount: number;
  nonDoneWithCompletedAtCount: number;
  doneWithDebtCount: number;
  negativeTaskMinutesCount: number;
}

export interface DataIntegrityCheck {
  id: string;
  status: CheckStatus;
  message: string;
  details: Record<string, number | string | boolean | null>;
}

export interface DataIntegrityDoctorResult {
  schemaVersion: 1;
  mode: "read_only_data_integrity_doctor";
  generatedAt: string;
  status: {
    overall: "pass" | "warn" | "fail";
    native: "integrity_clean" | "integrity_attention" | "partial";
  };
  counts: Record<CheckStatus | "total", number>;
  thresholds: { staleActiveSessionHours: number };
  checks: DataIntegrityCheck[];
  source: {
    database: "configured_read_only_query" | "fixture";
    attachmentSummarySha256: string | null;
  };
  doesNotProve: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: boolean;
    databaseReadAttempted: boolean;
    databaseWriteAttempted: false;
    uploadDirectoryReadAttempted: false;
    fileWriteAttempted: false;
    attachmentContentIncluded: false;
    objectIdentifiersIncluded: false;
    absolutePathIncluded: false;
    secretValuePrinted: false;
  };
  doctorHash: string;
}

export function buildDataIntegrityDoctor(input: {
  snapshot: DataIntegritySnapshot;
  attachmentSummary?: AttachmentReconciliationSummary | null;
  generatedAt?: string;
  staleActiveSessionHours?: number;
  databaseReadAttempted?: boolean;
}): DataIntegrityDoctorResult {
  const attachment = input.attachmentSummary ?? null;
  const checks: DataIntegrityCheck[] = [
    check(
      "study_sessions.active_cardinality",
      input.snapshot.activeSessionCount <= 1 ? "pass" : "fail",
      input.snapshot.activeSessionCount <= 1 ? "active session cardinality is valid" : "multiple active study sessions detected",
      { activeSessionCount: input.snapshot.activeSessionCount, allowedMaximum: 1 },
    ),
    checkFromCounts("study_sessions.state_consistency", "study session state fields are consistent", "study session state contradictions detected", {
      runningWithPausedAtCount: input.snapshot.runningWithPausedAtCount,
      pausedWithoutPausedAtCount: input.snapshot.pausedWithoutPausedAtCount,
      activeWithEndedAtCount: input.snapshot.activeWithEndedAtCount,
      terminalWithoutEndedAtCount: input.snapshot.terminalWithoutEndedAtCount,
      terminalWithPausedAtCount: input.snapshot.terminalWithPausedAtCount,
      negativeSessionMetricsCount: input.snapshot.negativeSessionMetricsCount,
    }),
    check(
      "study_sessions.stale_active",
      input.snapshot.staleActiveSessionCount === 0 ? "pass" : "warn",
      input.snapshot.staleActiveSessionCount === 0 ? "no stale active sessions detected" : "stale active study sessions require review",
      { staleActiveSessionCount: input.snapshot.staleActiveSessionCount },
    ),
    taskStateCheck(input.snapshot),
    attachment
      ? check(
          "attachments.reconciliation",
          attachment.status === "pass" ? "pass" : "fail",
          attachment.status === "pass" ? "attachment reconciliation summary is clean" : "attachment reconciliation summary contains mismatches",
          {
            databaseRecordCount: attachment.counts.databaseRecordCount,
            uploadFileCount: attachment.counts.uploadFileCount,
            mismatchCount: attachmentMismatchCount(attachment),
          },
        )
      : check("attachments.reconciliation", "skipped", "attachment reconciliation summary was not supplied", {}),
  ];
  const counts = countChecks(checks);
  const overall = counts.fail > 0 ? "fail" : counts.warn > 0 || counts.skipped > 0 ? "warn" : "pass";
  const native = counts.fail > 0 || counts.warn > 0
    ? "integrity_attention"
    : counts.skipped > 0 ? "partial" : "integrity_clean";
  const resultWithoutHash = {
    schemaVersion: 1 as const,
    mode: "read_only_data_integrity_doctor" as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: { overall, native },
    counts,
    thresholds: { staleActiveSessionHours: input.staleActiveSessionHours ?? 24 },
    checks,
    source: {
      database: input.databaseReadAttempted === false ? "fixture" as const : "configured_read_only_query" as const,
      attachmentSummarySha256: attachment ? `sha256:${sha256(canonicalJson(attachment))}` : null,
    },
    doesNotProve: [
      "automatic data repair or deletion",
      "future concurrency safety after this snapshot",
      "attachment integrity unless a validated reconciliation summary is supplied",
      "production health, backup freshness, updater apply, migration, or rollback execution",
    ],
    safetyFacts: {
      readOnly: true as const,
      networkRequested: input.databaseReadAttempted !== false,
      databaseReadAttempted: input.databaseReadAttempted !== false,
      databaseWriteAttempted: false as const,
      uploadDirectoryReadAttempted: false as const,
      fileWriteAttempted: false as const,
      attachmentContentIncluded: false as const,
      objectIdentifiersIncluded: false as const,
      absolutePathIncluded: false as const,
      secretValuePrinted: false as const,
    },
  };
  return { ...resultWithoutHash, doctorHash: computeDataIntegrityDoctorHash(resultWithoutHash) };
}

export function computeDataIntegrityDoctorHash(value: Record<string, unknown>): string {
  const { doctorHash: _doctorHash, ...withoutHash } = value;
  return `sha256:${sha256(canonicalJson(withoutHash))}`;
}

async function collectSnapshot(staleActiveSessionHours: number): Promise<DataIntegritySnapshot> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the read-only data integrity doctor");
  const prisma = createPrismaClient(databaseUrl);
  const staleBefore = new Date(Date.now() - staleActiveSessionHours * 60 * 60 * 1000);
  try {
    const values = await Promise.all([
      prisma.studySession.count({ where: { status: { in: ["RUNNING", "PAUSED"] } } }),
      prisma.studySession.count({ where: { status: { in: ["RUNNING", "PAUSED"] }, startedAt: { lt: staleBefore } } }),
      prisma.studySession.count({ where: { status: "RUNNING", pausedAt: { not: null } } }),
      prisma.studySession.count({ where: { status: "PAUSED", pausedAt: null } }),
      prisma.studySession.count({ where: { status: { in: ["RUNNING", "PAUSED"] }, endedAt: { not: null } } }),
      prisma.studySession.count({ where: { status: { in: ["COMPLETED", "CANCELED"] }, endedAt: null } }),
      prisma.studySession.count({ where: { status: { in: ["COMPLETED", "CANCELED"] }, pausedAt: { not: null } } }),
      prisma.studySession.count({ where: { OR: [{ accumulatedPauseSeconds: { lt: 0 } }, { effectiveMinutes: { lt: 0 } }] } }),
      prisma.studyTask.count({ where: { status: "DONE", completedAt: null } }),
      prisma.studyTask.count({ where: { status: { not: "DONE" }, completedAt: { not: null } } }),
      prisma.studyTask.count({ where: { status: "DONE", debtStatus: { not: "NONE" } } }),
      prisma.studyTask.count({ where: { OR: [{ estimatedMinutes: { lt: 0 } }, { actualMinutes: { lt: 0 } }] } }),
    ]);
    return {
      activeSessionCount: values[0],
      staleActiveSessionCount: values[1],
      runningWithPausedAtCount: values[2],
      pausedWithoutPausedAtCount: values[3],
      activeWithEndedAtCount: values[4],
      terminalWithoutEndedAtCount: values[5],
      terminalWithPausedAtCount: values[6],
      negativeSessionMetricsCount: values[7],
      doneWithoutCompletedAtCount: values[8],
      nonDoneWithCompletedAtCount: values[9],
      doneWithDebtCount: values[10],
      negativeTaskMinutesCount: values[11],
    };
  } finally {
    await prisma.$disconnect();
  }
}

function readAttachmentSummary(file: string | null): AttachmentReconciliationSummary | null {
  if (!file) return null;
  const resolved = path.resolve(file);
  if (!existsSync(resolved)) throw new Error("attachment reconciliation summary does not exist");
  const raw = readFileSync(resolved, "utf8");
  const issues = validateAttachmentReconciliationSummary(raw);
  if (issues.length > 0) throw new Error("attachment reconciliation summary is invalid");
  return JSON.parse(raw) as AttachmentReconciliationSummary;
}

function parseArgs(args: string[]): { attachmentSummary: string | null; staleActiveSessionHours: number } {
  let attachmentSummary: string | null = null;
  let staleActiveSessionHours = 24;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--attachment-summary") {
      attachmentSummary = args[++index] ?? null;
    } else if (arg === "--stale-active-hours") {
      staleActiveSessionHours = Number(args[++index]);
    } else if (arg !== "--") {
      throw new Error("unknown argument");
    }
  }
  if (!attachmentSummary && args.includes("--attachment-summary")) throw new Error("--attachment-summary requires a path");
  if (!Number.isInteger(staleActiveSessionHours) || staleActiveSessionHours < 1 || staleActiveSessionHours > 168) {
    throw new Error("--stale-active-hours must be an integer from 1 to 168");
  }
  return { attachmentSummary, staleActiveSessionHours };
}

function check(id: string, status: CheckStatus, message: string, details: DataIntegrityCheck["details"]): DataIntegrityCheck {
  return { id, status, message, details };
}

function checkFromCounts(id: string, passMessage: string, failMessage: string, details: Record<string, number>): DataIntegrityCheck {
  return check(id, Object.values(details).some((value) => value > 0) ? "fail" : "pass", Object.values(details).some((value) => value > 0) ? failMessage : passMessage, details);
}

function taskStateCheck(snapshot: DataIntegritySnapshot): DataIntegrityCheck {
  const details = {
    doneWithoutCompletedAtCount: snapshot.doneWithoutCompletedAtCount,
    nonDoneWithCompletedAtCount: snapshot.nonDoneWithCompletedAtCount,
    doneWithDebtCount: snapshot.doneWithDebtCount,
    negativeTaskMinutesCount: snapshot.negativeTaskMinutesCount,
  };
  const errorCount = snapshot.doneWithoutCompletedAtCount + snapshot.doneWithDebtCount + snapshot.negativeTaskMinutesCount;
  if (errorCount > 0) return check("study_tasks.state_consistency", "fail", "study task state contradictions detected", details);
  if (snapshot.nonDoneWithCompletedAtCount > 0) {
    return check("study_tasks.state_consistency", "warn", "non-completed tasks retain completedAt and require transition review", details);
  }
  return check("study_tasks.state_consistency", "pass", "study task state fields are consistent", details);
}

function countChecks(checks: DataIntegrityCheck[]): Record<CheckStatus | "total", number> {
  const counts = { total: checks.length, pass: 0, warn: 0, fail: 0, skipped: 0 };
  for (const item of checks) counts[item.status] += 1;
  return counts;
}

function attachmentMismatchCount(summary: AttachmentReconciliationSummary): number {
  const { databaseRecordCount: _databaseRecordCount, uploadFileCount: _uploadFileCount, ...mismatchCounts } = summary.counts;
  return Object.values(mismatchCounts).reduce((total, value) => total + value, 0);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = buildDataIntegrityDoctor({
    snapshot: await collectSnapshot(options.staleActiveSessionHours),
    attachmentSummary: readAttachmentSummary(options.attachmentSummary),
    staleActiveSessionHours: options.staleActiveSessionHours,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status.overall !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const failure = sanitizeDataIntegrityDoctorFailure(error);
    console.error(`data integrity doctor failed: ${failure.message}`);
    process.exitCode = failure.exitCode;
  }
}

export function sanitizeDataIntegrityDoctorFailure(error: unknown): { message: string; exitCode: 2 | 3 } {
  const message = error instanceof Error ? error.message : "";
  const inputMessages = new Set([
    "DATABASE_URL is required for the read-only data integrity doctor",
    "attachment reconciliation summary does not exist",
    "attachment reconciliation summary is invalid",
    "--attachment-summary requires a path",
    "--stale-active-hours must be an integer from 1 to 168",
    "unknown argument",
  ]);
  if (inputMessages.has(message)) return { message, exitCode: 2 };
  return { message: "read-only database query failed", exitCode: 3 };
}
