import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateAttachmentCrashWindow } from "./attachment-crash-window-validate";
import { readResidualLedgerV2 } from "./residual-ledger-common";
import { validateUpdaterMaintenanceControl } from "./updater-maintenance-control-validate";
import { validateUpdaterPhaseJournal } from "./updater-phase-journal-validate";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkOperationalReadinessDoc();
  checkProductionSmokeAlertingStrategy();
  checkResidualLedger();
  checkOperatingLoopSkill();
  checkReleaseWorkflowHardGates();
  checkPackageScripts();
  checkConfirmationBeforeContracts();
  checkOperationsLifecycle();
  checkSummaryScript();
  checkForbiddenLegacyEvidenceNames();
  checkLocalUxSmokeScript();
  checkBuildNetworkDependencyBoundary();
  checkDocsIndex();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`ops readiness preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("ops readiness preflight passed: long-term operations evidence entrypoints are present and read-only.");
}

function checkConfirmationBeforeContracts(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const requiredScripts: Record<string, string> = {
    "ops:ops-006:preflight": "tsx scripts/quality/ops006-concurrency-preflight.ts",
    "ops:ops-006:preflight:strict": "tsx scripts/quality/ops006-concurrency-preflight.ts --require-candidate-ready",
    "ops:ops-006:preflight:selftest": "tsx scripts/quality/ops006-concurrency-preflight.selftest.ts",
    "ops:ops-007:preflight": "tsx scripts/quality/ops007-attachment-preflight.ts",
    "ops:ops-007:preflight:strict": "tsx scripts/quality/ops007-attachment-preflight.ts --require-protocol-ready",
    "ops:ops-007:preflight:selftest": "tsx scripts/quality/ops007-attachment-preflight.selftest.ts",
    "attachment:crash-window:selftest": "tsx scripts/quality/attachment-crash-window-validate.selftest.ts",
    "attachment:crash-window:validate": "tsx scripts/quality/attachment-crash-window-validate.ts",
    "updater:phase-journal:selftest": "tsx scripts/quality/updater-phase-journal-validate.selftest.ts",
    "updater:phase-journal:validate": "tsx scripts/quality/updater-phase-journal-validate.ts",
    "updater:maintenance-control:selftest": "tsx scripts/quality/updater-maintenance-control-validate.selftest.ts",
    "updater:maintenance-control:validate": "tsx scripts/quality/updater-maintenance-control-validate.ts",
    "ops:ops-008:preflight": "tsx scripts/quality/ops008-updater-preflight.ts",
    "ops:ops-008:preflight:strict": "tsx scripts/quality/ops008-updater-preflight.ts --strict",
    "ops:ops-008:preflight:selftest": "tsx scripts/quality/ops008-updater-preflight.selftest.ts",
  };
  const missingScripts = Object.entries(requiredScripts)
    .filter(([key, value]) => packageJson.scripts?.[key] !== value)
    .map(([key]) => key);
  const files = [
    "tasks/active/0020-business-state-concurrency.md",
    "docs/development/ops-006-business-state-concurrency-design.md",
    "docs/development/high-risk-confirmation-packets.md",
    "tasks/backlog/0021-attachment-staging-intent.md",
    "docs/development/ops-007-attachment-crash-window-design.md",
    "tasks/backlog/0022-updater-phase-journal-hold.md",
    "docs/development/ops-008-updater-phase-journal-design.md",
    "scripts/quality/ops006-concurrency-preflight.ts",
    "scripts/quality/ops006-concurrency-preflight.selftest.ts",
    "scripts/quality/ops007-attachment-preflight.ts",
    "scripts/quality/ops007-attachment-preflight.selftest.ts",
    "scripts/quality/attachment-crash-window-validate.ts",
    "scripts/quality/attachment-crash-window-validate.selftest.ts",
    "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json",
    "scripts/quality/updater-phase-journal-validate.ts",
    "scripts/quality/updater-phase-journal-validate.selftest.ts",
    "scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json",
    "scripts/quality/updater-maintenance-control-validate.ts",
    "scripts/quality/updater-maintenance-control-validate.selftest.ts",
    "scripts/quality/ops008-updater-preflight.ts",
    "scripts/quality/ops008-updater-preflight.selftest.ts",
    "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-drain-preconfirmation.json",
    "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-waiting-preconfirmation.json",
    "scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-lock-waiting-preconfirmation.json",
  ];
  const missingFiles = files.filter((file) => !existsSync(resolve(file)));
  const combined = files.filter((file) => existsSync(resolve(file))).map((file) => read(file)).join("\n");
  const requiredTerms = [
    "execute_server_command",
    "run_migration",
    "productionWriteAttempted: false",
    "OPS-007 附件 Staging/Write-Intent 本地实施确认包",
    "确认执行 OPS-007 附件 staging/write-intent 本地实施",
    "OPS-008 Updater Phase Journal 与 Maintenance Hold/Drain 本地实施确认包",
    "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
  ];
  const forbidden = requiredTerms
    .filter((term) => !combined.includes(term));
  const confirmationMismatches = [
    {
      prefix: "确认执行 OPS-006 业务状态并发一致性本地实施",
      expected: "确认执行 OPS-006 业务状态并发一致性本地实施：范围仅限新增“最多一个活跃 StudySession”的 additive migration、task/session expected-status CAS、结束计时事务内单次副作用、同日 CheckIn 事务锁、409 冲突映射、只读 data-integrity doctor 联动和本地 PostgreSQL 并发 selftest；不执行生产 migration deploy、历史数据修复/删除/合并、批量任务修改、多用户迁移、附件改造、updater 改造、Release/tag、服务器命令、secrets 操作或 residual 台账关闭。",
      files: ["docs/development/high-risk-confirmation-packets.md", "docs/development/ops-006-business-state-concurrency-design.md", "tasks/active/0020-business-state-concurrency.md"],
    },
    {
      prefix: "确认执行 OPS-007 附件 staging/write-intent 本地实施",
      expected: "确认执行 OPS-007 附件 staging/write-intent 本地实施：范围仅限新增 AttachmentStatus PENDING/READY/FAILED、protocolVersion、staging/finalized/failure、reconciliation lease 字段和 stagingName/storedName/uri 唯一约束的 additive migration，note 附件上传改为有界流式读取、显式 PENDING intent、exclusive staging write/fsync、atomic rename/fsync、READY CAS，下载仅允许 READY 并使用 O_NOFOLLOW 同句柄校验，补偿失败保留可审计状态，新协议记录的有界 claim/lease reconciliation，以及本地临时 PostgreSQL/上传目录 crash fixture；不删除或自动修复历史 orphan，不删除 READY 附件，不执行生产 migration/deploy、backup/restore、上传目录迁移、服务器命令、secrets 操作、多用户迁移、Release/tag 或 residual 台账关闭。",
      files: ["docs/development/high-risk-confirmation-packets.md", "docs/development/ops-007-attachment-crash-window-design.md", "tasks/backlog/0021-attachment-staging-intent.md"],
    },
    {
      prefix: "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施",
      expected: "确认执行 OPS-008 updater phase journal 与 maintenance hold/drain 本地实施：范围仅限 root-only no-clobber/逐级 fsync immutable hash-chained phase events、精确 backup inventory 持久化屏障、admission/identity-bound/backup/prepare/migration-or-skipped/switch/health/smoke/rollback/terminal/reconciliation 状态机、崩溃后 fail-closed hold、固定 queue-control -> production-state -> agent-local 锁顺序、hold generation/clear CAS、旧 generation 请求隔离、record/journal 失败的 reconciliation exit mapping、redacted status、扩展 sourceSetHash 和本地临时目录 kill-point/锁竞争 selftest；不执行生产 updater apply、Web apply/rollback 请求、systemd timer 启停、生产 hold/clear/drain、backup/restore、migration、Docker/Nginx/compose 切换、自动应用策略变化、服务器命令、secrets 操作、Release/tag 或 residual 台账关闭。",
      files: ["docs/development/high-risk-confirmation-packets.md", "docs/development/ops-008-updater-phase-journal-design.md", "tasks/backlog/0022-updater-phase-journal-hold.md"],
    },
  ].flatMap((contract) => contract.files
    .filter((file) => confirmationLine(read(file), contract.prefix) !== contract.expected)
    .map((file) => `${contract.prefix}@${file}`));
  const fixtureIssues = [
    ...validateAttachmentCrashWindow(read("scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json")),
    ...validateUpdaterPhaseJournal(read("scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json")),
    ...["ops008-hold-drain-preconfirmation.json", "ops008-hold-waiting-preconfirmation.json", "ops008-hold-lock-waiting-preconfirmation.json"]
      .flatMap((file) => validateUpdaterMaintenanceControl(read(`scripts/quality/fixtures/update-agent/maintenance-control/${file}`))),
  ];
  const workflowTerms = [
    "pnpm ops:ops-006:preflight:selftest",
    "pnpm ops:ops-007:preflight:selftest",
    "pnpm ops:ops-008:preflight:selftest",
    "pnpm ops:ops-006:preflight",
    "pnpm ops:ops-007:preflight",
    "pnpm ops:ops-008:preflight",
    "pnpm attachment:crash-window:selftest",
    "pnpm attachment:crash-window:validate scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json",
    "pnpm updater:phase-journal:selftest",
    "pnpm updater:phase-journal:validate scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json",
    "pnpm updater:maintenance-control:selftest",
    "pnpm updater:maintenance-control:validate scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-drain-preconfirmation.json",
    "pnpm updater:maintenance-control:validate scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-waiting-preconfirmation.json",
    "pnpm updater:maintenance-control:validate scripts/quality/fixtures/update-agent/maintenance-control/ops008-hold-lock-waiting-preconfirmation.json",
  ];
  const workflowMismatches = [".github/workflows/ci.yml", ".github/workflows/release.yml"]
    .flatMap((file) => workflowTerms.filter((term) => !read(file).includes(term)).map((term) => `${file}:${term}`));
  checks.push({
    name: "confirmation-scoped operational contracts",
    ok: missingScripts.length === 0 && missingFiles.length === 0 && forbidden.length === 0 && confirmationMismatches.length === 0 && fixtureIssues.length === 0 && workflowMismatches.length === 0,
    detail: missingScripts.length === 0 && missingFiles.length === 0 && forbidden.length === 0 && confirmationMismatches.length === 0 && fixtureIssues.length === 0 && workflowMismatches.length === 0
      ? "OPS-006 local-verified and OPS-007/008 preconfirmation validators, task bindings, and no-production boundaries are present"
      : `missing scripts ${missingScripts.join(", ") || "none"}; missing files ${missingFiles.join(", ") || "none"}; missing boundary terms ${forbidden.join(", ") || "none"}; confirmation mismatches ${confirmationMismatches.join(", ") || "none"}; fixture issues ${fixtureIssues.map((issue) => issue.field).join(", ") || "none"}; workflow mismatches ${workflowMismatches.join(", ") || "none"}`,
  });
}

function confirmationLine(raw: string, prefix: string): string | null {
  const line = raw.split(/\r?\n/).map((item) => item.trim()).find((item) => item.startsWith(`> ${prefix}`));
  return line ? line.slice(2).trim() : null;
}

function checkOperationsLifecycle(): void {
  const requiredFiles = [
    "docs/development/operations-lifecycle.json",
    "docs/development/operations-lifecycle.md",
    "scripts/quality/operations-lifecycle-validate.ts",
    "scripts/quality/operations-lifecycle-validate.selftest.ts",
  ];
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const requiredScripts: Record<string, string> = {
    "ops:lifecycle:validate": "tsx scripts/quality/operations-lifecycle-validate.ts",
    "ops:lifecycle:selftest": "tsx scripts/quality/operations-lifecycle-validate.selftest.ts",
    "ops:lifecycle:typecheck": "tsc --noEmit --target ES2022 --lib ES2022,DOM --module ESNext --moduleResolution Bundler --strict --skipLibCheck --esModuleInterop --types node scripts/quality/operations-lifecycle-validate.ts scripts/quality/operations-lifecycle-validate.selftest.ts",
  };
  const missingFiles = requiredFiles.filter((file) => !existsSync(resolve(file)));
  const missingScripts = Object.entries(requiredScripts)
    .filter(([name, command]) => packageJson.scripts?.[name] !== command)
    .map(([name]) => name);
  const combined = requiredFiles.filter((file) => existsSync(resolve(file))).map(read).join("\n");
  const requiredTerms = [
    "AF-SLO-HEALTH-001",
    "AF-SLO-SMOKE-001",
    "AF-SLO-SEC-001",
    "availability",
    "latency",
    "rto",
    "rpo",
    "draft",
    "confirmed_apply",
    "incidentRuntimeChanged",
  ];
  const missingTerms = requiredTerms.filter((term) => !combined.includes(term));
  const workflows = `${read(".github/workflows/ci.yml")}\n${read(".github/workflows/release.yml")}`;
  const workflowRunCount = workflows.split("pnpm ops:lifecycle:selftest && pnpm ops:lifecycle:validate && pnpm ops:lifecycle:typecheck").length - 1;
  checks.push({
    name: "operations lifecycle policy",
    ok: missingFiles.length === 0 && missingScripts.length === 0 && missingTerms.length === 0 && workflowRunCount === 2,
    detail: missingFiles.length === 0 && missingScripts.length === 0 && missingTerms.length === 0 && workflowRunCount === 2
      ? "SLO, incident transition, and capability lifecycle contracts are read-only, validated, and enforced in CI/Release"
      : `missing files ${missingFiles.join(", ") || "none"}; scripts ${missingScripts.join(", ") || "none"}; terms ${missingTerms.join(", ") || "none"}; workflow count=${workflowRunCount}`,
  });
}

function checkForbiddenLegacyEvidenceNames(): void {
  const files = [
    "README.md",
    "docs/deployment/github-release-updater.md",
    "docs/development/high-risk-confirmation-packets.md",
    "docs/development/ops-001-closure-packet-template.md",
    "docs/development/ops-005-expected-before-production-evidence-template.md",
    "docs/development/ops-001-production-readonly-attempt-20260711.md",
    "docs/development/operational-readiness.md",
    "docs/development/validation-matrix.md",
    "tasks/README.md",
    "tasks/indexes/residuals.md",
    "workflow/README.md",
  ];
  const offenders = files.filter((file) => read(file).includes("ops001-closure-packet.txt"));
  checks.push({
    name: "forbidden legacy evidence filenames",
    ok: offenders.length === 0,
    detail: offenders.length === 0
      ? "OPS-001 closure packet references use ops-001-closure-packet.txt"
      : `legacy ops001-closure-packet.txt references in ${offenders.join(", ")}`,
  });
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "docs/development/operational-readiness.md",
    "docs/development/support-bundle-preview.md",
    "docs/development/maintenance-cadence.md",
    "docs/development/production-smoke-alerting-strategy.md",
    "docs/development/release-train.md",
    "docs/development/completion-evidence-checklist.md",
    "docs/development/runtime-write-boundary.md",
    "docs/development/production-readonly-smoke-record-template.md",
    "docs/development/ops-001-closure-packet-template.md",
    "docs/development/alert-drill-record-template.md",
    "docs/development/incident-record-template.md",
    "docs/development/rollback-proof-record-template.md",
    "docs/development/restore-drill-record-template.md",
    "docs/development/maintenance-window-record-template.md",
    "docs/development/maintenance-window-index.json",
    "docs/development/incident-index.json",
    "docs/development/update-agent-status-record-template.md",
    "scripts/quality/operational-readiness-summary.selftest.ts",
    "docs/development/product-experience-review-record-template.md",
    "docs/deployment/operator-onboarding.md",
    "apps/web/app/layout.tsx",
    "apps/web/app/globals.css",
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    "docs/development/residual-closure-review-template.md",
    ".codex/skills-src/areaforge-operating-loop/SKILL.md",
    ".codex/skills-src/areaforge-operating-loop/references/loop-map.md",
    "scripts/ops/operability-status.ts",
    "scripts/quality/operability-status-validate.ts",
    "scripts/quality/operability-status-validate.selftest.ts",
    "scripts/ops/operational-handoff.ts",
    "scripts/quality/operational-handoff-validate.ts",
    "scripts/quality/operational-handoff-validate.selftest.ts",
    "scripts/ops/long-term-operability-live-gate.ts",
    "scripts/ops/long-term-evidence-snapshot.ts",
    "scripts/ops/operational-readiness-summary.ts",
    "scripts/ops/operational-evidence-bundle.ts",
    "scripts/quality/operational-evidence-source.ts",
    "scripts/quality/operational-evidence-bundle-validate.ts",
    "scripts/quality/operational-evidence-bundle-validate.selftest.ts",
    "scripts/ops/support-bundle-preview.ts",
    "scripts/quality/support-bundle-preview-validate.ts",
    "scripts/quality/support-bundle-preview.selftest.ts",
    "scripts/ops/backup-restore-preview.ts",
    "scripts/quality/backup-restore-preview-validate.ts",
    "scripts/quality/backup-restore-preview.selftest.ts",
    "scripts/ops/ops001-evidence-preflight.ts",
    "scripts/quality/ops001-evidence-preflight.selftest.ts",
    "scripts/ops/ops004-alert-evidence-preflight.ts",
    "scripts/quality/ops004-alert-evidence-preflight.selftest.ts",
    "scripts/ops/ops005-evidence-preflight.ts",
    "scripts/quality/ops005-evidence-preflight.selftest.ts",
    "scripts/quality/ops005-production-evidence-validate.ts",
    "scripts/quality/ops005-production-evidence-validate.selftest.ts",
    "scripts/ops/sc002-supply-chain-preflight.ts",
    "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
    "scripts/quality/github-main-protection-validate.ts",
    "scripts/quality/github-main-protection-validate.selftest.ts",
    "scripts/ops/sc004-main-protection-preflight.ts",
    "scripts/quality/sc004-main-protection-preflight.selftest.ts",
    "docs/development/github-main-protection-record-template.md",
    "scripts/ops/operational-alert-preview.ts",
    "scripts/ops/generate-alert-drill-record.ts",
    "scripts/ops/generate-incident-record.ts",
    "scripts/ops/generate-maintenance-window-record.ts",
    "scripts/ops/maintenance-window-index.ts",
    "scripts/quality/maintenance-window-index-common.ts",
    "scripts/quality/maintenance-window-index-validate.ts",
    "scripts/quality/maintenance-window-index.selftest.ts",
    "scripts/ops/incident-index.ts",
    "scripts/quality/incident-index-common.ts",
    "scripts/quality/incident-index-validate.ts",
    "scripts/quality/incident-index.selftest.ts",
    "scripts/ops/local-ux-smoke.ts",
    "scripts/ops/smoke-password.ts",
    "scripts/ops/generate-prod-readonly-smoke-record.ts",
    "scripts/ops/generate-ops001-closure-packet.ts",
    "scripts/ops/generate-ops001-fallback-closure.ts",
    "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "scripts/quality/release-evidence-redacted-export-validate.ts",
    "scripts/ops/residual-review-due.ts",
    "scripts/quality/maintenance-cadence-preflight.ts",
    "scripts/quality/operator-onboarding-preflight.ts",
    "scripts/quality/release-train-preflight.ts",
    "scripts/quality/prod-readonly-smoke-validate.ts",
    "scripts/quality/prod-readonly-smoke-validate.selftest.ts",
    "scripts/quality/prod-readonly-smoke-config-preflight.ts",
    "scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts",
    "scripts/quality/prod-readonly-smoke-record.selftest.ts",
    "scripts/quality/ops001-fallback-closure.selftest.ts",
    "scripts/quality/release-evidence-redacted-export.selftest.ts",
    "scripts/ops/release-closeout-audit.ts",
    "scripts/quality/release-closeout-audit-validate.ts",
    "scripts/quality/release-closeout-audit.selftest.ts",
    "scripts/quality/attachment-reconciliation.ts",
    "scripts/quality/attachment-reconciliation-summary.ts",
    "scripts/quality/attachment-reconciliation-summary.selftest.ts",
    "scripts/ops/data-integrity-doctor.ts",
    "scripts/quality/data-integrity-doctor-validate.ts",
    "scripts/quality/data-integrity-doctor.selftest.ts",
    "scripts/quality/release-evidence-validate.ts",
    "scripts/quality/release-evidence-validate.selftest.ts",
    "scripts/quality/ops001-blocked-record-validate.ts",
    "scripts/quality/ops001-blocked-record.selftest.ts",
    "scripts/quality/ops001-readonly-fallback.selftest.ts",
    "scripts/quality/ops001-closure-packet-validate.ts",
    "scripts/quality/ops001-closure-packet.selftest.ts",
    "scripts/quality/alert-drill-validate.ts",
    "scripts/quality/alert-drill-validate.selftest.ts",
    "scripts/quality/alert-drill-record.selftest.ts",
    "scripts/quality/maintenance-window-record.selftest.ts",
    "scripts/quality/incident-record-validate.ts",
    "scripts/quality/incident-record-validate.selftest.ts",
    "scripts/quality/rollback-proof-record-validate.ts",
    "scripts/quality/rollback-proof-record-validate.selftest.ts",
    "scripts/quality/restore-drill-validate.ts",
    "scripts/quality/restore-drill-validate.selftest.ts",
    "scripts/quality/maintenance-window-record-validate.ts",
    "scripts/quality/maintenance-window-record-validate.selftest.ts",
    "scripts/ops/generate-update-agent-status-record.ts",
    "scripts/quality/update-agent-status-record.selftest.ts",
    "scripts/quality/update-agent-status-validate.ts",
    "scripts/quality/update-agent-status-validate.selftest.ts",
    "scripts/quality/product-experience-review-validate.ts",
    "scripts/quality/product-experience-review-validate.selftest.ts",
    "scripts/quality/residual-ledger-validate.ts",
    "scripts/quality/residual-evidence-preflight.ts",
    "scripts/quality/residual-evidence-preflight.selftest.ts",
    "scripts/quality/residual-closure-review-validate.ts",
    "scripts/quality/residual-closure-review-validate.selftest.ts",
    "scripts/quality/operability-status-validate.ts",
    "scripts/quality/operability-status-validate.selftest.ts",
    "scripts/quality/operability-status.selftest.ts",
    "scripts/quality/operational-handoff-validate.ts",
    "scripts/quality/operational-handoff-validate.selftest.ts",
    "scripts/quality/operational-handoff.selftest.ts",
    "scripts/quality/ops-readonly-side-effect.selftest.ts",
    "scripts/quality/long-term-operability-live-gate.selftest.ts",
    "scripts/quality/long-term-evidence-snapshot-validate.ts",
    "scripts/quality/long-term-evidence-snapshot.selftest.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required ops readiness files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkOperationalReadinessDoc(): void {
  const doc = read("docs/development/operational-readiness.md");
  const strategy = read("docs/development/production-smoke-alerting-strategy.md");
  const requiredTerms = [
    "只读运营证据聚合入口",
    "AREAFORGE_AUTO_APPLY=none",
    "Web runtime",
    "不得执行 Docker",
    "Public health",
    "Authenticated smoke",
    "Release identity",
    "Update-agent status",
    "Backup freshness",
    "Rollback target",
    "pnpm ops:readiness",
    "pnpm ops:status",
    "pnpm ops:long-term:gate",
    "schema v3",
    "dataIntegrity",
    "bindingStatus: current",
    "read_only_long_term_operability_live_gate",
    "pnpm ops:support:bundle-preview",
    "metadata_only_support_bundle_preview",
    "pnpm maintenance:cadence:preflight",
    "maintenance-cadence.md",
    "pnpm smoke:local-ux",
    "production-smoke-alerting-strategy.md",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-OPS-004",
    "AF-RISK-OPS-005",
    "AF-RISK-OPS-006",
    "AF-RISK-OPS-007",
    "AF-RISK-OPS-008",
    "AF-RISK-UX-001",
    "Product experience review",
    "pnpm experience:review:validate",
    "completion-evidence-checklist.md",
    "runtime-write-boundary.md",
    "residual-risk-ledger.md",
    "safetyFacts",
    "pnpm smoke:prod-readonly:validate",
    "pnpm smoke:prod-readonly:config",
    "pnpm ops:ops-001:preflight",
    "pnpm ops:ops-001:closure:validate",
    "pnpm ops:ops-004:preflight",
    "pnpm ops:ops-005:preflight",
    "pnpm ops:ops-005:evidence:validate",
    "bindingStatus: current",
    "--shape-only",
  ];
  const combined = `${doc}\n${strategy}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "operational readiness doc",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "readiness doc defines signals, freshness, no-web-ops boundary, and residual linkage"
      : `missing ${missing.join(", ")}`,
  });
}

function checkProductionSmokeAlertingStrategy(): void {
  const strategy = read("docs/development/production-smoke-alerting-strategy.md");
  const requiredTerms = [
    "非执行草案",
    "不授权任何生产写入",
    "AREAFORGE_EXTRA_SMOKE_COMMAND",
    "production-readonly-smoke-record-template.md",
    "pnpm smoke:prod-readonly:validate",
    "safetyFacts",
    "[AF_SMOKE]",
    "允许写入范围",
    "禁止范围",
    "清理策略",
    "失败处理",
    "告警阈值",
    "pnpm ops:alert:preview",
    "pnpm ops:ops-004:preflight",
    "pnpm alert:drill:validate",
    "read_only_alert_preview",
    "不调用外部告警接收人",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-OPS-004",
    "AF-RISK-OPS-005",
    "AF-RISK-UX-001",
  ];
  const missing = requiredTerms.filter((term) => !strategy.includes(term));
  checks.push({
    name: "production smoke and alerting strategy",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "strategy defines read-only smoke, confirmed write smoke boundaries, cleanup/failure handling, and alert thresholds without authorizing production writes"
      : `missing ${missing.join(", ")}`,
  });
}

function checkResidualLedger(): void {
  const ledger = read("docs/development/residual-risk-ledger.md");
  let machineLedger;
  try {
    machineLedger = readResidualLedgerV2({ root });
  } catch (error) {
    checks.push({
      name: "residual risk ledger",
      ok: false,
      detail: `invalid V2 ledger: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  const requiredIds = [
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-REL-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-SC-003",
    "AF-RISK-OPS-003",
    "AF-RISK-OPS-004",
    "AF-RISK-OPS-005",
    "AF-RISK-OPS-006",
    "AF-RISK-OPS-007",
    "AF-RISK-OPS-008",
  ];
  const requiredTerms = [
    "monitoring-gap",
    "deferred-work",
    "accepted-exception",
    "关闭条件",
    "所需证据",
    "Owner",
  ];
  const combined = `${ledger}\n${JSON.stringify(machineLedger)}`;
  const missingIds = requiredIds.filter((term) => !combined.includes(term));
  const missingTerms = requiredTerms.filter((term) => !ledger.includes(term));
  const hasValidationScript = read("package.json").includes("residuals:validate");
  checks.push({
    name: "residual risk ledger",
    ok: missingIds.length === 0 && missingTerms.length === 0 && hasValidationScript,
    detail: missingIds.length === 0 && missingTerms.length === 0 && hasValidationScript
      ? "ledger indexes long-term ops, release, supply-chain, and observability residuals with close evidence and machine validation"
      : `missing IDs ${missingIds.join(", ") || "none"}; missing terms ${missingTerms.join(", ") || "none"}; residuals:validate=${hasValidationScript}`,
  });
}

function checkOperatingLoopSkill(): void {
  const skill = read(".codex/skills-src/areaforge-operating-loop/SKILL.md");
  const loopMap = read(".codex/skills-src/areaforge-operating-loop/references/loop-map.md");
  const requiredTerms = [
    "production-release-runbook.md",
    "github-release-updater.md",
    "high-risk-confirmation-packets.md",
    ".github/workflows/release.yml",
    "areaforge-qa-smoke",
    "areaforge-security-governance",
    "post-release public health",
    "authenticated smoke",
    "update-agent status",
    "rollback target",
  ];
  const combined = `${skill}\n${loopMap}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "operating loop release routing",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "operating loop directly routes release/update work to runbook, updater, workflow, security, and smoke evidence"
      : `missing ${missing.join(", ")}`,
  });
}

function checkReleaseWorkflowHardGates(): void {
  const workflow = read(".github/workflows/release.yml");
  const requiredTerms = [
    "validate:",
    "needs: validate",
    "pnpm governance:preflight",
    "pnpm ops:readiness",
    "pnpm github-release-updater:preflight",
    "pnpm shellcheck:updater",
    "pnpm skills:validate",
    "pnpm check",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "unsigned preview",
    "pnpm release:admission:selftest",
    "pnpm release:admission",
    "AREAFORGE_RELEASE_TAG:",
    "AREAFORGE_WORKFLOW_SHA:",
    "Reject existing immutable release identity",
    "pnpm release:identity:probe:selftest",
    "pnpm release:identity:probe",
    "pnpm release:workflow:policy:selftest",
    "AREAFORGE_RELEASE_REPOSITORY:",
    "AREAFORGE_RELEASE_WEB_IMAGE:",
    "AREAFORGE_RELEASE_MIGRATION_IMAGE:",
    "release channel must be stable or preview",
  ];
  const missing = requiredTerms.filter((term) => !workflow.includes(term));
  checks.push({
    name: "release workflow hard gates",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "release workflow validates structured admission and immutable identities before build, and fails closed for unsigned stable releases"
      : `missing ${missing.join(", ")}`,
  });
}

function checkPackageScripts(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["ops:readiness"] ?? "";
  const statusScript = packageJson.scripts?.["ops:status"] ?? "";
  const statusValidateScript = packageJson.scripts?.["ops:status:validate"] ?? "";
  const statusValidateSelftestScript = packageJson.scripts?.["ops:status:validate:selftest"] ?? "";
  const statusSelftestScript = packageJson.scripts?.["ops:status:selftest"] ?? "";
  const handoffScript = packageJson.scripts?.["ops:handoff"] ?? "";
  const handoffValidateScript = packageJson.scripts?.["ops:handoff:validate"] ?? "";
  const handoffValidateSelftestScript = packageJson.scripts?.["ops:handoff:validate:selftest"] ?? "";
  const handoffSelftestScript = packageJson.scripts?.["ops:handoff:selftest"] ?? "";
  const readonlySideEffectSelftestScript = packageJson.scripts?.["ops:readonly-side-effect:selftest"] ?? "";
  const longTermGateScript = packageJson.scripts?.["ops:long-term:gate"] ?? "";
  const longTermGateSelftestScript = packageJson.scripts?.["ops:long-term:gate:selftest"] ?? "";
  const longTermSnapshotScript = packageJson.scripts?.["ops:long-term:snapshot"] ?? "";
  const longTermSnapshotValidateScript = packageJson.scripts?.["ops:long-term:snapshot:validate"] ?? "";
  const longTermSnapshotSelftestScript = packageJson.scripts?.["ops:long-term:snapshot:selftest"] ?? "";
  const summaryScript = packageJson.scripts?.["ops:readiness:summary"] ?? "";
  const summarySelftestScript = packageJson.scripts?.["ops:readiness:summary:selftest"] ?? "";
  const bundleScript = packageJson.scripts?.["ops:evidence:bundle"] ?? "";
  const bundleValidateScript = packageJson.scripts?.["ops:evidence:bundle:validate"] ?? "";
  const bundleSelftestScript = packageJson.scripts?.["ops:evidence:bundle:selftest"] ?? "";
  const supportBundlePreviewScript = packageJson.scripts?.["ops:support:bundle-preview"] ?? "";
  const supportBundlePreviewValidateScript = packageJson.scripts?.["ops:support:bundle-preview:validate"] ?? "";
  const supportBundlePreviewSelftestScript = packageJson.scripts?.["ops:support:bundle-preview:selftest"] ?? "";
  const backupRestorePreviewScript = packageJson.scripts?.["ops:backup-restore:preview"] ?? "";
  const backupRestorePreviewValidateScript = packageJson.scripts?.["ops:backup-restore:preview:validate"] ?? "";
  const backupRestorePreviewSelftestScript = packageJson.scripts?.["ops:backup-restore:preview:selftest"] ?? "";
  const ops001PreflightScript = packageJson.scripts?.["ops:ops-001:preflight"] ?? "";
  const releaseCloseoutAuditScript = packageJson.scripts?.["release:closeout:audit"] ?? "";
  const releaseCloseoutAuditValidateScript = packageJson.scripts?.["release:closeout:audit:validate"] ?? "";
  const releaseCloseoutAuditSelftestScript = packageJson.scripts?.["release:closeout:audit:selftest"] ?? "";
  const attachmentReconciliationScript = packageJson.scripts?.["attachment:reconciliation"] ?? "";
  const attachmentReconciliationSummaryScript = packageJson.scripts?.["attachment:reconciliation:summary"] ?? "";
  const attachmentReconciliationSummarySelftestScript = packageJson.scripts?.["attachment:reconciliation:summary:selftest"] ?? "";
  const dataIntegrityDoctorScript = packageJson.scripts?.["ops:data-integrity:doctor"] ?? "";
  const dataIntegrityValidateScript = packageJson.scripts?.["ops:data-integrity:validate"] ?? "";
  const dataIntegritySelftestScript = packageJson.scripts?.["ops:data-integrity:selftest"] ?? "";
  const releaseEvidenceValidateScript = packageJson.scripts?.["release:evidence:validate"] ?? "";
  const releaseEvidenceSelftestScript = packageJson.scripts?.["release:evidence:selftest"] ?? "";
  const ops001PreflightSelftestScript = packageJson.scripts?.["ops:ops-001:preflight:selftest"] ?? "";
  const ops001BlockedValidateScript = packageJson.scripts?.["ops:ops-001:blocked:validate"] ?? "";
  const ops001BlockedSelftestScript = packageJson.scripts?.["ops:ops-001:blocked:selftest"] ?? "";
  const ops001FallbackFinalizeScript = packageJson.scripts?.["ops:ops-001:fallback:finalize"] ?? "";
  const ops001FallbackFinalizeSelftestScript = packageJson.scripts?.["ops:ops-001:fallback:finalize:selftest"] ?? "";
  const ops001FallbackSelftestScript = packageJson.scripts?.["ops:ops-001:fallback:selftest"] ?? "";
  const ops004PreflightScript = packageJson.scripts?.["ops:ops-004:preflight"] ?? "";
  const ops004PreflightSelftestScript = packageJson.scripts?.["ops:ops-004:preflight:selftest"] ?? "";
  const ops005PreflightScript = packageJson.scripts?.["ops:ops-005:preflight"] ?? "";
  const ops005PreflightSelftestScript = packageJson.scripts?.["ops:ops-005:preflight:selftest"] ?? "";
  const ops005EvidenceValidateScript = packageJson.scripts?.["ops:ops-005:evidence:validate"] ?? "";
  const ops005EvidenceSelftestScript = packageJson.scripts?.["ops:ops-005:evidence:selftest"] ?? "";
  const sc002PreflightScript = packageJson.scripts?.["sc:sc-002:preflight"] ?? "";
  const sc002PreflightSelftestScript = packageJson.scripts?.["sc:sc-002:preflight:selftest"] ?? "";
  const sc004ValidateScript = packageJson.scripts?.["sc:sc-004:validate"] ?? "";
  const sc004ValidateSelftestScript = packageJson.scripts?.["sc:sc-004:validate:selftest"] ?? "";
  const sc004PreflightScript = packageJson.scripts?.["sc:sc-004:preflight"] ?? "";
  const sc004PreflightSelftestScript = packageJson.scripts?.["sc:sc-004:preflight:selftest"] ?? "";
  const ops001ClosureScript = packageJson.scripts?.["ops:ops-001:closure"] ?? "";
  const ops001ClosureValidateScript = packageJson.scripts?.["ops:ops-001:closure:validate"] ?? "";
  const ops001ClosureSelftestScript = packageJson.scripts?.["ops:ops-001:closure:selftest"] ?? "";
  const alertPreviewScript = packageJson.scripts?.["ops:alert:preview"] ?? "";
  const alertDrillValidateScript = packageJson.scripts?.["alert:drill:validate"] ?? "";
  const alertDrillSelftestScript = packageJson.scripts?.["alert:drill:selftest"] ?? "";
  const alertDrillRecordScript = packageJson.scripts?.["alert:drill:record"] ?? "";
  const alertDrillRecordSelftestScript = packageJson.scripts?.["alert:drill:record:selftest"] ?? "";
  const prodReadonlySmokeValidateScript = packageJson.scripts?.["smoke:prod-readonly:validate"] ?? "";
  const prodReadonlySmokeSelftestScript = packageJson.scripts?.["smoke:prod-readonly:selftest"] ?? "";
  const prodReadonlySmokeConfigScript = packageJson.scripts?.["smoke:prod-readonly:config"] ?? "";
  const prodReadonlySmokeConfigSelftestScript = packageJson.scripts?.["smoke:prod-readonly:config:selftest"] ?? "";
  const prodReadonlySmokeRecordScript = packageJson.scripts?.["smoke:prod-readonly:record"] ?? "";
  const prodReadonlySmokeRecordSelftestScript = packageJson.scripts?.["smoke:prod-readonly:record:selftest"] ?? "";
  const localUxSmokeScript = packageJson.scripts?.["smoke:local-ux"] ?? "";
  const localUxSmokeSelftestScript = packageJson.scripts?.["smoke:local-ux:selftest"] ?? "";
  const experienceReviewValidateScript = packageJson.scripts?.["experience:review:validate"] ?? "";
  const experienceReviewSelftestScript = packageJson.scripts?.["experience:review:selftest"] ?? "";
  const residualEvidencePreflightScript = packageJson.scripts?.["residuals:evidence:preflight"] ?? "";
  const residualEvidencePreflightSelftestScript = packageJson.scripts?.["residuals:evidence:preflight:selftest"] ?? "";
  const residualClosureValidateScript = packageJson.scripts?.["residuals:closure:validate"] ?? "";
  const residualClosureSelftestScript = packageJson.scripts?.["residuals:closure:selftest"] ?? "";
  const residualReviewDueScript = packageJson.scripts?.["residuals:review-due"] ?? "";
  const operatorOnboardingPreflightScript = packageJson.scripts?.["operator:onboarding:preflight"] ?? "";
  const releaseTrainPreflightScript = packageJson.scripts?.["release:train:preflight"] ?? "";
  const maintenanceCadencePreflightScript = packageJson.scripts?.["maintenance:cadence:preflight"] ?? "";
  const enterpriseOperabilityPreflightScript = packageJson.scripts?.["enterprise:operability:preflight"] ?? "";
  const maintenanceWindowRecordScript = packageJson.scripts?.["maintenance:window:record"] ?? "";
  const maintenanceWindowRecordSelftestScript = packageJson.scripts?.["maintenance:window:record:selftest"] ?? "";
  const maintenanceWindowValidateScript = packageJson.scripts?.["maintenance:window:validate"] ?? "";
  const maintenanceWindowIndexScript = packageJson.scripts?.["maintenance:window:index"] ?? "";
  const maintenanceWindowIndexValidateScript = packageJson.scripts?.["maintenance:window:index:validate"] ?? "";
  const maintenanceWindowIndexSelftestScript = packageJson.scripts?.["maintenance:window:index:selftest"] ?? "";
  const incidentRecordValidateScript = packageJson.scripts?.["incident:record:validate"] ?? "";
  const incidentIndexScript = packageJson.scripts?.["incident:index"] ?? "";
  const incidentIndexValidateScript = packageJson.scripts?.["incident:index:validate"] ?? "";
  const incidentIndexSelftestScript = packageJson.scripts?.["incident:index:selftest"] ?? "";
  const rollbackProofValidateScript = packageJson.scripts?.["rollback:proof:validate"] ?? "";
  const rollbackProofSelftestScript = packageJson.scripts?.["rollback:proof:selftest"] ?? "";
  const restoreDrillValidateScript = packageJson.scripts?.["restore:drill:validate"] ?? "";
  const updateAgentStatusRecordScript = packageJson.scripts?.["update-agent:status:record"] ?? "";
  const updateAgentStatusRecordSelftestScript = packageJson.scripts?.["update-agent:status:record:selftest"] ?? "";
  const updateAgentStatusValidateScript = packageJson.scripts?.["update-agent:status:validate"] ?? "";
  checks.push({
    name: "ops readiness package script",
    ok: script === "tsx scripts/quality/ops-readiness-preflight.ts" &&
      statusScript === "tsx scripts/ops/operability-status.ts" &&
      statusValidateScript === "tsx scripts/quality/operability-status-validate.ts" &&
      statusValidateSelftestScript === "tsx scripts/quality/operability-status-validate.selftest.ts" &&
      statusSelftestScript === "tsx scripts/quality/operability-status.selftest.ts" &&
      handoffScript === "tsx scripts/ops/operational-handoff.ts" &&
      handoffValidateScript === "tsx scripts/quality/operational-handoff-validate.ts" &&
      handoffValidateSelftestScript === "tsx scripts/quality/operational-handoff-validate.selftest.ts" &&
      handoffSelftestScript === "tsx scripts/quality/operational-handoff.selftest.ts" &&
      readonlySideEffectSelftestScript === "tsx scripts/quality/ops-readonly-side-effect.selftest.ts" &&
      longTermGateScript === "tsx scripts/ops/long-term-operability-live-gate.ts" &&
      longTermGateSelftestScript === "tsx scripts/quality/long-term-operability-live-gate.selftest.ts" &&
      longTermSnapshotScript === "tsx scripts/ops/long-term-evidence-snapshot.ts" &&
      longTermSnapshotValidateScript === "tsx scripts/quality/long-term-evidence-snapshot-validate.ts" &&
      longTermSnapshotSelftestScript === "tsx scripts/quality/long-term-evidence-snapshot.selftest.ts" &&
      summaryScript === "tsx scripts/ops/operational-readiness-summary.ts" &&
      summarySelftestScript === "tsx scripts/quality/operational-readiness-summary.selftest.ts" &&
      bundleScript === "tsx scripts/ops/operational-evidence-bundle.ts" &&
      bundleValidateScript === "tsx scripts/quality/operational-evidence-bundle-validate.ts" &&
      bundleSelftestScript === "tsx scripts/quality/operational-evidence-bundle-validate.selftest.ts" &&
      supportBundlePreviewScript === "tsx scripts/ops/support-bundle-preview.ts" &&
      supportBundlePreviewValidateScript === "tsx scripts/quality/support-bundle-preview-validate.ts" &&
      supportBundlePreviewSelftestScript === "tsx scripts/quality/support-bundle-preview.selftest.ts" &&
      backupRestorePreviewScript === "tsx scripts/ops/backup-restore-preview.ts" &&
      backupRestorePreviewValidateScript === "tsx scripts/quality/backup-restore-preview-validate.ts" &&
      backupRestorePreviewSelftestScript === "tsx scripts/quality/backup-restore-preview.selftest.ts" &&
      releaseCloseoutAuditScript === "tsx scripts/ops/release-closeout-audit.ts" &&
      releaseCloseoutAuditValidateScript === "tsx scripts/quality/release-closeout-audit-validate.ts" &&
      releaseCloseoutAuditSelftestScript === "tsx scripts/quality/release-closeout-audit.selftest.ts" &&
      attachmentReconciliationScript === "tsx scripts/quality/attachment-reconciliation.ts" &&
      attachmentReconciliationSummaryScript === "tsx scripts/quality/attachment-reconciliation-summary.ts" &&
      attachmentReconciliationSummarySelftestScript === "tsx scripts/quality/attachment-reconciliation-summary.selftest.ts" &&
      dataIntegrityDoctorScript === "tsx scripts/ops/data-integrity-doctor.ts" &&
      dataIntegrityValidateScript === "tsx scripts/quality/data-integrity-doctor-validate.ts" &&
      dataIntegritySelftestScript === "tsx scripts/quality/data-integrity-doctor.selftest.ts" &&
      releaseEvidenceValidateScript === "tsx scripts/quality/release-evidence-validate.ts" &&
      releaseEvidenceSelftestScript === "tsx scripts/quality/release-evidence-validate.selftest.ts" &&
      ops001PreflightScript === "tsx scripts/ops/ops001-evidence-preflight.ts" &&
      ops001PreflightSelftestScript === "tsx scripts/quality/ops001-evidence-preflight.selftest.ts" &&
      ops001BlockedValidateScript === "tsx scripts/quality/ops001-blocked-record-validate.ts" &&
      ops001BlockedSelftestScript === "tsx scripts/quality/ops001-blocked-record.selftest.ts" &&
      ops001FallbackFinalizeScript === "tsx scripts/ops/generate-ops001-fallback-closure.ts" &&
      ops001FallbackFinalizeSelftestScript === "tsx scripts/quality/ops001-fallback-closure.selftest.ts" &&
      ops001FallbackSelftestScript === "tsx scripts/quality/ops001-readonly-fallback.selftest.ts" &&
      ops004PreflightScript === "tsx scripts/ops/ops004-alert-evidence-preflight.ts" &&
      ops004PreflightSelftestScript === "tsx scripts/quality/ops004-alert-evidence-preflight.selftest.ts" &&
      ops005PreflightScript === "tsx scripts/ops/ops005-evidence-preflight.ts" &&
      ops005PreflightSelftestScript === "tsx scripts/quality/ops005-evidence-preflight.selftest.ts" &&
      ops005EvidenceValidateScript === "tsx scripts/quality/ops005-production-evidence-validate.ts" &&
      ops005EvidenceSelftestScript === "tsx scripts/quality/ops005-production-evidence-validate.selftest.ts" &&
      sc002PreflightScript === "tsx scripts/ops/sc002-supply-chain-preflight.ts" &&
      sc002PreflightSelftestScript === "tsx scripts/quality/sc002-supply-chain-preflight.selftest.ts" &&
      sc004ValidateScript === "tsx scripts/quality/github-main-protection-validate.ts" &&
      sc004ValidateSelftestScript === "tsx scripts/quality/github-main-protection-validate.selftest.ts" &&
      sc004PreflightScript === "tsx scripts/ops/sc004-main-protection-preflight.ts" &&
      sc004PreflightSelftestScript === "tsx scripts/quality/sc004-main-protection-preflight.selftest.ts" &&
      ops001ClosureScript === "tsx scripts/ops/generate-ops001-closure-packet.ts" &&
      ops001ClosureValidateScript === "tsx scripts/quality/ops001-closure-packet-validate.ts" &&
      ops001ClosureSelftestScript === "tsx scripts/quality/ops001-closure-packet.selftest.ts" &&
      alertPreviewScript === "tsx scripts/ops/operational-alert-preview.ts" &&
      alertDrillValidateScript === "tsx scripts/quality/alert-drill-validate.ts" &&
      alertDrillSelftestScript === "tsx scripts/quality/alert-drill-validate.selftest.ts" &&
      alertDrillRecordScript === "tsx scripts/ops/generate-alert-drill-record.ts" &&
      alertDrillRecordSelftestScript === "tsx scripts/quality/alert-drill-record.selftest.ts" &&
      prodReadonlySmokeValidateScript === "tsx scripts/quality/prod-readonly-smoke-validate.ts" &&
      prodReadonlySmokeSelftestScript === "tsx scripts/quality/prod-readonly-smoke-validate.selftest.ts" &&
      prodReadonlySmokeConfigScript === "tsx scripts/quality/prod-readonly-smoke-config-preflight.ts" &&
      prodReadonlySmokeConfigSelftestScript === "tsx scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts" &&
      prodReadonlySmokeRecordScript === "tsx scripts/ops/generate-prod-readonly-smoke-record.ts" &&
      prodReadonlySmokeRecordSelftestScript === "tsx scripts/quality/prod-readonly-smoke-record.selftest.ts" &&
      packageJson.scripts?.["residuals:validate"] === "tsx scripts/quality/residual-ledger-validate.ts" &&
      residualEvidencePreflightScript === "tsx scripts/quality/residual-evidence-preflight.ts" &&
      residualEvidencePreflightSelftestScript === "tsx scripts/quality/residual-evidence-preflight.selftest.ts" &&
      residualClosureValidateScript === "tsx scripts/quality/residual-closure-review-validate.ts" &&
      residualClosureSelftestScript === "tsx scripts/quality/residual-closure-review-validate.selftest.ts" &&
      residualReviewDueScript === "tsx scripts/ops/residual-review-due.ts" &&
      localUxSmokeScript === "tsx scripts/ops/local-ux-smoke.ts" &&
      localUxSmokeSelftestScript === "tsx scripts/quality/local-ux-smoke.selftest.ts" &&
      experienceReviewValidateScript === "tsx scripts/quality/product-experience-review-validate.ts" &&
      experienceReviewSelftestScript === "tsx scripts/quality/product-experience-review-validate.selftest.ts" &&
      operatorOnboardingPreflightScript === "tsx scripts/quality/operator-onboarding-preflight.ts" &&
      releaseTrainPreflightScript === "tsx scripts/quality/release-train-preflight.ts" &&
      maintenanceCadencePreflightScript === "tsx scripts/quality/maintenance-cadence-preflight.ts" &&
      enterpriseOperabilityPreflightScript === "tsx scripts/quality/enterprise-operability-preflight.ts" &&
      maintenanceWindowRecordScript === "tsx scripts/ops/generate-maintenance-window-record.ts" &&
      maintenanceWindowRecordSelftestScript === "tsx scripts/quality/maintenance-window-record.selftest.ts" &&
      maintenanceWindowValidateScript === "tsx scripts/quality/maintenance-window-record-validate.ts" &&
      maintenanceWindowIndexScript === "tsx scripts/ops/maintenance-window-index.ts" &&
      maintenanceWindowIndexValidateScript === "tsx scripts/quality/maintenance-window-index-validate.ts" &&
      maintenanceWindowIndexSelftestScript === "tsx scripts/quality/maintenance-window-index.selftest.ts" &&
      incidentRecordValidateScript === "tsx scripts/quality/incident-record-validate.ts" &&
      incidentIndexScript === "tsx scripts/ops/incident-index.ts" &&
      incidentIndexValidateScript === "tsx scripts/quality/incident-index-validate.ts" &&
      incidentIndexSelftestScript === "tsx scripts/quality/incident-index.selftest.ts" &&
      rollbackProofValidateScript === "tsx scripts/quality/rollback-proof-record-validate.ts" &&
      rollbackProofSelftestScript === "tsx scripts/quality/rollback-proof-record-validate.selftest.ts" &&
      restoreDrillValidateScript === "tsx scripts/quality/restore-drill-validate.ts" &&
      updateAgentStatusRecordScript === "tsx scripts/ops/generate-update-agent-status-record.ts" &&
      updateAgentStatusRecordSelftestScript === "tsx scripts/quality/update-agent-status-record.selftest.ts" &&
      updateAgentStatusValidateScript === "tsx scripts/quality/update-agent-status-validate.ts",
    detail: `ops:readiness=${script || "missing"}; ops:status=${statusScript || "missing"}; ops:status:validate=${statusValidateScript || "missing"}; ops:status:validate:selftest=${statusValidateSelftestScript || "missing"}; ops:status:selftest=${statusSelftestScript || "missing"}; ops:handoff=${handoffScript || "missing"}; ops:handoff:validate=${handoffValidateScript || "missing"}; ops:handoff:validate:selftest=${handoffValidateSelftestScript || "missing"}; ops:handoff:selftest=${handoffSelftestScript || "missing"}; ops:readonly-side-effect:selftest=${readonlySideEffectSelftestScript || "missing"}; ops:long-term:gate=${longTermGateScript || "missing"}; ops:long-term:gate:selftest=${longTermGateSelftestScript || "missing"}; ops:long-term:snapshot=${longTermSnapshotScript || "missing"}; ops:long-term:snapshot:validate=${longTermSnapshotValidateScript || "missing"}; ops:long-term:snapshot:selftest=${longTermSnapshotSelftestScript || "missing"}; ops:readiness:summary=${summaryScript || "missing"}; ops:readiness:summary:selftest=${summarySelftestScript || "missing"}; ops:evidence:bundle=${bundleScript || "missing"}; ops:evidence:bundle:validate=${bundleValidateScript || "missing"}; ops:evidence:bundle:selftest=${bundleSelftestScript || "missing"}; ops:support:bundle-preview=${supportBundlePreviewScript || "missing"}; ops:support:bundle-preview:validate=${supportBundlePreviewValidateScript || "missing"}; ops:support:bundle-preview:selftest=${supportBundlePreviewSelftestScript || "missing"}; ops:backup-restore:preview=${backupRestorePreviewScript || "missing"}; ops:backup-restore:preview:validate=${backupRestorePreviewValidateScript || "missing"}; ops:backup-restore:preview:selftest=${backupRestorePreviewSelftestScript || "missing"}; ops:ops-001:preflight=${ops001PreflightScript || "missing"}; ops:ops-001:preflight:selftest=${ops001PreflightSelftestScript || "missing"}; ops:ops-001:blocked:validate=${ops001BlockedValidateScript || "missing"}; ops:ops-001:blocked:selftest=${ops001BlockedSelftestScript || "missing"}; ops:ops-001:fallback:finalize=${ops001FallbackFinalizeScript || "missing"}; ops:ops-001:fallback:finalize:selftest=${ops001FallbackFinalizeSelftestScript || "missing"}; ops:ops-001:fallback:selftest=${ops001FallbackSelftestScript || "missing"}; ops:ops-004:preflight=${ops004PreflightScript || "missing"}; ops:ops-004:preflight:selftest=${ops004PreflightSelftestScript || "missing"}; sc:sc-002:preflight=${sc002PreflightScript || "missing"}; sc:sc-002:preflight:selftest=${sc002PreflightSelftestScript || "missing"}; ops:ops-001:closure=${ops001ClosureScript || "missing"}; ops:ops-001:closure:validate=${ops001ClosureValidateScript || "missing"}; ops:ops-001:closure:selftest=${ops001ClosureSelftestScript || "missing"}; ops:alert:preview=${alertPreviewScript || "missing"}; alert:drill:validate=${alertDrillValidateScript || "missing"}; alert:drill:selftest=${alertDrillSelftestScript || "missing"}; alert:drill:record=${alertDrillRecordScript || "missing"}; alert:drill:record:selftest=${alertDrillRecordSelftestScript || "missing"}; smoke:prod-readonly:validate=${prodReadonlySmokeValidateScript || "missing"}; smoke:prod-readonly:selftest=${prodReadonlySmokeSelftestScript || "missing"}; smoke:prod-readonly:config=${prodReadonlySmokeConfigScript || "missing"}; smoke:prod-readonly:config:selftest=${prodReadonlySmokeConfigSelftestScript || "missing"}; smoke:prod-readonly:record=${prodReadonlySmokeRecordScript || "missing"}; smoke:prod-readonly:record:selftest=${prodReadonlySmokeRecordSelftestScript || "missing"}; residuals:validate=${packageJson.scripts?.["residuals:validate"] ?? "missing"}; residuals:evidence:preflight=${residualEvidencePreflightScript || "missing"}; residuals:evidence:preflight:selftest=${residualEvidencePreflightSelftestScript || "missing"}; residuals:closure:validate=${residualClosureValidateScript || "missing"}; residuals:closure:selftest=${residualClosureSelftestScript || "missing"}; residuals:review-due=${residualReviewDueScript || "missing"}; smoke:local-ux=${localUxSmokeScript || "missing"}; smoke:local-ux:selftest=${localUxSmokeSelftestScript || "missing"}; experience:review:validate=${experienceReviewValidateScript || "missing"}; experience:review:selftest=${experienceReviewSelftestScript || "missing"}; operator:onboarding:preflight=${operatorOnboardingPreflightScript || "missing"}; release:train:preflight=${releaseTrainPreflightScript || "missing"}; maintenance:cadence:preflight=${maintenanceCadencePreflightScript || "missing"}; enterprise:operability:preflight=${enterpriseOperabilityPreflightScript || "missing"}; maintenance:window:record=${maintenanceWindowRecordScript || "missing"}; maintenance:window:record:selftest=${maintenanceWindowRecordSelftestScript || "missing"}; maintenance:window:validate=${maintenanceWindowValidateScript || "missing"}; incident:record:validate=${incidentRecordValidateScript || "missing"}; restore:drill:validate=${restoreDrillValidateScript || "missing"}; update-agent:status:record=${updateAgentStatusRecordScript || "missing"}; update-agent:status:record:selftest=${updateAgentStatusRecordSelftestScript || "missing"}; update-agent:status:validate=${updateAgentStatusValidateScript || "missing"}`,
  });
}

function checkLocalUxSmokeScript(): void {
  const script = read("scripts/ops/local-ux-smoke.ts");
  const password = read("scripts/ops/smoke-password.ts");
  const productionSmoke = read("scripts/ops/production-readonly-smoke.ts");
  const docs = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "AREAFORGE_SMOKE_ALLOW_WRITES",
    "AREAFORGE_SMOKE_ALLOW_NON_LOCAL is unsupported",
    "isLocalBaseUrl",
    "assertNoActiveSession(\"active session preflight\"",
    "AREAFORGE_SMOKE_PASSWORD_FILE must be owner-readable and group/world-inaccessible",
    "recordFailure(\"fatal\", error)",
    "upload note attachment",
    "update center request boundary",
    "AF-RISK-OPS-002",
    "不能关闭生产写入型 smoke",
    "product-experience-review-record-template.md",
    "pnpm experience:review:validate",
  ];
  const combined = `${script}\n${password}\n${productionSmoke}\n${docs}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  const forbiddenOverrides = [
    "unless explicitly setting AREAFORGE_SMOKE_ALLOW_NON_LOCAL=true",
    "除非显式设置 AREAFORGE_SMOKE_ALLOW_NON_LOCAL=true",
  ].filter((term) => combined.includes(term));
  checks.push({
    name: "local UX smoke guardrails",
    ok: missing.length === 0 && forbiddenOverrides.length === 0,
    detail: missing.length === 0 && forbiddenOverrides.length === 0
      ? "local UX smoke is write-gated, local-only, active-session guarded, password-file hardened, and separated from production write smoke"
      : `missing ${missing.join(", ")}${forbiddenOverrides.length > 0 ? `; forbidden ${forbiddenOverrides.join(", ")}` : ""}`,
  });
}

function checkSummaryScript(): void {
  const handoff = read("scripts/ops/operational-handoff.ts");
  const handoffSelftest = read("scripts/quality/operational-handoff.selftest.ts");
  const longTermGate = read("scripts/ops/long-term-operability-live-gate.ts");
  const longTermGateSelftest = read("scripts/quality/long-term-operability-live-gate.selftest.ts");
  const longTermSnapshot = read("scripts/ops/long-term-evidence-snapshot.ts");
  const longTermSnapshotValidate = read("scripts/quality/long-term-evidence-snapshot-validate.ts");
  const longTermSnapshotSelftest = read("scripts/quality/long-term-evidence-snapshot.selftest.ts");
  const script = read("scripts/ops/operational-readiness-summary.ts");
  const bundle = read("scripts/ops/operational-evidence-bundle.ts");
  const supportBundlePreview = read("scripts/ops/support-bundle-preview.ts");
  const supportBundlePreviewValidate = read("scripts/quality/support-bundle-preview-validate.ts");
  const supportBundlePreviewSelftest = read("scripts/quality/support-bundle-preview.selftest.ts");
  const backupRestorePreview = read("scripts/ops/backup-restore-preview.ts");
  const backupRestorePreviewValidate = read("scripts/quality/backup-restore-preview-validate.ts");
  const backupRestorePreviewSelftest = read("scripts/quality/backup-restore-preview.selftest.ts");
  const alertPreview = read("scripts/ops/operational-alert-preview.ts");
  const alertDrillRecord = read("scripts/ops/generate-alert-drill-record.ts");
  const alertDrillRecordSelftest = read("scripts/quality/alert-drill-record.selftest.ts");
  const prodReadonlySmokeValidate = read("scripts/quality/prod-readonly-smoke-validate.ts");
  const prodReadonlySmokeSelftest = read("scripts/quality/prod-readonly-smoke-validate.selftest.ts");
  const prodReadonlySmokeConfig = read("scripts/quality/prod-readonly-smoke-config-preflight.ts");
  const prodReadonlySmokeConfigSelftest = read("scripts/quality/prod-readonly-smoke-config-preflight.selftest.ts");
  const prodReadonlySmokeRecord = read("scripts/ops/generate-prod-readonly-smoke-record.ts");
  const prodReadonlySmokeRecordSelftest = read("scripts/quality/prod-readonly-smoke-record.selftest.ts");
  const ops001Preflight = read("scripts/ops/ops001-evidence-preflight.ts");
  const ops001PreflightSelftest = read("scripts/quality/ops001-evidence-preflight.selftest.ts");
  const ops001FallbackHelper = read("ops/update-agent/areaforge-ops001-readonly-fallback.sh");
  const ops001FallbackSelftest = read("scripts/quality/ops001-readonly-fallback.selftest.ts");
  const ops001ClosurePacket = read("scripts/ops/generate-ops001-closure-packet.ts");
  const ops001ClosurePacketValidate = read("scripts/quality/ops001-closure-packet-validate.ts");
  const ops001ClosurePacketSelftest = read("scripts/quality/ops001-closure-packet.selftest.ts");
  const alertDrill = read("scripts/quality/alert-drill-validate.ts");
  const alertDrillSelftest = read("scripts/quality/alert-drill-validate.selftest.ts");
  const updateAgentStatusRecord = read("scripts/ops/generate-update-agent-status-record.ts");
  const updateAgentStatusRecordSelftest = read("scripts/quality/update-agent-status-record.selftest.ts");
  const productExperience = read("scripts/quality/product-experience-review-validate.ts");
  const productExperienceSelftest = read("scripts/quality/product-experience-review-validate.selftest.ts");
  const sc004Validate = read("scripts/quality/github-main-protection-validate.ts");
  const sc004ValidateSelftest = read("scripts/quality/github-main-protection-validate.selftest.ts");
  const sc004Preflight = read("scripts/ops/sc004-main-protection-preflight.ts");
  const sc004PreflightSelftest = read("scripts/quality/sc004-main-protection-preflight.selftest.ts");
  const docs = read("docs/development/operational-readiness.md");
  const requiredTerms = [
    "AREAFORGE_READINESS_BASE_URL",
    "AREAFORGE_READINESS_UPDATE_STATUS_FILE",
    "AREAFORGE_READINESS_SMOKE_RESULT_FILE",
    "AREAFORGE_READINESS_RELEASE_MANIFEST_FILE",
    "AREAFORGE_READINESS_RELEASE_MANIFEST_URL",
    "AREAFORGE_READINESS_GITHUB_REPO",
    "AREAFORGE_READINESS_CERT_DAYS",
    "AREAFORGE_READINESS_FAIL_ON",
    "AF-RISK-OPS-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-SC-004",
    "sc:sc-004:validate",
    "sc:sc-004:preflight",
    "ci / verify",
    "pnpm ops:readiness:summary",
    "read_only_operational_handoff",
    "pnpm ops:handoff",
    "operational handoff selftest",
    "read_only_long_term_operability_live_gate",
    "ops:long-term:gate",
    "ops:long-term:snapshot",
    "read_only_long_term_evidence_snapshot",
    "long-term evidence snapshot validation passed",
    "PASS long-term evidence snapshot validator selftest",
    "snapshotHash",
    "ready_for_long_term_operability_review",
    "不得执行 Docker",
    "safetyFacts",
    "serverCommandAttempted",
    "backupRestoreAttempted",
    "productionWriteAttempted",
    "secretValuePrinted",
    "smoke:prod-readonly:validate",
    "smoke:prod-readonly:config",
    "smoke:prod-readonly:record",
    "update-agent:status:record",
    "update-agent status record generator selftest passed",
    "production readonly smoke config preflight passed",
    "production readonly smoke config preflight selftest passed",
    "passwordFileContentRead",
    "production readonly smoke record generator selftest passed",
    "production readonly smoke validator selftest passed",
    "production readonly smoke record validation passed",
    "pnpm ops:evidence:bundle",
    "pnpm ops:evidence:bundle:validate",
    "read_only_operational_evidence_bundle",
    "bundleHash",
    "sourceSnapshot",
    "bindingStatus",
    "bind_current_source_inputs",
    "--shape-only",
    "pnpm ops:support:bundle-preview",
    "metadata_only_support_bundle_preview",
    "supportBundlePreviewHash",
    "support bundle preview selftest passed",
    "AREAFORGE_READINESS_BACKUP_RESTORE_PREVIEW_FILE",
    "pnpm ops:backup-restore:preview",
    "metadata_only_backup_restore_preview",
    "backupRestorePreviewHash",
    "blockingGaps",
    "backup/restore preview selftest passed",
    "restore apply execution",
    "ops:ops-001:preflight",
    "read_only_ops001_evidence_preflight",
    "ready_to_generate_packet",
    "ready_for_human_close",
    "OPS-001 evidence preflight selftest passed",
    "ops001-readonly-fallback-prerequisites",
    "remote-prerequisites.json",
    "redactedHandoffStatus",
    "OPS-001 read-only fallback helper selftest passed",
    "ops:ops-001:closure",
    "OPS-001 closure packet validation passed",
    "OPS-001 closure packet selftest passed",
    "ready-for-human-close-after-review",
    "automatic HTTPS certificate",
    "forbiddenActions",
    "pnpm ops:alert:preview",
    "read_only_alert_preview",
    "alert:drill:record",
    "alert drill record generator selftest passed",
    "notificationSent",
    "externalAlertReceiverCalled",
    "alert:drill:validate",
    "alert drill validator selftest passed",
    "alert drill validation passed",
    "AF-RISK-OPS-004",
    "AF-RISK-UX-001",
    "product experience review validation passed",
    "product experience review validator selftest passed",
  ];
  const combined = `${handoff}\n${handoffSelftest}\n${longTermGate}\n${longTermGateSelftest}\n${longTermSnapshot}\n${longTermSnapshotValidate}\n${longTermSnapshotSelftest}\n${script}\n${bundle}\n${supportBundlePreview}\n${supportBundlePreviewValidate}\n${supportBundlePreviewSelftest}\n${backupRestorePreview}\n${backupRestorePreviewValidate}\n${backupRestorePreviewSelftest}\n${alertPreview}\n${alertDrillRecord}\n${alertDrillRecordSelftest}\n${prodReadonlySmokeValidate}\n${prodReadonlySmokeSelftest}\n${prodReadonlySmokeConfig}\n${prodReadonlySmokeConfigSelftest}\n${prodReadonlySmokeRecord}\n${prodReadonlySmokeRecordSelftest}\n${ops001Preflight}\n${ops001PreflightSelftest}\n${ops001FallbackHelper}\n${ops001FallbackSelftest}\n${ops001ClosurePacket}\n${ops001ClosurePacketValidate}\n${ops001ClosurePacketSelftest}\n${alertDrill}\n${alertDrillSelftest}\n${updateAgentStatusRecord}\n${updateAgentStatusRecordSelftest}\n${productExperience}\n${productExperienceSelftest}\n${sc004Validate}\n${sc004ValidateSelftest}\n${sc004Preflight}\n${sc004PreflightSelftest}\n${docs}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "ops readiness summary, bundle, and alert preview scripts",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "handoff, summary, evidence bundle, and alert preview scripts expose read-only operational evidence aggregation"
      : `missing ${missing.join(", ")}`,
  });
}

function checkDocsIndex(): void {
  const docsReadme = read("docs/README.md");
  const rootReadme = read("README.md");
  const agents = read("AGENTS.md");
  const requiredTerms = [
    "development/operational-readiness.md",
    "development/maintenance-cadence.md",
    "development/release-train.md",
    "development/residual-risk-ledger.md",
    "development/product-experience-review-record-template.md",
    "development/operations-lifecycle.md",
    "deployment/operator-onboarding.md",
    "areaforge-operating-loop",
  ];
  const combined = `${docsReadme}\n${rootReadme}\n${agents}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "docs index entries",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "README, AGENTS, and docs index expose operating loop, readiness, and residual ledger"
      : `missing ${missing.join(", ")}`,
  });
}

function checkBuildNetworkDependencyBoundary(): void {
  const layout = read("apps/web/app/layout.tsx");
  const globals = read("apps/web/app/globals.css");
  const forbidden = [
    "next/font/google",
    "font-geist",
    "fonts.gstatic.com",
    "fonts.googleapis.com",
  ];
  const combined = `${layout}\n${globals}`;
  const found = forbidden.filter((term) => combined.includes(term));
  const required = [
    "--font-area-sans",
    "--font-area-mono",
    "--font-sans: var(--font-area-sans)",
    "--font-mono: var(--font-area-mono)",
  ];
  const missing = required.filter((term) => !globals.includes(term));
  checks.push({
    name: "build network dependency boundary",
    ok: found.length === 0 && missing.length === 0,
    detail: found.length === 0 && missing.length === 0
      ? "web layout uses local system font variables and avoids build-time Google Font network dependency"
      : `forbidden ${found.join(", ") || "none"}; missing ${missing.join(", ") || "none"}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
