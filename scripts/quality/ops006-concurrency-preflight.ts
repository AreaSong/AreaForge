import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateDataIntegrityDoctor } from "./data-integrity-doctor-validate";

export type Ops006PreflightStatus =
  | "awaiting_high_risk_confirmation"
  | "invalid";

export function ops006PreflightExitCode(status: Ops006PreflightStatus, strict: boolean): 0 | 1 {
  return status === "invalid" || strict ? 1 : 0;
}

type PreflightOptions = {
  root?: string;
  schemaPath?: string;
  migrationPath?: string;
  doctorPath?: string;
  now?: Date;
  maxDoctorAgeHours?: number;
};

type Check = {
  status: "pass" | "missing" | "invalid";
  detail: string;
};

const expectedIndexPattern = /^CREATE\s+UNIQUE\s+INDEX\s+"StudySession_one_active_idx"\s+ON\s+"StudySession"\s*\(\s*\(1\)\s*\)\s+WHERE\s+"status"\s+IN\s*\(\s*'RUNNING'\s*,\s*'PAUSED'\s*\)$/i;
const evidenceClass = "migration_preimage_candidate";
const sourceContractId = "OPS-006-PREFLIGHT-CONTRACT-V1";
const implementationConfirmationPhrase = "确认执行 OPS-006 业务状态并发一致性本地实施";

export function buildOps006ConcurrencyPreflight(options: PreflightOptions = {}) {
  const root = options.root ?? process.cwd();
  const schemaPath = options.schemaPath ?? path.join(root, "prisma/schema.prisma");
  const migrationPath = options.migrationPath ?? process.env.AREAFORGE_OPS006_CANDIDATE_MIGRATION?.trim() ?? "";
  const doctorPath = options.doctorPath ?? process.env.AREAFORGE_OPS006_DOCTOR_RECORD?.trim() ?? "";
  const taskPath = path.join(root, "tasks/active/0020-business-state-concurrency.md");
  const designPath = path.join(root, "docs/development/ops-006-business-state-concurrency-design.md");
  const confirmationPacketPath = path.join(root, "docs/development/high-risk-confirmation-packets.md");

  const checks = {
    task: checkTask(taskPath),
    designContract: checkDesignContract(designPath),
    confirmationPacket: checkConfirmationPacket(confirmationPacketPath),
    currentSchema: checkCurrentSchema(schemaPath),
    candidateMigration: checkCandidateMigration(root, migrationPath),
    doctor: checkDoctor(root, doctorPath, options.now ?? new Date(), options.maxDoctorAgeHours ?? 24),
  };
  const invalid = Object.values(checks).some((check) => check.status === "invalid");
  const candidateEvidenceComplete = checks.candidateMigration.status === "pass" && checks.doctor.status === "pass";
  const status: Ops006PreflightStatus = invalid ? "invalid" : "awaiting_high_risk_confirmation";

  return {
    schemaVersion: 2,
    mode: "read_only_ops006_concurrency_preflight",
    evidenceClass,
    status,
    candidateEvidenceStatus: invalid ? "invalid" : candidateEvidenceComplete ? "complete" : "incomplete",
    strictGate: {
      status: "blocked",
      reason: "explicit OPS-006 high-risk implementation confirmation is not represented by this preflight",
    },
    checks,
    expectedContract: {
      sourceContractId,
      activeSessionIndex: "StudySession_one_active_idx",
      indexShape: "unique constant-expression index where status is RUNNING or PAUSED",
      migrationPolicy: "additive-only; no DROP, DELETE, TRUNCATE, UPDATE, backfill, or historical repair",
      taskStatePolicy: "exact action/source-state matrix; stale or same-terminal retry returns TASK_STATE_CONFLICT without side effects",
      checkInLockPolicy: "pg_advisory_xact_lock(1095123785, YYYYMMDD) before aggregate reads, ordered by Asia/Shanghai study day",
      doctorPolicy: "validated redacted doctor record only; does not prove future concurrency safety",
      evidencePolicy: "migration/preimage candidate only; never implementation, CAS, apply, production, or confirmation evidence",
    },
    evidence: {
      task: relativePath(root, taskPath),
      taskSha256: fileSha256(taskPath),
      design: relativePath(root, designPath),
      designSha256: fileSha256(designPath),
      confirmationPacket: relativePath(root, confirmationPacketPath),
      confirmationPacketSha256: fileSha256(confirmationPacketPath),
      sourceContractId,
      implementationConfirmationPhraseSha256: textSha256(implementationConfirmationPhrase),
      schema: relativePath(root, schemaPath),
      schemaSha256: fileSha256(schemaPath),
      candidateMigration: migrationPath ? relativePath(root, path.resolve(root, migrationPath)) : null,
      candidateMigrationSha256: migrationPath ? fileSha256(path.resolve(root, migrationPath)) : null,
      doctor: doctorPath ? relativePath(root, path.resolve(root, doctorPath)) : null,
      doctorFileSha256: doctorPath ? fileSha256(path.resolve(root, doctorPath)) : null,
      doctorHash: doctorPath ? readDoctorHash(path.resolve(root, doctorPath)) : null,
    },
    requiredNextSteps: [
      "obtain explicit OPS-006 high-risk confirmation",
      "implement additive partial unique index and expected-status CAS",
      "run isolated PostgreSQL concurrency fixture and API 409 validation",
      "run pnpm check and retain fresh redacted doctor evidence",
    ],
    doesNotProve: [
      "OPS-006 high-risk implementation confirmation",
      "candidate migration approved or applied",
      "database migration applied",
      "business service CAS implementation",
      "future concurrency safety",
      "production data integrity or production migration",
      "residual ledger closure",
    ],
    forbiddenActions: [
      "run_migration",
      "write_database",
      "repair_or_delete_history",
      "execute_server_command",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      databaseReadAttempted: false,
      databaseWriteAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      residualLedgerUpdated: false,
    },
  };
}

function checkTask(taskPath: string): Check {
  if (!existsSync(taskPath)) return { status: "invalid", detail: "OPS-006 task file is missing" };
  const raw = readFileSync(taskPath, "utf8");
  if (!/^status:\s+blocked\s*$/m.test(raw) || !/^phase:\s+awaiting-high-risk-confirmation\s*$/m.test(raw)) {
    return { status: "invalid", detail: "OPS-006 task must remain blocked until explicit confirmation" };
  }
  if (!raw.includes(implementationConfirmationPhrase)) {
    return { status: "invalid", detail: "OPS-006 exact confirmation phrase is missing" };
  }
  if (!raw.includes(sourceContractId) || !raw.includes(`evidenceClass: ${evidenceClass}`)) {
    return { status: "invalid", detail: "OPS-006 task preflight source contract is missing" };
  }
  return { status: "pass", detail: "task is hash-bound and explicitly blocked behind implementation confirmation" };
}

function checkDesignContract(designPath: string): Check {
  if (!existsSync(designPath)) return { status: "invalid", detail: "OPS-006 design file is missing" };
  const raw = readFileSync(designPath, "utf8");
  const required = [
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    "不证明 CAS 已实现",
    "任务动作状态矩阵",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "design source contract matches migration/preimage candidate semantics" }
    : { status: "invalid", detail: `OPS-006 design source contract is incomplete: ${missing.join(", ")}` };
}

function checkConfirmationPacket(packetPath: string): Check {
  if (!existsSync(packetPath)) return { status: "invalid", detail: "high-risk confirmation packet file is missing" };
  const raw = readFileSync(packetPath, "utf8");
  const sectionStart = raw.indexOf("## OPS-006 业务状态并发一致性本地实施确认包");
  const sectionEnd = raw.indexOf("\n## ", sectionStart + 4);
  const section = sectionStart >= 0 ? raw.slice(sectionStart, sectionEnd >= 0 ? sectionEnd : undefined) : "";
  const required = [
    "状态：等待确认",
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    "strict 必须非零退出",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !section.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "confirmation packet is hash-bound and remains awaiting implementation confirmation" }
    : { status: "invalid", detail: `OPS-006 confirmation packet contract is incomplete: ${missing.join(", ")}` };
}

function checkCurrentSchema(schemaPath: string): Check {
  if (!existsSync(schemaPath)) return { status: "invalid", detail: "Prisma schema is missing" };
  const raw = readFileSync(schemaPath, "utf8");
  if (!/model\s+StudySession\s*\{/m.test(raw)) return { status: "invalid", detail: "StudySession model is missing" };
  if (/StudySession_one_active_idx|@@unique\s*\(\s*\[\s*status\s*\]\s*\)/i.test(raw)) {
    return { status: "invalid", detail: "schema already contains an unreviewed active-session uniqueness marker" };
  }
  return { status: "pass", detail: "current schema is unchanged; active-session uniqueness remains unimplemented" };
}

function checkCandidateMigration(root: string, migrationPath: string): Check {
  if (!migrationPath) return { status: "missing", detail: "no candidate migration supplied; no migration was inspected" };
  const resolved = path.resolve(root, migrationPath);
  if (!existsSync(resolved)) return { status: "invalid", detail: "candidate migration path does not exist" };
  const withoutComments = stripSqlComments(readFileSync(resolved, "utf8"));
  if (withoutComments === null) return { status: "invalid", detail: "candidate migration contains an unterminated SQL quote or block comment" };
  const statements = splitSqlStatements(withoutComments);
  if (statements.length !== 1 || !expectedIndexPattern.test(statements[0] ?? "")) {
    return { status: "invalid", detail: "candidate migration must contain exactly the canonical active-session partial unique index" };
  }
  return { status: "pass", detail: "candidate migration is additive and matches the expected index contract" };
}

function checkDoctor(root: string, doctorPath: string, now: Date, maxAgeHours: number): Check {
  if (!doctorPath) return { status: "missing", detail: "no redacted data-integrity doctor record supplied" };
  const resolved = path.resolve(root, doctorPath);
  if (!existsSync(resolved)) return { status: "invalid", detail: "doctor record path does not exist" };
  const raw = readFileSync(resolved, "utf8");
  const issues = validateDataIntegrityDoctor(raw);
  if (issues.length > 0) return { status: "invalid", detail: `doctor record failed validation: ${issues.join(", ")}` };
  const body = JSON.parse(raw) as {
    generatedAt?: string;
    source?: { database?: string };
    safetyFacts?: { databaseReadAttempted?: boolean };
    checks?: Array<{ id?: string; status?: string; details?: Record<string, unknown> }>;
  };
  if (body.source?.database !== "configured_read_only_query" || body.safetyFacts?.databaseReadAttempted !== true) {
    return { status: "invalid", detail: "doctor record must come from a configured read-only database query" };
  }
  const generatedAt = new Date(body.generatedAt ?? "");
  const ageHours = (now.getTime() - generatedAt.getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours < -0.5 || ageHours > maxAgeHours) {
    return { status: "invalid", detail: `doctor record must be fresh within ${maxAgeHours} hours` };
  }
  const checks = new Map((body.checks ?? []).map((item) => [item.id, item]));
  const required = [
    "study_sessions.active_cardinality",
    "study_sessions.state_consistency",
    "study_sessions.stale_active",
    "study_tasks.state_consistency",
  ];
  if (required.some((id) => checks.get(id)?.status !== "pass")) {
    return { status: "invalid", detail: "session/task doctor checks must pass for OPS-006 review" };
  }
  const activeCount = checks.get("study_sessions.active_cardinality")?.details?.activeSessionCount;
  if (!Number.isInteger(activeCount) || Number(activeCount) > 1) {
    return { status: "invalid", detail: "doctor record reports more than one active StudySession" };
  }
  return { status: "pass", detail: "fresh read-only doctor session/task checks pass; attachment status is reported separately" };
}

function stripSqlComments(sql: string): string | null {
  let output = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (quote) {
      output += current;
      if (current === quote) {
        if (next === quote) output += sql[++index] ?? "";
        else quote = null;
      }
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      output += current;
      continue;
    }
    if (current === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += " ";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      if (index >= sql.length) return null;
      index += 1;
      output += " ";
      continue;
    }
    output += current;
  }
  return quote ? null : output;
}

function splitSqlStatements(sql: string): string[] {
  return sql.split(";").map((statement) => statement.trim()).filter(Boolean);
}

function relativePath(root: string, value: string): string {
  const relative = path.relative(root, value);
  return relative && !relative.startsWith("..") ? relative : "<redacted path>";
}

function fileSha256(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}

function textSha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function readDoctorHash(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as { doctorHash?: unknown };
    return typeof value.doctorHash === "string" && /^sha256:[a-f0-9]{64}$/.test(value.doctorHash)
      ? value.doctorHash
      : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const result = buildOps006ConcurrencyPreflight();
  console.log(JSON.stringify(result, null, 2));
  const strict = process.argv.includes("--require-candidate-ready");
  process.exitCode = ops006PreflightExitCode(result.status, strict);
}
