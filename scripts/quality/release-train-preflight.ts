import { existsSync, readFileSync } from "node:fs";
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
  checkReleaseTrainDoc();
  checkReleaseWorkflow();
  checkPackageScript();
  checkEntryPoints();
  checkSkillReferences();
  checkValidationMatrix();

  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`release train preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("release train preflight passed: release path is documented, evidence-gated, and safety-bounded.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    "docs/development/release-train.md",
    "docs/development/production-release-runbook.md",
    "docs/development/release-record-template.md",
    "docs/development/release-supply-chain-record-template.md",
    "docs/development/ci-supply-chain-record-template.md",
    "docs/development/operational-readiness.md",
    "docs/development/residual-risk-ledger.md",
    "docs/deployment/github-release-updater.md",
    ".github/workflows/release.yml",
    "ops/github-release-updater/areaforge-updater.sh",
    "ops/update-agent/areaforge-update-agent.sh",
    "ops/update-agent/areaforge-ops001-readonly-fallback.sh",
    "ops/update-agent/areaforge-release-evidence-redacted-export.sh",
    "scripts/ops/generate-release-evidence-record-from-redacted-export.ts",
    "scripts/quality/ops001-readonly-fallback.selftest.ts",
    "scripts/quality/release-evidence-redacted-export-validate.ts",
    "scripts/quality/release-evidence-redacted-export.selftest.ts",
    "scripts/quality/release-evidence-redacted-export-record.selftest.ts",
    "scripts/ops/generate-release-supply-chain-record.ts",
    "scripts/quality/release-supply-chain-validate.ts",
    "scripts/quality/release-supply-chain-record.selftest.ts",
    "scripts/ops/generate-ci-supply-chain-record.ts",
    "scripts/quality/ci-supply-chain-record-validate.ts",
    "scripts/quality/ci-supply-chain-record.selftest.ts",
    "scripts/ops/sc002-supply-chain-preflight.ts",
    "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required release train files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkReleaseTrainDoc(): void {
  const doc = read("docs/development/release-train.md");
  const requiredTerms = [
    "Release Train",
    "不是发布授权",
    "什么时候必须进入 Release Train",
    "GitHub Release",
    "GHCR digest",
    "SBOM",
    "provenance",
    "SHA256SUMS",
    "SHA256SUMS.sig",
    "cosign",
    "AREAFORGE_AUTO_APPLY=none",
    "pnpm release:train:preflight",
    "pnpm docs:readiness",
    "pnpm docs:completion",
    "pnpm risk:preflight",
    "pnpm governance:preflight",
    "pnpm github-release-updater:preflight",
    "pnpm shellcheck:updater",
    "pnpm ops:ops-001:fallback:selftest",
    "pnpm release:evidence:redacted-export:selftest",
    "pnpm release:evidence:redacted-export:record:selftest",
    "pnpm ops:readiness",
    "pnpm ops:long-term:snapshot",
    "pnpm ops:long-term:snapshot:validate",
    "pnpm ops:long-term:snapshot:selftest",
    "schema v3",
    "fresh data-integrity doctor",
    "bindingStatus: current",
    "pnpm skills:validate",
    "pnpm audit:prod",
    "pnpm check",
    "pnpm release:evidence:validate",
    "pnpm release:supply-chain:validate",
    "pnpm ci:supply-chain:validate",
    "pnpm sc:sc-002:preflight",
    "pnpm ops:evidence:bundle",
    "pnpm ops:alert:preview",
    "不可变 digest",
    "不能使用 `latest`",
    "Release 完成不等于生产已更新",
    "AF-RISK-OPS-001",
    "AF-RISK-OPS-002",
    "AF-RISK-REL-001",
    "AF-RISK-SC-001",
    "AF-RISK-SC-002",
    "AF-RISK-OPS-004",
    "不连接 GitHub",
    "不创建 GitHub Release",
    "不写生产",
  ];
  const missing = requiredTerms.filter((term) => !doc.includes(term));
  checks.push({
    name: "release train doc",
    ok: missing.length === 0,
    detail: missing.length === 0
      ? "release train documents scope, gates, assets, records, updater evidence, residuals, and forbidden actions"
      : `missing ${missing.join(", ")}`,
  });
}

function checkReleaseWorkflow(): void {
  const workflow = read(".github/workflows/release.yml");
  const requiredTerms = [
    "validate:",
    "needs: validate",
    "pnpm governance:preflight",
    "pnpm ops:readiness",
    "pnpm github-release-updater:preflight",
    "pnpm shellcheck:updater",
    "pnpm ops:ops-001:fallback:selftest",
    "pnpm release:evidence:redacted-export:selftest",
    "pnpm release:evidence:redacted-export:record:selftest",
    "pnpm audit:prod",
    "pnpm release:supply-chain:selftest",
    "pnpm release:supply-chain:record:selftest",
    "pnpm ci:supply-chain:selftest",
    "pnpm sc:sc-002:preflight:selftest",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "pnpm release:admission:selftest",
    "pnpm release:admission",
    "AREAFORGE_RELEASE_TAG:",
    "AREAFORGE_WORKFLOW_SHA:",
    "AREAFORGE_DEFAULT_BRANCH:",
    "Reject existing immutable release identity",
    "pnpm release:identity:probe:selftest",
    "pnpm release:identity:probe",
    "pnpm release:workflow:policy:selftest",
    "AREAFORGE_RELEASE_REPOSITORY:",
    "AREAFORGE_RELEASE_WEB_IMAGE:",
    "AREAFORGE_RELEASE_MIGRATION_IMAGE:",
    "release channel must be stable or preview",
    "concurrency:",
    "cancel-in-progress: false",
    "github.event.repository.default_branch",
    "areaforge-sbom.spdx.json",
    "areaforge-provenance.json",
    "SHA256SUMS.sig",
  ];
  const missing = requiredTerms.filter((term) => !workflow.includes(term));
  checks.push({
    name: "release workflow train gates",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "release workflow keeps validate, audit, signing, SBOM/provenance, structured admission, immutable replay, concurrency, workspace-version, default-branch, and tag gates" : `missing ${missing.join(", ")}`,
  });
}

function checkPackageScript(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["release:train:preflight"] ?? "";
  const releaseSupplyChainRecordSelftestScript = packageJson.scripts?.["release:supply-chain:record:selftest"] ?? "";
  const redactedExportValidateScript = packageJson.scripts?.["release:evidence:redacted-export:validate"] ?? "";
  const redactedExportRecordScript = packageJson.scripts?.["release:evidence:redacted-export:record"] ?? "";
  const redactedExportSelftestScript = packageJson.scripts?.["release:evidence:redacted-export:selftest"] ?? "";
  const redactedExportRecordSelftestScript = packageJson.scripts?.["release:evidence:redacted-export:record:selftest"] ?? "";
  const sc002PreflightScript = packageJson.scripts?.["sc:sc-002:preflight"] ?? "";
  const sc002PreflightSelftestScript = packageJson.scripts?.["sc:sc-002:preflight:selftest"] ?? "";
  const releaseAdmissionScript = packageJson.scripts?.["release:admission"] ?? "";
  const releaseAdmissionSelftestScript = packageJson.scripts?.["release:admission:selftest"] ?? "";
  const releaseIdentityProbeScript = packageJson.scripts?.["release:identity:probe"] ?? "";
  const releaseIdentityProbeSelftestScript = packageJson.scripts?.["release:identity:probe:selftest"] ?? "";
  const releaseWorkflowPolicyScript = packageJson.scripts?.["release:workflow:policy"] ?? "";
  const releaseWorkflowPolicySelftestScript = packageJson.scripts?.["release:workflow:policy:selftest"] ?? "";
  checks.push({
    name: "release train package script",
    ok: script === "tsx scripts/quality/release-train-preflight.ts" &&
      releaseSupplyChainRecordSelftestScript === "tsx scripts/quality/release-supply-chain-record.selftest.ts" &&
      redactedExportValidateScript === "tsx scripts/quality/release-evidence-redacted-export-validate.ts" &&
      redactedExportRecordScript === "tsx scripts/ops/generate-release-evidence-record-from-redacted-export.ts" &&
      redactedExportSelftestScript === "tsx scripts/quality/release-evidence-redacted-export.selftest.ts" &&
      redactedExportRecordSelftestScript === "tsx scripts/quality/release-evidence-redacted-export-record.selftest.ts" &&
      sc002PreflightScript === "tsx scripts/ops/sc002-supply-chain-preflight.ts" &&
      sc002PreflightSelftestScript === "tsx scripts/quality/sc002-supply-chain-preflight.selftest.ts" &&
      releaseAdmissionScript === "tsx scripts/quality/release-admission.ts" &&
      releaseAdmissionSelftestScript === "tsx scripts/quality/release-admission.selftest.ts" &&
      releaseIdentityProbeScript === "tsx scripts/quality/release-identity-probe.ts" &&
      releaseIdentityProbeSelftestScript === "tsx scripts/quality/release-identity-probe.selftest.ts" &&
      releaseWorkflowPolicyScript === "tsx scripts/quality/release-workflow-policy.ts" &&
      releaseWorkflowPolicySelftestScript === "tsx scripts/quality/release-workflow-policy.selftest.ts",
    detail: `release:train:preflight=${script || "missing"}; release:supply-chain:record:selftest=${releaseSupplyChainRecordSelftestScript || "missing"}; release:evidence:redacted-export:validate=${redactedExportValidateScript || "missing"}; release:evidence:redacted-export:record=${redactedExportRecordScript || "missing"}; release:evidence:redacted-export:selftest=${redactedExportSelftestScript || "missing"}; release:evidence:redacted-export:record:selftest=${redactedExportRecordSelftestScript || "missing"}; sc:sc-002:preflight=${sc002PreflightScript || "missing"}; sc:sc-002:preflight:selftest=${sc002PreflightSelftestScript || "missing"}; release:admission=${releaseAdmissionScript || "missing"}; release:identity:probe=${releaseIdentityProbeScript || "missing"}; release:workflow:policy=${releaseWorkflowPolicyScript || "missing"}`,
  });
}

function checkEntryPoints(): void {
  const rootReadme = read("README.md");
  const docsReadme = read("docs/README.md");
  const workflowReadme = read("workflow/README.md");
  const codexWorkflow = read("docs/development/codex-workflow.md");
  const runbook = read("docs/development/production-release-runbook.md");
  const requiredLinks = [
    [rootReadme, "docs/development/release-train.md", "README.md"],
    [docsReadme, "development/release-train.md", "docs/README.md"],
    [workflowReadme, "docs/development/release-train.md", "workflow/README.md"],
    [codexWorkflow, "docs/development/release-train.md", "docs/development/codex-workflow.md"],
    [runbook, "release-train.md", "docs/development/production-release-runbook.md"],
  ];
  const missing = requiredLinks
    .filter(([content, token]) => !content.includes(token))
    .map(([, token, source]) => `${source}:${token}`);
  checks.push({
    name: "release train entrypoints",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "README, docs index, workflow, codex workflow, and runbook link release train" : `missing ${missing.join(", ")}`,
  });
}

function checkSkillReferences(): void {
  const releaseSkill = read(".codex/skills-src/areaforge-release-operator/SKILL.md");
  const releaseGates = read(".codex/skills-src/areaforge-release-operator/references/release-gates.md");
  const supplyChainSkill = read(".codex/skills-src/areaforge-supply-chain/SKILL.md");
  const skillReadme = read(".codex/skills-src/README.md");
  const requiredTerms = [
    "docs/development/release-train.md",
    "release:train:preflight",
  ];
  const combined = `${releaseSkill}\n${releaseGates}\n${supplyChainSkill}\n${skillReadme}`;
  const missing = requiredTerms.filter((term) => !combined.includes(term));
  checks.push({
    name: "release skill references",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "release and supply-chain skills reference release train" : `missing ${missing.join(", ")}`,
  });
}

function checkValidationMatrix(): void {
  const matrix = read("docs/development/validation-matrix.md");
  const requiredTerms = [
    "docs/development/release-train.md",
    "scripts/quality/release-train-preflight.ts",
    "pnpm release:train:preflight",
    "pnpm github-release-updater:preflight",
    "pnpm ops:ops-001:fallback:selftest",
    "pnpm release:evidence:redacted-export:selftest",
    "pnpm release:evidence:redacted-export:record:selftest",
    "pnpm ops:ops-001:fallback:finalize:selftest",
    "pnpm release:supply-chain:selftest",
    "pnpm ci:supply-chain:selftest",
    "pnpm sc:sc-002:preflight:selftest",
    "pnpm governance:preflight",
    "pnpm ops:readiness",
  ];
  const missing = requiredTerms.filter((term) => !matrix.includes(term));
  checks.push({
    name: "validation matrix release train path",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "validation matrix defines release train checks" : `missing ${missing.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

main();
