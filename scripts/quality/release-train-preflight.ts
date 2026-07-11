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
    "pnpm ops:readiness",
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
    "pnpm audit:prod",
    "pnpm release:supply-chain:selftest",
    "pnpm ci:supply-chain:selftest",
    "stable releases require COSIGN_PRIVATE_KEY_B64 or COSIGN_PRIVATE_KEY",
    "release tag ${tag} does not match package.json version",
    "release tag ${tag} does not point to workflow commit",
    "git rev-list -n 1",
    "areaforge-sbom.spdx.json",
    "areaforge-provenance.json",
    "SHA256SUMS.sig",
  ];
  const missing = requiredTerms.filter((term) => !workflow.includes(term));
  checks.push({
    name: "release workflow train gates",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "release workflow keeps validate, audit, signing, SBOM/provenance, and tag/version gates" : `missing ${missing.join(", ")}`,
  });
}

function checkPackageScript(): void {
  const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
  const script = packageJson.scripts?.["release:train:preflight"] ?? "";
  const sc002PreflightScript = packageJson.scripts?.["sc:sc-002:preflight"] ?? "";
  const sc002PreflightSelftestScript = packageJson.scripts?.["sc:sc-002:preflight:selftest"] ?? "";
  checks.push({
    name: "release train package script",
    ok: script === "tsx scripts/quality/release-train-preflight.ts" &&
      sc002PreflightScript === "tsx scripts/ops/sc002-supply-chain-preflight.ts" &&
      sc002PreflightSelftestScript === "tsx scripts/quality/sc002-supply-chain-preflight.selftest.ts",
    detail: `release:train:preflight=${script || "missing"}; sc:sc-002:preflight=${sc002PreflightScript || "missing"}; sc:sc-002:preflight:selftest=${sc002PreflightSelftestScript || "missing"}`,
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
