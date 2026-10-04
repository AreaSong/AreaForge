import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAttachmentCrashWindow } from "./attachment-crash-window-validate";
import { validateOps007RuntimeRecord } from "./ops007-attachment-runtime-validate";

export type Ops007PreflightStatus =
  | "awaiting_high_risk_confirmation"
  | "local_validation"
  | "local_verified"
  | "invalid";

export function ops007PreflightExitCode(status: Ops007PreflightStatus, strict: boolean): 0 | 1 {
  return status === "invalid" || (strict && status !== "local_verified") ? 1 : 0;
}

type PreflightOptions = {
  root?: string;
  taskPath?: string;
  designPath?: string;
  confirmationPacketPath?: string;
  schemaPath?: string;
  fixturePath?: string;
  migrationPath?: string;
  runtimePath?: string;
  now?: Date;
  maxEvidenceAgeHours?: number;
};

type Check = {
  status: "pass" | "missing" | "invalid";
  detail: string;
};

const candidateEvidenceClass = "protocol_preimage_candidate";
const localEvidenceClass = "local_attachment_protocol_verified";
const sourceContractId = "OPS-007-PREFLIGHT-CONTRACT-V2";
const implementationConfirmationPhrase =
  "确认执行 OPS-007 附件 staging/write-intent 本地实施";
const defaultMigrationPath = "prisma/migrations/20260721010000_attachment_staging_write_intent/migration.sql";

export function buildOps007AttachmentPreflight(options: PreflightOptions = {}) {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const maxEvidenceAgeHours = options.maxEvidenceAgeHours ?? 24;
  const taskPath = options.taskPath ?? path.join(root, "tasks/active/0021-attachment-staging-intent.md");
  const designPath =
    options.designPath ?? path.join(root, "docs/development/ops-007-attachment-crash-window-design.md");
  const confirmationPacketPath =
    options.confirmationPacketPath ?? path.join(root, "docs/development/high-risk-confirmation-packets.md");
  const schemaPath = options.schemaPath ?? path.join(root, "prisma/schema.prisma");
  const fixturePath =
    options.fixturePath ??
    path.join(root, "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json");
  const migrationPath = options.migrationPath
    ?? process.env.AREAFORGE_OPS007_CANDIDATE_MIGRATION?.trim()
    ?? defaultMigrationPath;
  const runtimePath = options.runtimePath ?? process.env.AREAFORGE_OPS007_RUNTIME_RECORD?.trim() ?? "";
  const taskPhase = readTaskPhase(taskPath);

  const checks = {
    task: checkTask(taskPath),
    designContract: checkDesignContract(designPath),
    confirmationPacket: checkConfirmationPacket(confirmationPacketPath),
    currentSchema: checkCurrentSchema(schemaPath),
    candidateMigration: checkCandidateMigration(root, migrationPath),
    fixture: checkFixture(fixturePath),
    runtime: checkRuntime(root, runtimePath, now, maxEvidenceAgeHours),
  };
  const invalid = Object.values(checks).some((check) => check.status === "invalid");
  const localEvidenceComplete = checks.candidateMigration.status === "pass" && checks.runtime.status === "pass";
  const status = determineStatus(taskPhase, invalid, localEvidenceComplete);
  const sourceHashes = {
    taskSha256: fileSha256(taskPath),
    designSha256: fileSha256(designPath),
    confirmationPacketSha256: fileSha256(confirmationPacketPath),
    schemaSha256: fileSha256(schemaPath),
    migrationSha256: migrationPath ? fileSha256(path.resolve(root, migrationPath)) : null,
    fixtureFileSha256: fileSha256(fixturePath),
    fixtureHash: readFixtureHash(fixturePath),
    runtimeFileSha256: runtimePath ? fileSha256(path.resolve(root, runtimePath)) : null,
    runtimeRecordHash: runtimePath ? readRuntimeHash(path.resolve(root, runtimePath)) : null,
  };

  return {
    schemaVersion: 2,
    mode: "read_only_ops007_attachment_preflight",
    evidenceClass: taskPhase === "local-verified" ? localEvidenceClass : candidateEvidenceClass,
    status,
    taskPhase,
    localEvidenceStatus: invalid ? "invalid" : localEvidenceComplete ? "complete" : "incomplete",
    strictGate: status === "local_verified"
      ? { status: "ready", reason: "current checkout, canonical additive migration, crash-window fixture, and fresh isolated PostgreSQL/upload-directory runtime evidence are hash-bound" }
      : { status: "blocked", reason: "OPS-007 local_verified evidence is incomplete or source-bound phase is not local-verified" },
    checks,
    expectedContract: {
      sourceContractId,
      protocol:
        "bounded streaming before explicit PENDING intent; exclusive staging write/fsync; atomic rename/fsync; hash verification; READY CAS",
      legacyPolicy: "legacy rows are READY/protocolVersion=0 compatibility only; new schema default and explicit intent are PENDING/protocolVersion=1",
      downloadPolicy: "READY plus same-handle O_NOFOLLOW + fstat + hash/size verification; browser DTO omits raw hash and internal storage fields",
      reconciliationPolicy: "bounded claim/lease reconciliation with DB/staging/final decision table; historical orphan remains report-only",
      migrationPolicy: "additive-only; no DROP, DELETE, TRUNCATE, UPDATE, backfill, or historical repair",
      evidencePolicy:
        "local_verified proves only the current local checkout with isolated PostgreSQL and temporary upload-directory fixtures; release and production remain separately blocked",
    },
    evidence: {
      task: relativePath(root, taskPath),
      design: relativePath(root, designPath),
      confirmationPacket: relativePath(root, confirmationPacketPath),
      schema: relativePath(root, schemaPath),
      candidateMigration: migrationPath ? relativePath(root, path.resolve(root, migrationPath)) : null,
      fixture: relativePath(root, fixturePath),
      runtime: runtimePath ? relativePath(root, path.resolve(root, runtimePath)) : null,
      sourceContractId,
      implementationConfirmationPhraseSha256: textSha256(implementationConfirmationPhrase),
      ...sourceHashes,
      sourceBindingHash: hashSourceBinding(sourceHashes),
    },
    requiredNextSteps: status === "local_verified"
      ? [
          "review the local implementation and exact commit",
          "create a separately admitted signed Release before any deployment",
          "obtain independent production migration/deploy confirmation with duplicate storage-identity doctor evidence",
        ]
      : [
          "retain explicit OPS-007 high-risk implementation confirmation",
          "complete the additive migration and write-intent protocol implementation",
          "run isolated PostgreSQL and temporary upload-directory crash-window selftests",
          "validate runtime O_NOFOLLOW, fsync, READY CAS, and bounded reconciliation behavior",
          "run pnpm db:validate, pnpm check, risk gates, and release-bound validation",
        ],
    doesNotProve: [
      "candidate or applied production database migration",
      "production attachment safety or production state",
      "filesystem durability guarantees outside the isolated fixture",
      "backup or restore success",
      "historical orphan cleanup or residual ledger closure",
      "signed Release readiness",
    ],
    forbiddenActions: [
      "run_migration",
      "connect_database",
      "write_or_delete_attachment_files",
      "read_upload_directory",
      "execute_server_or_production_command",
      "read_or_print_secret_values",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      databaseConnectionAttempted: false,
      databaseWriteAttempted: false,
      migrationAttempted: false,
      uploadDirectoryReadAttempted: false,
      filesystemMutationAttempted: false,
      productionWriteAttempted: false,
      secretValueReadOrPrinted: false,
      residualLedgerUpdated: false,
    },
  };
}

function determineStatus(taskPhase: string | null, invalid: boolean, localEvidenceComplete: boolean): Ops007PreflightStatus {
  if (invalid) return "invalid";
  if (taskPhase === "awaiting-high-risk-confirmation") return "awaiting_high_risk_confirmation";
  if (taskPhase === "local-verified" && localEvidenceComplete) return "local_verified";
  return "local_validation";
}

function checkTask(taskPath: string): Check {
  if (!existsSync(taskPath)) return { status: "invalid", detail: "OPS-007 task file is missing" };
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
    return { status: "invalid", detail: "OPS-007 task status, phase, and evidence class are inconsistent" };
  }
  if (!raw.includes(implementationConfirmationPhrase) || !raw.includes(sourceContractId)) {
    return { status: "invalid", detail: "OPS-007 task source contract or exact confirmation phrase is missing" };
  }
  return {
    status: "pass",
    detail: locallyVerified
      ? "task records local_verified with production still blocked"
      : "task remains blocked behind confirmation",
  };
}

function checkDesignContract(designPath: string): Check {
  if (!existsSync(designPath)) return { status: "invalid", detail: "OPS-007 design file is missing" };
  const raw = readFileSync(designPath, "utf8");
  const required = [
    sourceContractId,
    localEvidenceClass,
    "sourceBindingHash",
    "strict 必须非零退出",
    "Attachment.status AttachmentStatus @default(PENDING)",
    "有界上传读取",
    "reconciliationLeaseExpiresAt",
    "浏览器 DTO",
    "local_verified",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "design contract separates local verification from release and production" }
    : { status: "invalid", detail: `OPS-007 design source contract is incomplete: ${missing.join(", ")}` };
}

function checkConfirmationPacket(packetPath: string): Check {
  if (!existsSync(packetPath)) {
    return { status: "invalid", detail: "high-risk confirmation packet file is missing" };
  }
  const raw = readFileSync(packetPath, "utf8");
  const section = extractSection(raw, "## OPS-007 附件 Staging/Write-Intent 本地实施确认包");
  const required = [
    "状态：已确认",
    sourceContractId,
    localEvidenceClass,
    "strict 必须非零退出",
    "不执行生产 migration deploy",
    "不读取、打印、复制或提交 secrets",
    "有界流式读取",
    "reconciliation lease",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !section.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "confirmation packet records local implementation authorization without production authority" }
    : { status: "invalid", detail: `OPS-007 confirmation packet is incomplete: ${missing.join(", ")}` };
}

function checkCurrentSchema(schemaPath: string): Check {
  if (!existsSync(schemaPath)) return { status: "invalid", detail: "Prisma schema is missing" };
  const raw = readFileSync(schemaPath, "utf8");
  const model = raw.match(/model\s+Attachment\s*\{([\s\S]*?)\n\}/m)?.[1] ?? "";
  if (!model) return { status: "invalid", detail: "Attachment model is missing" };
  const implementationMarkers = [
    /enum\s+AttachmentStatus\s*\{/m,
    /\bstatus\s+AttachmentStatus\s+@default\(PENDING\)/m,
    /\bprotocolVersion\s+Int\s+@default\(1\)/m,
    /\bstagingName\s+String\?\s+@unique/m,
    /\bfinalizedAt\s+DateTime\?/m,
    /\bfailureCode\s+String\?/m,
    /\breconciliationClaimId\s+String\?/m,
    /\breconciliationLeaseExpiresAt\s+DateTime\?/m,
    /\bstoredName\s+String\s+@unique/m,
    /\buri\s+String\s+@unique/m,
  ];
  const missing = implementationMarkers.filter((pattern) => !pattern.test(raw));
  if (missing.length > 0) {
    return { status: "invalid", detail: "Attachment schema does not contain the reviewed OPS-007 protocol model" };
  }
  return { status: "pass", detail: "Attachment schema matches the reviewed staging/write-intent protocol model" };
}

function checkCandidateMigration(root: string, migrationPath: string): Check {
  if (!migrationPath) return { status: "missing", detail: "no candidate migration supplied" };
  const resolved = path.resolve(root, migrationPath);
  if (!existsSync(resolved)) return { status: "invalid", detail: "candidate migration path does not exist" };
  const raw = readFileSync(resolved, "utf8");
  const withoutComments = raw.replaceAll(/--[^\n]*/g, "");
  const forbidden = [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bUPDATE\b/i];
  if (forbidden.some((pattern) => pattern.test(withoutComments))) {
    return { status: "invalid", detail: "candidate migration must stay additive without DROP/DELETE/TRUNCATE/UPDATE" };
  }
  const required = [
    `CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED')`,
    `ADD COLUMN "status" "AttachmentStatus" NOT NULL DEFAULT 'READY'`,
    `ADD COLUMN "protocolVersion" INTEGER NOT NULL DEFAULT 0`,
    `ALTER COLUMN "status" SET DEFAULT 'PENDING'`,
    `ALTER COLUMN "protocolVersion" SET DEFAULT 1`,
    `CREATE UNIQUE INDEX "Attachment_storedName_key"`,
    `CREATE UNIQUE INDEX "Attachment_uri_key"`,
    `CREATE UNIQUE INDEX "Attachment_stagingName_key"`,
  ];
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "candidate migration is additive and applies legacy READY/protocolVersion=0 semantics without data UPDATE" }
    : { status: "invalid", detail: `candidate migration does not match the reviewed contract: ${missing[0]}` };
}

function checkFixture(fixturePath: string): Check {
  if (!existsSync(fixturePath)) return { status: "invalid", detail: "OPS-007 fixture is missing" };
  const issues = validateAttachmentCrashWindow(readFileSync(fixturePath, "utf8"));
  return issues.length === 0
    ? { status: "pass", detail: "checked-in report-only crash-window fixture is valid and hash-bound" }
    : { status: "invalid", detail: `OPS-007 fixture validation failed: ${issues[0]?.field}: ${issues[0]?.message}` };
}

function checkRuntime(root: string, runtimePath: string, now: Date, maxAgeHours: number): Check {
  if (!runtimePath) return { status: "missing", detail: "no isolated PostgreSQL/upload-directory runtime record supplied" };
  const resolved = path.resolve(root, runtimePath);
  if (!existsSync(resolved)) return { status: "invalid", detail: "runtime record path does not exist" };
  const issues = validateOps007RuntimeRecord(readFileSync(resolved, "utf8"), { root, now, maxAgeHours });
  return issues.length === 0
    ? { status: "pass", detail: "fresh isolated migration, kill-point, compensation, reconciliation, and O_NOFOLLOW evidence passed" }
    : { status: "invalid", detail: `runtime record failed validation: ${issues.join(", ")}` };
}

function readTaskPhase(taskPath: string): string | null {
  if (!existsSync(taskPath)) return null;
  return readFileSync(taskPath, "utf8").match(/^phase:\s+([^\s]+)\s*$/m)?.[1] ?? null;
}

function extractSection(raw: string, heading: string): string {
  const start = raw.indexOf(heading);
  if (start < 0) return "";
  const end = raw.indexOf("\n## ", start + heading.length);
  return raw.slice(start, end >= 0 ? end : undefined);
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

function readFixtureHash(fixturePath: string): string | null {
  return readJsonHash(fixturePath, "fixtureHash");
}

function readRuntimeHash(filePath: string): string | null {
  return readJsonHash(filePath, "recordHash");
}

function readJsonHash(filePath: string, field: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const body = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const hash = body[field];
    return typeof hash === "string" && /^sha256:[a-f0-9]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

function hashSourceBinding(sourceHashes: Record<string, string | null>): string {
  const canonical = Object.entries(sourceHashes)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value ?? "missing"}`)
    .join("\n");
  return textSha256(`${sourceContractId}\n${canonical}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = buildOps007AttachmentPreflight();
  console.log(JSON.stringify(result, null, 2));
  const strict = process.argv.includes("--require-protocol-ready");
  process.exitCode = ops007PreflightExitCode(result.status, strict);
}
