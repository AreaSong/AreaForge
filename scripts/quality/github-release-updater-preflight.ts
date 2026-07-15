import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkShellSyntax();
  checkExecutableModes();
  checkReleaseSupplyChainScript();
  checkManifestExample();
  checkUpdaterBoundaries();
  checkMigrationDockerfile();
  checkWorkflowTopLevelSyntax();
  checkCiWorkflow();
  checkReleaseWorkflow();
  checkDocs();
  checkExtraSmokeCommand();
  checkUpdateAgentRequestBoundary();
  checkWebRuntimeBoundary();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`GitHub Release updater preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("GitHub Release updater preflight passed: updater artifacts are present and checks are read-only.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/github-release-updater/areaforge-updater.env.example",
    "ops/github-release-updater/areaforge-updater.service",
    "ops/github-release-updater/areaforge-updater.timer",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/lib/update-request-v2.sh",
    "ops/update-agent/lib/update-request-state.sh",
    "ops/update-agent/areaforge-ops001-evidence-export.sh",
    "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "ops/update-agent/areaforge-release-readonly-smoke.sh",
    "ops/update-agent/areaforge-update-agent.service",
    "ops/update-agent/areaforge-update-agent.timer",
    "ops/github-release-updater/manifest.example.json",
    "ops/github-release-updater/manifest.schema.json",
    "ops/github-release-updater/README.md",
    "scripts/ops/generate-release-supply-chain.ts",
    "scripts/quality/release-supply-chain-validate.ts",
    "scripts/quality/release-supply-chain-validate.selftest.ts",
    "scripts/ops/production-readonly-smoke.ts",
    "scripts/ops/generate-release-evidence-record-from-redacted-export.ts",
    "scripts/quality/release-evidence-redacted-export-validate.ts",
    "scripts/quality/ops001-readonly-fallback.selftest.ts",
    "scripts/quality/release-evidence-redacted-export.selftest.ts",
    "scripts/quality/release-evidence-redacted-export-record.selftest.ts",
    "scripts/quality/update-center-request-guard.selftest.ts",
    "scripts/quality/update-center-request-v2.selftest.ts",
    "scripts/quality/update-agent-request-v2.selftest.ts",
    "scripts/quality/update-production-state-lock.selftest.ts",
    "scripts/quality/fixtures/update-request-v2/canonical-request.json",
    "scripts/quality/fixtures/update-request-v2/canonical-request.expected.json",
    "scripts/quality/ops-readiness-preflight.ts",
    "infra/docker/migration.Dockerfile",
    ".github/workflows/ci.yml",
    ".github/workflows/release.yml",
    "docs/deployment/github-release-updater.md",
    "docs/development/github-release-updater-design.md",
    "docs/development/release-supply-chain-record-template.md",
    "docs/development/ci-supply-chain-record-template.md",
    "scripts/ops/generate-release-supply-chain-record.ts",
    "scripts/quality/release-supply-chain-record.selftest.ts",
    "scripts/ops/generate-ci-supply-chain-record.ts",
    "scripts/quality/ci-supply-chain-record-validate.ts",
    "scripts/quality/ci-supply-chain-record.selftest.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required updater files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkReleaseSupplyChainScript(): void {
  const script = read("scripts/ops/generate-release-supply-chain.ts");
  const recordScript = read("scripts/ops/generate-release-supply-chain-record.ts");
  const ciRecordScript = read("scripts/ops/generate-ci-supply-chain-record.ts");
  const validator = read("scripts/quality/release-supply-chain-validate.ts");
  const selftest = read("scripts/quality/release-supply-chain-validate.selftest.ts");
  const recordSelftest = read("scripts/quality/release-supply-chain-record.selftest.ts");
  const ciValidator = read("scripts/quality/ci-supply-chain-record-validate.ts");
  const ciSelftest = read("scripts/quality/ci-supply-chain-record.selftest.ts");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const releaseScript = packageJson.scripts?.["release:supply-chain"] ?? "";
  const validateScript = packageJson.scripts?.["release:supply-chain:validate"] ?? "";
  const selftestScript = packageJson.scripts?.["release:supply-chain:selftest"] ?? "";
  const recordPackageScript = packageJson.scripts?.["release:supply-chain:record"] ?? "";
  const recordSelftestPackageScript = packageJson.scripts?.["release:supply-chain:record:selftest"] ?? "";
  const ciRecordPackageScript = packageJson.scripts?.["ci:supply-chain:record"] ?? "";
  const ciValidatePackageScript = packageJson.scripts?.["ci:supply-chain:validate"] ?? "";
  const ciSelftestPackageScript = packageJson.scripts?.["ci:supply-chain:selftest"] ?? "";
  const requiredTerms = [
    "SPDX-2.3",
    "pnpm",
    "list",
    "--recursive",
    "--prod",
    "areaforge-sbom.spdx.json",
    "areaforge-provenance.json",
    "AREAFORGE_WEB_IMAGE_DIGEST",
    "AREAFORGE_MIGRATION_IMAGE_DIGEST",
    "safetyFacts",
    "promptOrRawAiResponseIncluded: false",
    "attachmentContentIncluded: false",
    "release:supply-chain:validate",
    "release:supply-chain:record",
    "ci:supply-chain:validate",
    "ci:supply-chain:record",
    "release supply-chain record validation passed",
    "release supply-chain validator selftest passed",
    "release supply-chain record generator selftest passed",
    "CI supply-chain record validation passed",
    "CI supply-chain record selftest passed",
    "AREAFORGE_AUDIT_PROD_STATUS",
    "AREAFORGE_ACTIONS_PINNING_STATUS",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
  ];
  const combined = `${script}\n${recordScript}\n${ciRecordScript}\n${validator}\n${selftest}\n${recordSelftest}\n${ciValidator}\n${ciSelftest}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  const ok = missing.length === 0 &&
    releaseScript === "tsx scripts/ops/generate-release-supply-chain.ts" &&
    validateScript === "tsx scripts/quality/release-supply-chain-validate.ts" &&
    selftestScript === "tsx scripts/quality/release-supply-chain-validate.selftest.ts" &&
    recordPackageScript === "tsx scripts/ops/generate-release-supply-chain-record.ts" &&
    recordSelftestPackageScript === "tsx scripts/quality/release-supply-chain-record.selftest.ts" &&
    ciRecordPackageScript === "tsx scripts/ops/generate-ci-supply-chain-record.ts" &&
    ciValidatePackageScript === "tsx scripts/quality/ci-supply-chain-record-validate.ts" &&
    ciSelftestPackageScript === "tsx scripts/quality/ci-supply-chain-record.selftest.ts";
  checks.push({
    name: "release supply-chain generator",
    ok,
    detail: ok
      ? "package scripts generate SPDX SBOM/provenance, supply-chain evidence records, and validation selftests without new dependencies"
      : `missing terms ${missing.join(", ") || "none"}; package script=${releaseScript || "missing"}; validate script=${validateScript || "missing"}; selftest=${selftestScript || "missing"}; record script=${recordPackageScript || "missing"}; record selftest=${recordSelftestPackageScript || "missing"}; ci record=${ciRecordPackageScript || "missing"}; ci validate=${ciValidatePackageScript || "missing"}; ci selftest=${ciSelftestPackageScript || "missing"}`,
  });
}

function checkWorkflowTopLevelSyntax(): void {
  const allowedTopLevelKeys = new Set(["name", "on", "permissions", "env", "jobs"]);
  const workflowFiles = [".github/workflows/ci.yml", ".github/workflows/release.yml"];
  const issues = workflowFiles.flatMap((file) => {
    const lines = read(file).split(/\r?\n/);
    return lines.flatMap((line, index) => {
      if (!line.trim() || line.trimStart().startsWith("#") || /^\s/.test(line)) return [];
      const match = /^([A-Za-z_][\w-]*):/.exec(line);
      if (match && allowedTopLevelKeys.has(match[1])) return [];
      return `${file}:${index + 1}:${line.slice(0, 80)}`;
    });
  });
  checks.push({
    name: "GitHub workflow top-level syntax",
    ok: issues.length === 0,
    detail: issues.length === 0
      ? "CI and Release workflow files have no accidental unindented script/heredoc lines"
      : `unexpected top-level lines ${issues.join(", ")}`,
  });
}

function checkExtraSmokeCommand(): void {
  const script = read("scripts/ops/production-readonly-smoke.ts");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const envExample = read("ops/github-release-updater/areaforge-updater.env.example");
  const docs = [
    read("docs/deployment/github-release-updater.md"),
    read("docs/development/production-release-runbook.md"),
    read("ops/github-release-updater/README.md"),
  ].join("\n");
  const requiredScriptTerms = [
    "AREAFORGE_SMOKE_BASE_URL",
    "AREAFORGE_SMOKE_EMAIL",
    "AREAFORGE_SMOKE_PASSWORD_FILE",
    "AREAFORGE_SMOKE_ATTACHMENT_ID",
    "/api/auth/login",
    "/api/dashboard/today",
    "/api/system/update-status",
  ];
  const requiredDocTerms = [
    "smoke:prod-readonly",
    "AREAFORGE_SMOKE_PASSWORD_FILE",
    "AREAFORGE_EXTRA_SMOKE_COMMAND",
  ];
  const missingScriptTerms = requiredScriptTerms.filter((term) => !script.includes(term));
  const missingDocTerms = requiredDocTerms.filter((term) => !docs.includes(term) && !envExample.includes(term));
  const smokeScript = packageJson.scripts?.["smoke:prod-readonly"] ?? "";
  const ok = missingScriptTerms.length === 0 &&
    missingDocTerms.length === 0 &&
    smokeScript === "tsx scripts/ops/production-readonly-smoke.ts";
  checks.push({
    name: "extra smoke command",
    ok,
    detail: ok
      ? "read-only production smoke script, package entry, updater env hints, and docs are present"
      : `missing script terms ${missingScriptTerms.join(", ") || "none"}; missing doc terms ${missingDocTerms.join(", ") || "none"}; smoke script=${smokeScript || "missing"}`,
  });
}

function checkShellSyntax(): void {
  const scripts = [
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/areaforge-ops001-evidence-export.sh",
    "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "ops/update-agent/areaforge-release-readonly-smoke.sh",
  ];
  const failed = scripts.flatMap((script) => {
    const result = spawnSync("bash", ["-n", script], {
      cwd: root,
      encoding: "utf8",
    });
    return result.status === 0 ? [] : [`${script}: ${compactOutput(result.stderr || result.stdout)}`];
  });
  checks.push({
    name: "updater shell syntax",
    ok: failed.length === 0,
    detail: failed.length === 0 ? "bash -n passed" : failed.join("; "),
  });
}

function checkExecutableModes(): void {
  const scripts = [
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/areaforge-ops001-evidence-export.sh",
    "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "ops/update-agent/areaforge-release-readonly-smoke.sh",
  ];
  const nonExecutable = scripts.filter((script) => (statSync(resolve(script)).mode & 0o111) === 0);
  checks.push({
    name: "updater executable modes",
    ok: nonExecutable.length === 0,
    detail: nonExecutable.length === 0
      ? "updater and update-agent shell entrypoints are executable for systemd ExecStart and operator use"
      : `not executable: ${nonExecutable.join(", ")}`,
  });
}

function checkManifestExample(): void {
  const manifest = JSON.parse(read("ops/github-release-updater/manifest.example.json")) as Record<string, unknown>;
  const requiredFields = [
    "schemaVersion",
    "app",
    "version",
    "channel",
    "gitCommit",
    "minimumAppVersion",
    "webImage",
    "webImageDigest",
    "migrationImage",
    "migrationImageDigest",
    "requiresMigration",
    "composeAsset",
    "sha256SumsAsset",
    "signatureAsset",
    "sbomAsset",
    "provenanceAsset",
    "autoApply",
    "smoke",
  ];
  const missing = requiredFields.filter((field) => manifest[field] === undefined);
  const webImage = String(manifest.webImage ?? "");
  const webDigest = String(manifest.webImageDigest ?? "");
  const migrationDigest = String(manifest.migrationImageDigest ?? "");
  const ok = missing.length === 0 &&
    manifest.app === "AreaForge" &&
    manifest.schemaVersion === 1 &&
    !webImage.endsWith(":latest") &&
    /@sha256:[a-f0-9]{64}$/i.test(webDigest) &&
    /@sha256:[a-f0-9]{64}$/i.test(migrationDigest);
  checks.push({
    name: "release manifest example",
    ok,
    detail: ok
      ? "manifest documents version, channel, immutable image digests, migration image, checksums, signature, SBOM/provenance assets, and auto-apply policy"
      : `missing ${missing.join(", ") || "none"}; webDigest=${webDigest}; migrationDigest=${migrationDigest}`,
  });
}

function checkUpdaterBoundaries(): void {
  const updater = read("ops/github-release-updater/areaforge-updater.sh");
  const requiredTerms = [
    "AREAFORGE_GITHUB_REPO",
    "/latest",
    "AREAFORGE_RELEASE_MANIFEST_ASSET",
    "SHA256SUMS",
    "verify_signature",
    "SBOM_ASSET",
    "PROVENANCE_ASSET",
    "validate_asset_name",
    "verify_sha256_asset \"$SUMS_PATH\" \"$SBOM_ASSET\"",
    "verify_sha256_asset \"$SUMS_PATH\" \"$PROVENANCE_ASSET\"",
    "unsupported manifest schemaVersion",
    "minimumAppVersion",
    "cosign verify-blob",
    "--bundle",
    "gpg --verify",
    "flock -n",
    "AREAFORGE_AUTO_APPLY",
    "auto_apply_allowed",
    "pg_dump",
    "AREAFORGE_UPLOADS_VOLUME",
    "tar -czf",
    "run_migration_if_needed",
    "DATABASE_URL=<redacted>",
    "env_set AREAFORGE_IMAGE",
    "env_set APP_VERSION",
    "run_smoke",
    "rollback_application",
    "sbomSha256",
    "provenanceSha256",
    "write_record",
  ];
  const forbiddenTerms = [
    "AUTH_SESSION_SECRET=",
    "AI_API_KEY=",
  ];
  const missing = requiredTerms.filter((term) => !updater.includes(term));
  const forbidden = forbiddenTerms.filter((term) => updater.includes(term));
  checks.push({
    name: "updater safety boundaries",
    ok: missing.length === 0 && forbidden.length === 0,
    detail: missing.length === 0 && forbidden.length === 0
      ? "updater verifies release assets, locks, backs up, migrates via one-off job, smokes, rolls back app image, and redacts database URL"
      : `missing ${missing.join(", ") || "none"}; forbidden ${forbidden.join(", ") || "none"}`,
  });
}

function checkUpdateAgentRequestBoundary(): void {
  const updater = read("ops/github-release-updater/areaforge-updater.sh");
  const agent = read("ops/update-agent/areaforge-update-agent.sh");
  const agentContract = read("ops/update-agent/lib/update-request-v2.sh");
  const agentState = read("ops/update-agent/lib/update-request-state.sh");
  const docs = read("docs/deployment/github-release-updater.md");
  const webUpdateCenter = read("apps/web/lib/system/update-center.ts");
  const webUpdateRequestRoute = read("apps/web/app/api/system/update-requests/route.ts");
  const webSelftest = read("scripts/quality/update-center-request-v2.selftest.ts");
  const agentSelftest = read("scripts/quality/update-agent-request-v2.selftest.ts");
  const lockSelftest = read("scripts/quality/update-production-state-lock.selftest.ts");
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const requestV2SelftestScript = packageJson.scripts?.["update-center:request-v2:selftest"] ?? "";
  const ops005LocalSelftestScript = packageJson.scripts?.["ops:ops-005:local:selftest"] ?? "";
  const requiredTerms = [
    "schemaVersion",
    "expectedBefore",
    "expectedBeforeHash",
    "semanticHash",
    "requestHash",
    "idempotencyKey",
    "expiresAt",
    "snapshotHash",
    "validate_request_schema",
    "archive_invalid_request",
    "EXPECTED_BEFORE_MISMATCH",
    "LEGACY_MUTATION_UNBOUND",
    "needs_reconciliation",
    "executionAttempted",
    "AREAFORGE_PRODUCTION_STATE_LOCK_FILE",
    "--request-guard",
    "--identity-json",
    "confirmedSnapshotHash",
    "STATUS_SNAPSHOT_CHANGED",
  ];
  const combined = [
    updater,
    agent,
    agentContract,
    agentState,
    docs,
    webUpdateCenter,
    webUpdateRequestRoute,
    webSelftest,
    agentSelftest,
    lockSelftest,
  ].join("\n");
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  const ok = missing.length === 0 &&
    requestV2SelftestScript === "tsx scripts/quality/update-center-request-v2.selftest.ts" &&
    ops005LocalSelftestScript.includes("update-agent-request-v2.selftest.ts") &&
    ops005LocalSelftestScript.includes("update-production-state-lock.selftest.ts");
  checks.push({
    name: "update-agent request boundary",
    ok,
    detail: ok
      ? "Web and root update paths bind V2 requests to a confirmed snapshot, strict hashes, TTL, idempotency, processing reconciliation, shared production-state lock, and dual compare-and-reject"
      : `missing ${missing.join(", ") || "none"}; request-v2=${requestV2SelftestScript || "missing"}; ops005-local=${ops005LocalSelftestScript || "missing"}`,
  });
}

function checkMigrationDockerfile(): void {
  const dockerfile = read("infra/docker/migration.Dockerfile");
  const requiredTerms = [
    "FROM node:24-alpine",
    "ARG PRISMA_VERSION=7.8.0",
    "ARG DOTENV_VERSION=17.4.2",
    "COPY prisma ./prisma",
    "--mount=type=cache,target=/root/.npm",
    "--fetch-timeout=600000",
    "npm install --no-audit --no-fund",
    "CMD [\"npx\", \"prisma\", \"migrate\", \"deploy\"]",
  ];
  const forbiddenTerms = [
    "apps/web/.next/standalone",
    "server.js",
    "AUTH_SESSION_SECRET",
  ];
  const missing = requiredTerms.filter((term) => !dockerfile.includes(term));
  const forbidden = forbiddenTerms.filter((term) => dockerfile.includes(term));
  checks.push({
    name: "migration image boundary",
    ok: missing.length === 0 && forbidden.length === 0,
    detail: missing.length === 0 && forbidden.length === 0
      ? "migration image contains Prisma migrations and is separate from the web runtime"
      : `missing ${missing.join(", ") || "none"}; forbidden ${forbidden.join(", ") || "none"}`,
  });
}

function checkReleaseWorkflow(): void {
  const workflow = read(".github/workflows/release.yml");
  const requiredTerms = [
    "tags:",
    "v*.*.*",
    "docker/build-push-action",
    "needs: validate",
    "pnpm github-release-updater:preflight",
    "pnpm ops:readiness",
    "pnpm audit:prod",
    "pnpm check",
    "Release supply-chain generator smoke",
    "infra/docker/web.Dockerfile",
    "infra/docker/migration.Dockerfile",
    "areaforge-release-manifest.json",
    "webImageDigest",
    "migrationImageDigest",
    "sbomAsset",
    "provenanceAsset",
    "pnpm release:supply-chain",
    "areaforge-sbom.spdx.json",
    "areaforge-provenance.json",
    "pnpm release:supply-chain:selftest",
    "pnpm ci:supply-chain:selftest",
    "pnpm ops:ops-001:fallback:selftest",
    "pnpm release:evidence:redacted-export:selftest",
    "pnpm release:evidence:redacted-export:record:selftest",
    "pnpm ops:ops-001:fallback:finalize:selftest",
    "sha256sum",
    "COSIGN_PRIVATE_KEY_B64",
    "cosign sign-blob",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "unsigned preview",
    "--yes",
    "--bundle SHA256SUMS.sig",
    "softprops/action-gh-release",
  ];
  const missing = requiredTerms.filter((term) => !workflow.includes(term));
  checks.push({
    name: "GitHub Release workflow",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "workflow validates release gates, builds web and migration images, emits manifest/SBOM/provenance/checksums/signature assets, and publishes a GitHub Release"
      : `missing ${missing.join(", ")}`,
  });
}

function checkCiWorkflow(): void {
  const workflow = read(".github/workflows/ci.yml");
  const requiredTerms = [
    "pull_request:",
    "push:",
    "actions/checkout",
    "pnpm/action-setup",
    "version: 11.7.0",
    "actions/setup-node",
    "node-version: 24",
    "sudo apt-get install -y shellcheck",
    "pnpm install --frozen-lockfile",
    "pnpm audit:prod",
    "pnpm ci:supply-chain:selftest",
    "pnpm shellcheck:updater",
    "pnpm ops:ops-001:fallback:selftest",
    "pnpm release:evidence:redacted-export:selftest",
    "pnpm release:evidence:redacted-export:record:selftest",
    "pnpm ops:ops-001:fallback:finalize:selftest",
    "pnpm github-release-updater:preflight",
    "pnpm governance:preflight",
    "pnpm package-e:preflight",
    "pnpm risk:preflight",
    "pnpm docs:readiness",
    "pnpm docs:completion",
    "pnpm check",
  ];
  const forbiddenTerms = [
    "docker compose up",
    "db:migrate:deploy",
    "gh release",
    "packages: write",
  ];
  const missing = requiredTerms.filter((term) => !workflow.includes(term));
  const forbidden = forbiddenTerms.filter((term) => workflow.includes(term));
  checks.push({
    name: "GitHub CI workflow",
    ok: missing.length === 0 && forbidden.length === 0,
    detail: missing.length === 0 && forbidden.length === 0
      ? "CI runs shellcheck, updater preflight, governance, ops readiness, Package E/risk/docs gates, and pnpm check without deploy privileges"
      : `missing ${missing.join(", ") || "none"}; forbidden ${forbidden.join(", ") || "none"}`,
  });
}

function checkDocs(): void {
  const docs = [
    read("docs/deployment/github-release-updater.md"),
    read("docs/development/github-release-updater-design.md"),
    read("docs/development/production-release-runbook.md"),
    read("docs/security/file-ai-safety.md"),
  ].join("\n");
  const requiredTerms = [
    "GitHub Release",
    "areaforge-release-manifest.json",
    "SHA256SUMS",
    "SHA256SUMS.sig",
    "systemd timer",
    "AREAFORGE_AUTO_APPLY=none",
    "patch",
    "migration image",
    "备份",
    "回滚",
    "不通过网页",
  ];
  const missing = requiredTerms.filter((term) => !docs.includes(term));
  checks.push({
    name: "updater docs",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "deployment and security docs explain release assets, updater policy, backup, migration, smoke, rollback, and no-web-ops boundary"
      : `missing ${missing.join(", ")}`,
  });
}

function checkWebRuntimeBoundary(): void {
  const files = [
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/lib"),
    ...listFiles("apps/web/components"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));
  const forbiddenPatterns = [
    { label: "updater script", pattern: /areaforge-updater/ },
    { label: "GitHub release updater", pattern: /GitHub Release updater/i },
    { label: "docker compose", pattern: /\bdocker\s+compose\b/ },
    { label: "pg_dump", pattern: /\bpg_dump\b/ },
    { label: "prisma migrate deploy", pattern: /\bprisma\s+migrate\s+deploy\b/ },
  ];
  const matches = files.flatMap((file) => {
    const content = read(file);
    return forbiddenPatterns
      .filter((item) => item.pattern.test(content))
      .map((item) => `${file}:${item.label}`);
  });
  checks.push({
    name: "web updater ops boundary",
    ok: matches.length === 0,
    detail: matches.length === 0
      ? "web runtime has no GitHub Release updater command surface"
      : `found forbidden web ops surface ${matches.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
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

main();
