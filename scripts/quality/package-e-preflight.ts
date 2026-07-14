import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

const packageEBatches = [
  "Batch E1",
  "Batch E2",
  "Batch E3",
  "Batch E4",
] as const;

function main(): void {
  checkRequiredFiles();
  checkConfirmationPhrases();
  checkCompletionRecordState();
  checkRunbookBatchContracts();
  checkComposeConfig();
  checkComposeBoundaries();
  checkDockerfileBoundaries();
  checkNginxBoundaries();
  checkEnvExample();
  checkPackageScriptsBoundary();
  checkWebRuntimeOpsBoundary();

  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(`${mark} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`Package E preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("Package E preflight passed: local release artifacts are structurally ready; no production deploy, backup, restore, or migration was executed.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    ".env.example",
    "docker-compose.prod.yml",
    "infra/docker/web.Dockerfile",
    "infra/nginx/forge.areasong.top.conf.example",
    "docs/development/package-e-e1-release-record-draft.md",
    "docs/development/package-e-e2-restore-drill-record.md",
    "docs/development/package-e-e3-prod-local-release-record.md",
    "docs/development/package-e-e4-prod-local-rollback-record.md",
    "docs/development/production-release-runbook.md",
    "docs/development/release-record-template.md",
    "docs/deployment/backup-restore.md",
    "scripts/quality/attachment-reconciliation.ts",
    "scripts/quality/attachment-reconciliation-summary.ts",
    "scripts/quality/attachment-reconciliation-summary.selftest.ts",
    "scripts/quality/release-evidence-validate.ts",
    "scripts/quality/release-evidence-validate.selftest.ts",
    "scripts/ops/backup-restore-preview.ts",
    "scripts/quality/backup-restore-preview-validate.ts",
    "scripts/quality/backup-restore-preview.selftest.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required release files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkConfirmationPhrases(): void {
  const packets = read("docs/development/high-risk-confirmation-packets.md");
  const requiredPhrases = [
    "确认执行 Package E：生产部署、备份与恢复",
    "确认执行 Package E Batch E1：生产配置与发布工件预检",
    "确认执行 Package E Batch E2：发布前备份与恢复演练",
    "确认执行 Package E Batch E3：生产发布与 migration deploy",
    "确认执行 Package E Batch E4：回滚演练与 Package E 收口",
  ];
  const missing = requiredPhrases.filter((phrase) => !packets.includes(phrase));
  checks.push({
    name: "explicit Package E confirmation phrases",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "main Package E and E1-E4 confirmation phrases are documented" : `missing ${missing.join(", ")}`,
  });
}

function checkCompletionRecordState(): void {
  const record = read("docs/development/docs-100-completion-record.md");
  const packageLine = findLine(record, "| Package E |");
  const packageCells = packageLine ? parseMarkdownCells(packageLine) : [];
  const packageStatus = packageCells[1] ?? "";
  const packageEvidence = packageCells[2] ?? "";
  const batchStates = getPackageEBatchStates(record);
  const allBatchesDone = packageEBatches.every((batch) => {
    const batchKey = batch.replace("Batch ", "").toLowerCase() as keyof ReturnType<typeof getPackageEBatchStates>;
    return batchStates[batchKey];
  });
  const packageDoneWithEvidence = packageStatus.includes("DONE / 已完成") &&
    [
      "验证",
      "烟测",
      "文档同步",
      "残余风险",
      "发布",
      "备份",
      "恢复",
      "回滚",
      "release:evidence:validate",
      "report_only",
      "migration deploy 执行载体",
      "镜像 digest",
      "Nginx",
    ].every((term) => packageEvidence.includes(term));
  const incompleteBatches = packageEBatches.flatMap((batch) => {
    const line = findLine(record, `| ${batch}：`);
    if (!line) return [`${batch}=missing`];
    const cells = parseMarkdownCells(line);
    const status = cells[1] ?? "";
    const confirmation = cells[2] ?? "";
    const batchKey = batch.replace("Batch ", "").toLowerCase() as keyof ReturnType<typeof getPackageEBatchStates>;
    if (batchStates[batchKey]) return [];
    return status.includes("NOT_READY / 未完成") && confirmation.includes("待用户明确确认") ? [] : [`${batch}=${status || "missing status"}`];
  });
  const ok = allBatchesDone
    ? packageDoneWithEvidence
    : packageStatus.includes("NOT_READY / 未完成") && incompleteBatches.length === 0;

  checks.push({
    name: "Package E completion ledger locked",
    ok,
    detail: ok
      ? allBatchesDone
        ? "Package E may be marked DONE only after E1-E4 release/backup/restore/rollback evidence exists"
        : "Package E remains NOT_READY until all E1-E4 evidence exists; confirmed batches may unlock only their narrow release step"
      : `Package E status=${packageStatus || "missing"}; packageEvidence=${packageEvidence ? "present" : "missing"}; batches ${incompleteBatches.join(", ") || "ok"}`,
  });
}

function checkRunbookBatchContracts(): void {
  const runbook = read("docs/development/production-release-runbook.md");
  const backupRestore = read("docs/deployment/backup-restore.md");
  const reconciliationHeader = "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action";
  const requiredTerms = [
    "Batch E1-E4 交付物",
    "Batch E1 生产配置与发布工件预检",
    "Batch E2 发布前备份与恢复演练",
    "Batch E3 生产发布与 migration deploy",
    "Batch E4 回滚演练与 Package E 收口",
    "report_only",
    "受控 release 工作目录",
    "一次性 migration 镜像或 job",
    "envBackupSha256",
    "composeConfigBackupPath",
    "nginxConfigBackupPath",
    "migrationRunner",
    "rollbackPlan",
    "rollbackDrillResult",
    "databaseRestoreRequired",
    "uploadsRestoreRequired",
    "不通过网页按钮触发部署、migration、备份或恢复",
    "中止条件",
    "pnpm release:evidence:validate",
    "docs/development/release-record-template.md",
    "scripts/quality/attachment-reconciliation.ts",
    "scripts/quality/attachment-reconciliation-summary.ts",
    "attachment-reconciliation.csv",
    "attachment-reconciliation-summary.json",
    "attachmentReconciliationCsvSha256",
    "attachmentReconciliationSummaryHash",
    "fileOnlyCount",
    "unsafeEntryCount",
  ];
  const missing = [
    ...requiredTerms.filter((term) => !runbook.includes(term)),
    ...[reconciliationHeader].filter((term) => !`${runbook}\n${backupRestore}`.includes(term)),
  ];
  checks.push({
    name: "Package E batch runbook contracts",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "runbook documents E1-E4 deliverables, read-only reconciliation, migration runner choices, and no-web-ops boundary"
      : `missing ${missing.join(", ")}`,
  });
}

function checkComposeConfig(): void {
  const result = spawnSync("docker", ["compose", "--env-file", ".env.example", "-f", "docker-compose.prod.yml", "config"], {
    cwd: root,
    encoding: "utf8",
  });
  checks.push({
    name: "compose config with example env",
    ok: result.status === 0,
    detail: result.status === 0
      ? "docker compose config passes with .env.example placeholders"
      : compactOutput(result.stderr || result.stdout || "docker compose config failed"),
  });
}

function checkComposeBoundaries(): void {
  const compose = read("docker-compose.prod.yml");
  const forbiddenTerms = ["docker.sock", "privileged: true", "network_mode: host"];
  const missingTerms = [
    "127.0.0.1:${WEB_PORT:-3000}:3000",
    "areaforge-postgres-data:/var/lib/postgresql/data",
    "areaforge-uploads:/app/uploads",
    "${AREAFORGE_OPS_STATE_HOST_DIR:-/opt/areaforge/ops-state}:/app/ops-state",
    "condition: service_healthy",
    "UPLOAD_DIR: /app/uploads",
    "AREAFORGE_OPS_STATE_DIR: ${AREAFORGE_OPS_STATE_DIR:-/app/ops-state}",
  ].filter((term) => !compose.includes(term));
  const forbiddenMatches = forbiddenTerms.filter((term) => compose.includes(term));
  const postgresPublicPort = /^\s*-\s*["']?\d+:\s*5432\b/m.test(compose);

  checks.push({
    name: "compose production boundaries",
    ok: missingTerms.length === 0 && forbiddenMatches.length === 0 && !postgresPublicPort,
    detail: missingTerms.length === 0 && forbiddenMatches.length === 0 && !postgresPublicPort
      ? "web binds localhost, postgres is private, uploads use a private volume, and no privileged host access is declared"
      : `missing ${missingTerms.join(", ") || "none"}; forbidden ${forbiddenMatches.join(", ") || "none"}; postgresPublicPort=${postgresPublicPort}`,
  });
}

function checkDockerfileBoundaries(): void {
  const dockerfile = read("infra/docker/web.Dockerfile");
  const requiredTerms = [
    "FROM node:24-alpine AS runner",
    "USER nextjs",
    "COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./",
    "RUN mkdir -p /app/uploads",
    "CMD [\"node\", \"apps/web/server.js\"]",
  ];
  const forbiddenTerms = ["db:migrate:deploy", "prisma migrate deploy", "prisma/migrations", "AUTH_SESSION_SECRET"];
  const missingTerms = requiredTerms.filter((term) => !dockerfile.includes(term));
  const forbiddenMatches = forbiddenTerms.filter((term) => dockerfile.includes(term));
  checks.push({
    name: "web image release boundary",
    ok: missingTerms.length === 0 && forbiddenMatches.length === 0,
    detail: missingTerms.length === 0 && forbiddenMatches.length === 0
      ? "runtime image runs Next standalone as non-root and does not pretend to be a migration runner"
      : `missing ${missingTerms.join(", ") || "none"}; forbidden ${forbiddenMatches.join(", ") || "none"}`,
  });
}

function checkNginxBoundaries(): void {
  const nginx = read("infra/nginx/forge.areasong.top.conf.example");
  const requiredTerms = [
    "proxy_pass http://127.0.0.1:3000",
    "client_max_body_size 25m",
    "X-Content-Type-Options",
    "Strict-Transport-Security",
  ];
  const forbiddenTerms = ["/app/uploads", "alias /", "root /app", "autoindex on"];
  const missingTerms = requiredTerms.filter((term) => !nginx.includes(term));
  const forbiddenMatches = forbiddenTerms.filter((term) => nginx.includes(term));
  checks.push({
    name: "nginx private upload boundary",
    ok: missingTerms.length === 0 && forbiddenMatches.length === 0,
    detail: missingTerms.length === 0 && forbiddenMatches.length === 0
      ? "nginx proxies to local web service and does not statically expose upload storage"
      : `missing ${missingTerms.join(", ") || "none"}; forbidden ${forbiddenMatches.join(", ") || "none"}`,
  });
}

function checkEnvExample(): void {
  const env = read(".env.example");
  const requiredKeys = [
    "APP_URL=",
    "AUTH_SESSION_SECRET=",
    "POSTGRES_PASSWORD=",
    "AREAFORGE_IMAGE=",
    "AI_ENABLED=false",
    "AI_LOG_PROMPTS=false",
    "AI_ALLOW_SENSITIVE_CONTEXT=false",
    "UPLOAD_DIR=/app/uploads",
    "BACKUP_DIR=/backups",
    "BACKUP_RETENTION_DAYS=14",
  ];
  const missingKeys = requiredKeys.filter((term) => !env.includes(term));
  checks.push({
    name: "example release env",
    ok: missingKeys.length === 0,
    detail: missingKeys.length === 0
      ? "example env documents production release, upload, AI fallback, and backup knobs"
      : `missing ${missingKeys.join(", ")}`,
  });
}

function checkPackageScriptsBoundary(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const scripts = Object.entries(packageJson.scripts ?? {});
  const forbiddenPatterns = [
    { label: "prod deploy script", pattern: /\b(prod|production)[\w:-]*(deploy|release)\b/i },
    { label: "backup script", pattern: /\b(pg_dump|backup|dump)\b/i },
    { label: "restore script", pattern: /\b(pg_restore|restore)\b/i },
    { label: "compose up script", pattern: /\bdocker\s+compose\b.*\bup\b/i },
    { label: "compose down script", pattern: /\bdocker\s+compose\b.*\bdown\b/i },
    { label: "server command script", pattern: /\b(ssh|rsync|scp)\b/i },
  ];
  const allowedReadOnlyOpsRecordScripts = new Set([
    "restore:drill:validate",
    "restore:drill:selftest",
    "ops:backup-restore:preview",
    "ops:backup-restore:preview:validate",
    "ops:backup-restore:preview:selftest",
  ]);
  const matches = scripts.flatMap(([name, command]) => {
    if (allowedReadOnlyOpsRecordScripts.has(name) && command.includes("scripts/quality/restore-drill-validate")) {
      return [];
    }
    if (name === "ops:backup-restore:preview" && command === "tsx scripts/ops/backup-restore-preview.ts") {
      return [];
    }
    if (name === "ops:backup-restore:preview:validate" && command === "tsx scripts/quality/backup-restore-preview-validate.ts") {
      return [];
    }
    if (name === "ops:backup-restore:preview:selftest" && command === "tsx scripts/quality/backup-restore-preview.selftest.ts") {
      return [];
    }
    return forbiddenPatterns
      .filter((item) => item.pattern.test(`${name} ${command}`))
      .map((item) => `${name}:${item.label}`);
  });
  const migrateDeploy = packageJson.scripts?.["db:migrate:deploy"] ?? "";
  const releaseEvidenceValidate = packageJson.scripts?.["release:evidence:validate"] ?? "";
  const releaseEvidenceSelftest = packageJson.scripts?.["release:evidence:selftest"] ?? "";
  const reconciliationScript = packageJson.scripts?.["attachment:reconciliation"] ?? "";
  const reconciliationSummaryScript = packageJson.scripts?.["attachment:reconciliation:summary"] ?? "";
  const reconciliationSummarySelftest = packageJson.scripts?.["attachment:reconciliation:summary:selftest"] ?? "";
  const runbook = read("docs/development/production-release-runbook.md");
  const migrateDeployDocumented = migrateDeploy.includes("prisma migrate deploy") &&
    runbook.includes("生产 migration") &&
    runbook.includes("Package E") &&
    runbook.includes("受控 release 工作目录");
  const releaseEvidenceValidatorDocumented = releaseEvidenceValidate.includes("scripts/quality/release-evidence-validate.ts") &&
    releaseEvidenceSelftest.includes("scripts/quality/release-evidence-validate.selftest.ts") &&
    reconciliationScript === "tsx scripts/quality/attachment-reconciliation.ts" &&
    reconciliationSummaryScript === "tsx scripts/quality/attachment-reconciliation-summary.ts" &&
    reconciliationSummarySelftest === "tsx scripts/quality/attachment-reconciliation-summary.selftest.ts" &&
    runbook.includes("pnpm release:evidence:validate") &&
    runbook.includes("只读取发布记录");

  checks.push({
    name: "package scripts ops boundary",
    ok: matches.length === 0 && migrateDeployDocumented && releaseEvidenceValidatorDocumented,
    detail: matches.length === 0 && migrateDeployDocumented && releaseEvidenceValidatorDocumented
      ? "package scripts do not expose deploy/backup/restore/compose ops; db:migrate:deploy remains documented behind Package E confirmation; release evidence validation is read-only"
      : `forbidden scripts ${matches.join(", ") || "none"}; migrateDeployDocumented=${migrateDeployDocumented}; releaseEvidenceValidatorDocumented=${releaseEvidenceValidatorDocumented}`,
  });
}

function checkWebRuntimeOpsBoundary(): void {
  const files = [
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/lib"),
    ...listFiles("apps/web/components"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));
  const forbiddenPatterns = [
    { label: "child_process", pattern: /\bchild_process\b/ },
    { label: "execSync", pattern: /\bexecSync\b/ },
    { label: "spawnSync", pattern: /\bspawnSync\b/ },
    { label: "docker compose", pattern: /\bdocker\s+compose\b/ },
    { label: "pg_dump", pattern: /\bpg_dump\b/ },
    { label: "pg_restore", pattern: /\bpg_restore\b/ },
    { label: "prisma migrate deploy", pattern: /\bprisma\s+migrate\s+deploy\b/ },
    { label: "db:migrate:deploy", pattern: /\bdb:migrate:deploy\b/ },
  ];
  const matches = files.flatMap((file) => {
    const content = read(file);
    return forbiddenPatterns
      .filter((item) => item.pattern.test(content))
      .map((item) => `${file}:${item.label}`);
  });

  checks.push({
    name: "web runtime ops boundary",
    ok: matches.length === 0,
    detail: matches.length === 0
      ? "web runtime contains no deploy, backup, restore, or migration command execution surface"
      : `found forbidden ops surface: ${matches.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function findLine(content: string, prefix: string): string | undefined {
  return content.split(/\r?\n/).find((line) => line.startsWith(prefix));
}

function parseMarkdownCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function resolve(file: string): string {
  return path.join(root, file);
}

function compactOutput(output: string): string {
  return output.trim().replace(/\s+/g, " ").slice(0, 500);
}

function listFiles(dir: string): string[] {
  const absolute = resolve(dir);
  if (!existsSync(absolute)) return [];

  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(child);
    if (entry.isFile()) return [child];
    return [];
  });
}

function getPackageEBatchStates(record: string): { e1: boolean; e2: boolean; e3: boolean; e4: boolean } {
  return {
    e1: isPackageEBatchDone(record, "E1"),
    e2: isPackageEBatchDone(record, "E2"),
    e3: isPackageEBatchDone(record, "E3"),
    e4: isPackageEBatchDone(record, "E4"),
  };
}

function isPackageEBatchDone(record: string, batch: "E1" | "E2" | "E3" | "E4"): boolean {
  const line = findLine(record, `| Batch ${batch}：`) ?? "";
  if (!line.includes("DONE / 已完成")) return false;
  const cells = parseMarkdownCells(line);
  const confirmation = cells[2] ?? "";
  const validation = cells[3] ?? "";
  const smoke = cells[4] ?? "";
  const docsSync = cells[5] ?? "";
  const residualRisk = cells[6] ?? "";
  return confirmation.includes("用户已明确确认") &&
    validation.includes("pnpm") &&
    /(烟测|smoke|演练|发布|备份|恢复|回滚)/i.test(smoke) &&
    docsSync.includes("已同步") &&
    residualRisk.length >= 20 &&
    !["待同步", "未运行", "缺"].some((token) => residualRisk.includes(token)) &&
    missingPackageEBatchEvidenceDetails(batch, line).length === 0;
}

function missingPackageEBatchEvidenceDetails(batch: "E1" | "E2" | "E3" | "E4", line: string): string[] {
  const checks: Record<"E1" | "E2" | "E3" | "E4", Array<string | string[]>> = {
    E1: [
      "pnpm check",
      "pnpm package-e:preflight",
      "compose config",
      ["生产 env 清单", "生产 `.env`", "production env"],
      "AREAFORGE_IMAGE",
      "镜像 digest",
      "Nginx",
      "migration deploy 执行载体",
      "发布记录草案",
      "中止条件",
    ],
    E2: [
      "PostgreSQL dump",
      "上传目录归档",
      ["生产 `.env`", "envBackupSha256", "生产 env"],
      "compose/Nginx 副本",
      "临时库导入",
      "临时上传目录恢复",
      "metadata/hash",
      "report_only",
    ],
    E3: [
      "备份点",
      "migration deploy",
      ["受控 release 工作目录", "一次性 migration job", "migrationRunner"],
      "compose/Nginx",
      "GET /api/health",
      "登录",
      "首页",
      "任务",
      "计时",
      "复盘",
      "日志脱敏",
    ],
    E4: [
      "上一镜像",
      "回滚步骤",
      "数据库/上传目录",
      "失败原因",
      "恢复耗时",
      "release:evidence:validate",
      "docs:completion",
      "残余风险",
    ],
  };

  return checks[batch]
    .filter((term) => Array.isArray(term)
      ? !term.some((item) => line.includes(item))
      : !line.includes(term))
    .map((term) => Array.isArray(term) ? term.join(" or ") : term);
}

main();
