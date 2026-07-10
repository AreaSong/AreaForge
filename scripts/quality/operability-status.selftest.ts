import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOperabilityStatusProjection } from "../ops/operability-status";

const requiredFiles = [
  "README.md",
  "docs/README.md",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/maintenance-cadence.md",
  "docs/development/operational-readiness.md",
  "docs/development/residual-risk-ledger.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/validation-matrix.md",
  "workflow/README.md",
  ".codex/skills-src/README.md",
  ".codex/skills-src/areaforge-operating-loop/SKILL.md",
  ".codex/skills-src/areaforge-sre-ops/SKILL.md",
  ".codex/skills-src/areaforge-observability/SKILL.md",
  ".codex/skills-src/areaforge-residual-ledger/SKILL.md",
  "scripts/ops/operability-status.ts",
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/ops/operational-evidence-bundle.ts",
  "scripts/ops/operational-alert-preview.ts",
  "scripts/ops/residual-review-due.ts",
  "scripts/quality/enterprise-operability-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
];

const requiredScripts = [
  "ops:status",
  "ops:status:selftest",
  "ops:readiness:summary",
  "ops:evidence:bundle",
  "ops:alert:preview",
  "enterprise:operability:preflight",
  "maintenance:cadence:preflight",
  "residuals:validate",
  "residuals:review-due",
  "release:train:preflight",
];

function main(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-operability-status-"));
  try {
    writeFixture(root);
    const projection = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(projection.schemaVersion === 1, "schemaVersion should be 1");
    assert(projection.status.controlPlane === "pass", "fixture control plane should pass");
    assert(projection.status.overall === "needs_live_evidence", "monitoring gap should require live evidence");
    assert(projection.status.releaseTrain === "needs_release_evidence", "release relevant residual should gate release evidence");
    assert(projection.safetyFacts.readOnly === true, "projection should be read-only");
    assert(projection.safetyFacts.networkRequested === false, "projection should not request network");
    assert(projection.safetyFacts.statusProjectionWritten === false, "projection should not write a status file");
    assert(projection.residuals.countsByType["monitoring-gap"] === 1, "monitoring gap count should be 1");
    assert(projection.residuals.countsByReviewStatus.due_soon === 1, "due soon count should be 1");
    assert(projection.nextActions.some((action) => action.residualRiskId === "AF-RISK-OPS-001"), "next actions should include executable residual");

    rmSync(path.join(root, "docs/development/operational-readiness.md"));
    const blockedProjection = buildOperabilityStatusProjection({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(blockedProjection.status.controlPlane === "fail", "missing required file should fail control plane");
    assert(blockedProjection.status.overall === "blocked", "missing control plane file should block overall status");

    console.log("PASS operability status selftest");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function writeFixture(root: string): void {
  const scripts = Object.fromEntries(requiredScripts.map((name) => [name, `fixture ${name}`]));
  writeJson(root, "package.json", {
    name: "@areasong/areaforge",
    version: "0.1.5",
    scripts,
  });
  for (const file of requiredFiles) {
    writeText(root, file, file.endsWith(".json") ? fixtureLedgerJson() : `fixture ${file}\n`);
  }
}

function fixtureLedgerJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    source: "docs/development/residual-risk-ledger.md",
    items: [
      {
        id: "AF-RISK-OPS-001",
        type: "monitoring-gap",
        reviewAt: "2026-07-17",
        currentImpact: "生产 extra smoke 仍依赖服务器配置",
        executableNow: true,
        closeCondition: "最近一次通过记录",
        requiredEvidence: "redacted smoke record",
        ownerSkills: ["areaforge-sre-ops", "areaforge-qa-smoke"],
      },
      {
        id: "AF-RISK-REL-001",
        type: "accepted-exception",
        reviewAt: "2026-08-10",
        currentImpact: "auto apply remains disabled",
        executableNow: false,
        closeCondition: "explicit user confirmation",
        requiredEvidence: "confirmation record",
        ownerSkills: ["areaforge-release-operator"],
      },
    ],
  }, null, 2);
}

function writeJson(root: string, file: string, value: unknown): void {
  writeText(root, file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root: string, file: string, content: string): void {
  const fullPath = path.join(root, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

main();
