import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAttachmentCrashWindow } from "./attachment-crash-window-validate";

export type Ops007PreflightStatus = "awaiting_high_risk_confirmation" | "invalid";

export function ops007PreflightExitCode(status: Ops007PreflightStatus, strict: boolean): 0 | 1 {
  return status === "invalid" || strict ? 1 : 0;
}

type PreflightOptions = {
  root?: string;
  taskPath?: string;
  designPath?: string;
  confirmationPacketPath?: string;
  schemaPath?: string;
  fixturePath?: string;
};

type Check = {
  status: "pass" | "invalid";
  detail: string;
};

const evidenceClass = "protocol_preimage_candidate";
const sourceContractId = "OPS-007-PREFLIGHT-CONTRACT-V1";
const implementationConfirmationPhrase =
  "确认执行 OPS-007 附件 staging/write-intent 本地实施";

export function buildOps007AttachmentPreflight(options: PreflightOptions = {}) {
  const root = options.root ?? process.cwd();
  const taskPath = options.taskPath ?? path.join(root, "tasks/backlog/0021-attachment-staging-intent.md");
  const designPath =
    options.designPath ?? path.join(root, "docs/development/ops-007-attachment-crash-window-design.md");
  const confirmationPacketPath =
    options.confirmationPacketPath ?? path.join(root, "docs/development/high-risk-confirmation-packets.md");
  const schemaPath = options.schemaPath ?? path.join(root, "prisma/schema.prisma");
  const fixturePath =
    options.fixturePath ??
    path.join(root, "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json");

  const checks = {
    task: checkTask(taskPath),
    designContract: checkDesignContract(designPath),
    confirmationPacket: checkConfirmationPacket(confirmationPacketPath),
    currentSchema: checkCurrentSchema(schemaPath),
    fixture: checkFixture(fixturePath),
  };
  const status: Ops007PreflightStatus = Object.values(checks).some((check) => check.status === "invalid")
    ? "invalid"
    : "awaiting_high_risk_confirmation";
  const sourceHashes = {
    taskSha256: fileSha256(taskPath),
    designSha256: fileSha256(designPath),
    confirmationPacketSha256: fileSha256(confirmationPacketPath),
    schemaSha256: fileSha256(schemaPath),
    fixtureFileSha256: fileSha256(fixturePath),
    fixtureHash: readFixtureHash(fixturePath),
  };

  return {
    schemaVersion: 1,
    mode: "read_only_ops007_attachment_preflight",
    evidenceClass,
    status,
    strictGate: {
      status: "blocked",
      reason: "awaiting explicit OPS-007 high-risk implementation confirmation",
    },
    checks,
    expectedContract: {
      sourceContractId,
      protocol:
        "bounded streaming before explicit PENDING intent; exclusive staging write/fsync; atomic rename/fsync; hash verification; READY CAS",
      legacyPolicy: "legacy rows are READY/protocolVersion=0 compatibility only; new schema default and explicit intent are PENDING/protocolVersion=1",
      downloadPolicy: "READY plus same-handle O_NOFOLLOW + fstat + hash/size verification; browser DTO omits raw hash and internal storage fields",
      reconciliationPolicy: "bounded claim/lease reconciliation with DB/staging/final decision table; historical orphan remains report-only",
      evidencePolicy:
        "protocol preimage candidate only; never migration, runtime, filesystem, backup/restore, production, or confirmation evidence",
    },
    evidence: {
      task: relativePath(root, taskPath),
      design: relativePath(root, designPath),
      confirmationPacket: relativePath(root, confirmationPacketPath),
      schema: relativePath(root, schemaPath),
      fixture: relativePath(root, fixturePath),
      sourceContractId,
      implementationConfirmationPhraseSha256: textSha256(implementationConfirmationPhrase),
      ...sourceHashes,
      sourceBindingHash: hashSourceBinding(sourceHashes),
    },
    requiredNextSteps: [
      "obtain explicit OPS-007 high-risk implementation confirmation",
      "implement and review the additive migration without historical repair",
      "run isolated PostgreSQL and temporary upload-directory crash-window tests",
      "validate runtime O_NOFOLLOW, fsync, READY CAS, and bounded reconciliation behavior",
      "run pnpm db:validate, pnpm check, risk gates, and release-bound validation",
    ],
    doesNotProve: [
      "OPS-007 high-risk implementation confirmation",
      "candidate or applied database migration",
      "attachment runtime protocol implementation",
      "filesystem durability, atomic rename, fsync, or O_NOFOLLOW behavior",
      "runtime compensation or reconciliation execution",
      "backup or restore success",
      "production attachment safety or production state",
      "historical orphan cleanup or residual ledger closure",
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

function checkTask(taskPath: string): Check {
  if (!existsSync(taskPath)) return { status: "invalid", detail: "OPS-007 task file is missing" };
  const raw = readFileSync(taskPath, "utf8");
  if (!/^status:\s+blocked\s*$/m.test(raw) || !/^phase:\s+awaiting-high-risk-confirmation\s*$/m.test(raw)) {
    return { status: "invalid", detail: "OPS-007 task must remain blocked while awaiting high-risk confirmation" };
  }
  const required = [
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "task remains blocked and declares the OPS-007 preflight source contract" }
    : { status: "invalid", detail: `OPS-007 task source contract is incomplete: ${missing.join(", ")}` };
}

function checkDesignContract(designPath: string): Check {
  if (!existsSync(designPath)) return { status: "invalid", detail: "OPS-007 design file is missing" };
  const raw = readFileSync(designPath, "utf8");
  const required = [
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    "sourceBindingHash",
    "strict 必须非零退出",
    "不证明 migration、runtime、filesystem、backup/restore 或 production",
    "Attachment.status AttachmentStatus @default(PENDING)",
    "有界上传读取",
    "reconciliationLeaseExpiresAt",
    "浏览器 DTO",
    "production_confirmation_required",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !raw.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "design declares source-hash-bound protocol preimage semantics" }
    : { status: "invalid", detail: `OPS-007 design source contract is incomplete: ${missing.join(", ")}` };
}

function checkConfirmationPacket(packetPath: string): Check {
  if (!existsSync(packetPath)) {
    return { status: "invalid", detail: "high-risk confirmation packet file is missing" };
  }
  const raw = readFileSync(packetPath, "utf8");
  const section = extractSection(raw, "## OPS-007 附件 Staging/Write-Intent 本地实施确认包");
  const required = [
    "状态：等待确认",
    sourceContractId,
    `evidenceClass: ${evidenceClass}`,
    "strict 必须非零退出",
    "不执行生产 migration deploy",
    "不读取、打印、复制或提交 secrets",
    "有界流式读取",
    "reconciliation lease",
    implementationConfirmationPhrase,
  ];
  const missing = required.filter((value) => !section.includes(value));
  return missing.length === 0
    ? { status: "pass", detail: "confirmation packet remains awaiting confirmation with production and secret boundaries" }
    : { status: "invalid", detail: `OPS-007 confirmation packet is incomplete: ${missing.join(", ")}` };
}

function checkCurrentSchema(schemaPath: string): Check {
  if (!existsSync(schemaPath)) return { status: "invalid", detail: "Prisma schema is missing" };
  const raw = readFileSync(schemaPath, "utf8");
  const model = raw.match(/model\s+Attachment\s*\{([\s\S]*?)\n\}/m)?.[1] ?? "";
  if (!model) return { status: "invalid", detail: "Attachment model is missing" };
  const requiredCurrentFields = ["storedName   String", "uri          String", "createdAt    DateTime"];
  if (requiredCurrentFields.some((value) => !model.includes(value))) {
    return { status: "invalid", detail: "Attachment schema preimage no longer matches the reviewed current model" };
  }
  const implementationMarkers = [
    /enum\s+AttachmentStatus\s*\{/m,
    /\bstatus\s+AttachmentStatus\b/m,
    /\bstagingName\s+String\?/m,
    /\bprotocolVersion\s+Int\b/m,
    /\bfinalizedAt\s+DateTime\?/m,
    /\bfailureCode\s+String\?/m,
    /\breconciliationClaimId\s+String\?/m,
    /\breconciliationLeaseExpiresAt\s+DateTime\?/m,
    /\bstoredName\s+String\s+@unique/m,
    /\buri\s+String\s+@unique/m,
  ];
  if (implementationMarkers.some((pattern) => pattern.test(raw))) {
    return { status: "invalid", detail: "current schema already contains an unreviewed OPS-007 implementation marker" };
  }
  return { status: "pass", detail: "current Attachment schema remains the pre-OPS-007 preimage" };
}

function checkFixture(fixturePath: string): Check {
  if (!existsSync(fixturePath)) return { status: "invalid", detail: "OPS-007 fixture is missing" };
  const issues = validateAttachmentCrashWindow(readFileSync(fixturePath, "utf8"));
  return issues.length === 0
    ? { status: "pass", detail: "checked-in report-only crash-window fixture is valid and hash-bound" }
    : { status: "invalid", detail: `OPS-007 fixture validation failed: ${issues[0]?.field}: ${issues[0]?.message}` };
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
  if (!existsSync(fixturePath)) return null;
  try {
    const body = JSON.parse(readFileSync(fixturePath, "utf8")) as { fixtureHash?: unknown };
    return typeof body.fixtureHash === "string" && /^sha256:[a-f0-9]{64}$/.test(body.fixtureHash)
      ? body.fixtureHash
      : null;
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
