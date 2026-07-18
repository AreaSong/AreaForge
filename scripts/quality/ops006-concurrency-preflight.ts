import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateDataIntegrityDoctor } from "./data-integrity-doctor-validate";
import { validateOps006RuntimeRecord } from "./ops006-concurrency-runtime-validate";

export type Ops006PreflightStatus =
  | "awaiting_high_risk_confirmation"
  | "local_validation"
  | "local_verified"
  | "invalid";

export function ops006PreflightExitCode(status: Ops006PreflightStatus, strict: boolean): 0 | 1 {
  return status === "invalid" || (strict && status !== "local_verified") ? 1 : 0;
}

type PreflightOptions = {
  root?: string;
  schemaPath?: string;
  migrationPath?: string;
  doctorPath?: string;
  runtimePath?: string;
  now?: Date;
  maxEvidenceAgeHours?: number;
};

type Check = {
  status: "pass" | "missing" | "invalid";
  detail: string;
};

const expectedIndexPattern = /^CREATE\s+UNIQUE\s+INDEX\s+"StudySession_one_active_idx"\s+ON\s+"StudySession"\s*\(\s*\(1\)\s*\)\s+WHERE\s+"status"\s+IN\s*\(\s*'RUNNING'\s*,\s*'PAUSED'\s*\)$/i;
const candidateEvidenceClass = "migration_preimage_candidate";
const localEvidenceClass = "local_concurrency_verified";
const sourceContractId = "OPS-006-PREFLIGHT-CONTRACT-V2";
const implementationConfirmationPhrase = "确认执行 OPS-006 业务状态并发一致性本地实施";
const defaultMigrationPath = "prisma/migrations/20260718010000_add_active_session_unique_index/migration.sql";

export function buildOps006ConcurrencyPreflight(options: PreflightOptions = {}) {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const maxEvidenceAgeHours = options.maxEvidenceAgeHours ?? 24;
  const schemaPath = options.schemaPath ?? path.join(root, "prisma/schema.prisma");
  const migrationPath = options.migrationPath
    ?? process.env.AREAFORGE_OPS006_CANDIDATE_MIGRATION?.trim()
    ?? defaultMigrationPath;
  const doctorPath = options.doctorPath ?? process.env.AREAFORGE_OPS006_DOCTOR_RECORD?.trim() ?? "";
  const runtimePath = options.runtimePath ?? process.env.AREAFORGE_OPS006_RUNTIME_RECORD?.trim() ?? "";
  const taskPath = path.join(root, "tasks/active/0020-business-state-concurrency.md");
  const designPath = path.join(root, "docs/development/ops-006-business-state-concurrency-design.md");
  const confirmationPacketPath = path.join(root, "docs/development/high-risk-confirmation-packets.md");
  const taskPhase = readTaskPhase(taskPath);

  const checks = {
    task: checkTask(taskPath),
    designContract: checkDesignContract(designPath),
    confirmationPacket: checkConfirmationPacket(confirmationPacketPath),
    currentSchema: checkCurrentSchema(schemaPath),
    candidateMigration: checkCandidateMigration(root, migrationPath),
    doctor: checkDoctor(root, doctorPath, now, maxEvidenceAgeHours),
    runtime: checkRuntime(root, runtimePath, now, maxEvidenceAgeHours),
  };
  const invalid = Object.values(checks).some((check) => check.status === "invalid");
  const candidateEvidenceComplete = checks.candidateMigration.status === "pass" && checks.doctor.status === "pass";
  const localEvidenceComplete = candidateEvidenceComplete && checks.runtime.status === "pass";
  const status = determineStatus(taskPhase, invalid, localEvidenceComplete);

  return {
    schemaVersion: 3,
    mode: "read_only_ops006_concurrency_preflight",
    evidenceClass: taskPhase === "local-verified" ? localEvidenceClass : candidateEvidenceClass,
    status,
    taskPhase,
    candidateEvidenceStatus: invalid ? "invalid" : candidateEvidenceComplete ? "complete" : "incomplete",
    localEvidenceStatus: invalid ? "invalid" : localEvidenceComplete ? "complete" : "incomplete",
    strictGate: status === "local_verified"
      ? { status: "ready", reason: "current checkout, canonical migration, fresh doctor, and isolated PostgreSQL runtime evidence are hash-bound" }
      : { status: "blocked", reason: "OPS-006 local_verified evidence is incomplete or source-bound phase is not local-verified" },
    checks,
    expectedContract: {
      sourceContractId,
      activeSessionIndex: "StudySession_one_active_idx",
      indexShape: "unique constant-expression index where status is RUNNING or PAUSED",
      migrationPolicy: "additive-only; no DROP, DELETE, TRUNCATE, UPDATE, backfill, or historical repair",
      taskStatePolicy: "exact action/source-state matrix; stale or same-terminal retry returns TASK_STATE_CONFLICT without side effects",
      checkInLockPolicy: "pg_advisory_xact_lock(1095123785, YYYYMMDD) before aggregate reads, ordered by Asia/Shanghai study day",
      evidencePolicy: "local_verified proves only the current local checkout and isolated PostgreSQL fixture; release and production remain separately blocked",
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
      runtime: runtimePath ? relativePath(root, path.resolve(root, runtimePath)) : null,
      runtimeFileSha256: runtimePath ? fileSha256(path.resolve(root, runtimePath)) : null,
      runtimeRecordHash: runtimePath ? readRuntimeHash(path.resolve(root, runtimePath)) : null,
    },
    requiredNextSteps: status === "local_verified"
      ? [
          "review the local implementation and exact commit",
          "create a separately admitted signed Release before any deployment",
          "obtain independent production migration/deploy confirmation with fresh production doctor evidence",
        ]
      : [
          "retain explicit OPS-006 local implementation confirmation",
          "complete additive migration and expected-status CAS implementation",
          "run isolated PostgreSQL concurrency fixture and validate its redacted record",
          "retain fresh read-only doctor evidence",
        ],
    doesNotProve: [
      "signed Release readiness",
      "production data integrity",
      "production migration or deployment authorization",
      "production concurrency safety",
      "AF-RISK-OPS-006 residual closure",
    ],
    forbiddenActions: [
      "run_production_migration",
      "repair_or_delete_history",
      "create_release_or_tag",
      "execute_server_command",
      "read_or_print_secret_values",
      "close_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      databaseReadAttempted: false,
      databaseWriteAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      residualLedgerClosed: false,
    },
  };
}

function determineStatus(taskPhase: string | null, invalid: boolean, localEvidenceComplete: boolean): Ops006PreflightStatus {
  if (invalid) return "invalid";
  if (taskPhase === "awaiting-high-risk-confirmation") return "awaiting_high_risk_confirmation";
  if (taskPhase === "local-verified" && localEvidenceComplete) return "local_verified";
  return "local_validation";
}

function checkTask(taskPath: string): Check {
  if (!existsSync(taskPath)) return { status: "invalid", detail: "OPS-006 task file is missing" };
  const raw = readFileSync(taskPath, "utf8");
  const phase = readTaskPhase(taskPath);
  const awaiting = /^status:\s+blocked\s*$/m.test(raw)
    && phase === "awaiting-high-risk-confirmation"
    && raw.includes(`evidenceClass: ${candidateEvidenceClass}`);
  const locallyVerified = /^status:\s+in-progress\s*$/m.test(raw)
    && phase === "local-verified"
    && raw.includes(`evidenceClass: ${localEvidenceClass}`)
    && raw.includes("production_confirmation_required");
  if (!awaiting && !locallyVerified) {
    return { status: "invalid", detail: "OPS-006 task status, phase, and evidence class are inconsistent" };
  }
  if (!raw.includes(implementationConfirmationPhrase) || !raw.includes(sourceContractId)) {
    return { status: "invalid", detail: "OPS-006 task source contract or exact confirmation phrase is missing" };
  }
  return { status: "pass", detail: locallyVerified ? "task records local_verified with production still blocked" : "task remains blocked behind confirmation" };
}

function checkDesignContract(designPath: string): Check {
  if (!existsSync(designPath)) return { status: "invalid", detail: "OPS-006 design file is missing" };
  const raw = readFileSync(designPath, "utf8");
  const required = [
    sourceContractId,
    localEvidenceClass,
    "任务动作状态矩阵",
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "local_verified",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "design contract separates local verification from release and production" }
    : { status: "invalid", detail: `OPS-006 design source contract is incomplete: ${missing.join(", ")}` };
}

function checkConfirmationPacket(packetPath: string): Check {
  if (!existsSync(packetPath)) return { status: "invalid", detail: "high-risk confirmation packet file is missing" };
  const raw = readFileSync(packetPath, "utf8");
  const sectionStart = raw.indexOf("## OPS-006 业务状态并发一致性本地实施确认包");
  const sectionEnd = raw.indexOf("\n## ", sectionStart + 4);
  const section = sectionStart >= 0 ? raw.slice(sectionStart, sectionEnd >= 0 ? sectionEnd : undefined) : "";
  const required = [
    "状态：已确认",
    sourceContractId,
    localEvidenceClass,
    "pg_advisory_xact_lock(1095123785, YYYYMMDD)",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !section.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "confirmation packet records local implementation authorization without production authority" }
    : { status: "invalid", detail: `OPS-006 confirmation packet contract is incomplete: ${missing.join(", ")}` };
}

function checkCurrentSchema(schemaPath: string): Check {
  if (!existsSync(schemaPath)) return { status: "invalid", detail: "Prisma schema is missing" };
  const raw = readFileSync(schemaPath, "utf8");
  if (!/model\s+StudySession\s*\{/m.test(raw)) return { status: "invalid", detail: "StudySession model is missing" };
  if (/StudySession_one_active_idx|@@unique\s*\(\s*\[\s*status\s*\]\s*\)/i.test(raw)) {
    return { status: "invalid", detail: "Prisma schema must not model the PostgreSQL partial unique index as status uniqueness" };
  }
  return { status: "pass", detail: "Prisma schema intentionally leaves the partial index to the canonical SQL migration" };
}

function checkCandidateMigration(root: string, migrationPath: string): Check {
  if (!migrationPath) return { status: "missing", detail: "no candidate migration supplied" };
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
  if (!isFresh(body.generatedAt, now, maxAgeHours)) return { status: "invalid", detail: `doctor record must be fresh within ${maxAgeHours} hours` };
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

function checkRuntime(root: string, runtimePath: string, now: Date, maxAgeHours: number): Check {
  if (!runtimePath) return { status: "missing", detail: "no isolated PostgreSQL runtime record supplied" };
  const resolved = path.resolve(root, runtimePath);
  if (!existsSync(resolved)) return { status: "invalid", detail: "runtime record path does not exist" };
  const issues = validateOps006RuntimeRecord(readFileSync(resolved, "utf8"), { root, now, maxAgeHours });
  return issues.length === 0
    ? { status: "pass", detail: "fresh isolated PostgreSQL migration, CAS, 409, side-effect, and CheckIn evidence passed" }
    : { status: "invalid", detail: `runtime record failed validation: ${issues.join(", ")}` };
}

function readTaskPhase(taskPath: string): string | null {
  if (!existsSync(taskPath)) return null;
  return readFileSync(taskPath, "utf8").match(/^phase:\s+([^\s]+)\s*$/m)?.[1] ?? null;
}

function isFresh(value: string | undefined, now: Date, maxAgeHours: number): boolean {
  const generatedAt = new Date(value ?? "");
  const ageHours = (now.getTime() - generatedAt.getTime()) / 3_600_000;
  return Number.isFinite(ageHours) && ageHours >= -0.5 && ageHours <= maxAgeHours;
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
  return readJsonHash(filePath, "doctorHash");
}

function readRuntimeHash(filePath: string): string | null {
  return readJsonHash(filePath, "recordHash");
}

function readJsonHash(filePath: string, field: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const hash = value[field];
    return typeof hash === "string" && /^sha256:[a-f0-9]{64}$/.test(hash) ? hash : null;
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
