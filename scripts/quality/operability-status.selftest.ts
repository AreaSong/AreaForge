import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOperabilityStatusProjection,
  buildOperabilityStatusSummary,
  formatOperabilityStatusSummary,
} from "../ops/operability-status";

const requiredFiles = [
  "README.md",
  "docs/README.md",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/maintenance-cadence.md",
  "docs/development/maintenance-window-record-template.md",
  "docs/development/operational-readiness.md",
  "docs/development/support-bundle-preview.md",
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
  "scripts/ops/operational-handoff.ts",
  "scripts/ops/long-term-operability-live-gate.ts",
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/ops/operational-evidence-bundle.ts",
  "scripts/ops/support-bundle-preview.ts",
  "scripts/ops/ops001-evidence-preflight.ts",
  "scripts/ops/ops004-alert-evidence-preflight.ts",
  "scripts/ops/sc002-supply-chain-preflight.ts",
  "scripts/ops/operational-alert-preview.ts",
  "scripts/ops/residual-review-due.ts",
  "scripts/ops/generate-maintenance-window-record.ts",
  "scripts/quality/enterprise-operability-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
  "scripts/quality/operational-handoff.selftest.ts",
  "scripts/quality/long-term-operability-live-gate.selftest.ts",
  "scripts/quality/maintenance-window-record.selftest.ts",
  "scripts/quality/maintenance-window-record-validate.ts",
  "scripts/quality/maintenance-window-record-validate.selftest.ts",
  "scripts/quality/support-bundle-preview-validate.ts",
  "scripts/quality/support-bundle-preview.selftest.ts",
  "scripts/quality/ops001-evidence-preflight.selftest.ts",
  "scripts/quality/ops004-alert-evidence-preflight.selftest.ts",
  "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
];

const requiredScripts = [
  "ops:status",
  "ops:status:selftest",
  "ops:handoff",
  "ops:handoff:selftest",
  "ops:long-term:gate",
  "ops:long-term:gate:selftest",
  "ops:readiness:summary",
  "ops:evidence:bundle",
  "ops:support:bundle-preview",
  "ops:support:bundle-preview:validate",
  "ops:support:bundle-preview:selftest",
  "ops:ops-001:preflight",
  "ops:ops-001:preflight:selftest",
  "ops:ops-001:fallback:finalize",
  "ops:ops-001:fallback:finalize:selftest",
  "ops:ops-004:preflight",
  "ops:ops-004:preflight:selftest",
  "sc:sc-002:preflight",
  "sc:sc-002:preflight:selftest",
  "ops:alert:preview",
  "enterprise:operability:preflight",
  "maintenance:cadence:preflight",
  "maintenance:window:record",
  "maintenance:window:record:selftest",
  "maintenance:window:validate",
  "maintenance:window:selftest",
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
    assert(/^[a-f0-9]{64}$/.test(projection.sourceSnapshot.controlPlaneSourceHash), "projection should include control-plane source hash");
    assert(projection.doesNotProve.includes("current production health"), "projection should include explicit non-proof boundary");
    assert(projection.safetyFacts.readOnly === true, "projection should be read-only");
    assert(projection.safetyFacts.networkRequested === false, "projection should not request network");
    assert(projection.safetyFacts.statusProjectionWritten === false, "projection should not write a status file");
    assert(projection.residuals.countsByType["monitoring-gap"] === 1, "monitoring gap count should be 1");
    assert(projection.residuals.countsByReviewStatus.due_soon === 1, "due soon count should be 1");
    assert(projection.requiredFiles.present.includes("docs/development/support-bundle-preview.md"), "projection should require support bundle preview docs");
    assert(projection.packageScripts.present.includes("ops:support:bundle-preview"), "projection should require support bundle preview script");
    assert(projection.packageScripts.present.includes("ops:ops-001:preflight"), "projection should require OPS-001 evidence preflight script");
    assert(projection.packageScripts.present.includes("ops:ops-001:fallback:finalize"), "projection should require OPS-001 fallback finalizer script");
    assert(projection.packageScripts.present.includes("ops:ops-004:preflight"), "projection should require OPS-004 alert evidence preflight script");
    assert(projection.packageScripts.present.includes("sc:sc-002:preflight"), "projection should require SC-002 supply-chain preflight script");
    assert(projection.packageScripts.present.includes("ops:long-term:gate"), "projection should require long-term live evidence gate script");
    assert(projection.packageScripts.present.includes("maintenance:window:record"), "projection should require maintenance window record generator");
    assert(projection.packageScripts.present.includes("maintenance:window:validate"), "projection should require maintenance window validator");
    assert(projection.commands.daily.includes("pnpm ops:support:bundle-preview"), "daily commands should include support bundle preview");
    assert(projection.commands.daily.includes("pnpm ops:ops-001:preflight"), "daily commands should include OPS-001 evidence preflight");
    assert(projection.commands.daily.some((command: string) => command.includes("ops:ops-001:fallback:finalize")), "daily commands should include OPS-001 fallback finalizer");
    assert(projection.commands.daily.includes("pnpm ops:ops-004:preflight"), "daily commands should include OPS-004 alert evidence preflight");
    assert(projection.commands.daily.includes("pnpm maintenance:window:record"), "daily commands should include maintenance window record generation");
    assert(projection.commands.weekly.includes("pnpm ops:support:bundle-preview:selftest"), "weekly commands should include support bundle preview selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-001:preflight:selftest"), "weekly commands should include OPS-001 evidence preflight selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-001:fallback:finalize:selftest"), "weekly commands should include OPS-001 fallback finalizer selftest");
    assert(projection.commands.weekly.includes("pnpm ops:ops-004:preflight:selftest"), "weekly commands should include OPS-004 alert evidence preflight selftest");
    assert(projection.commands.weekly.includes("pnpm sc:sc-002:preflight:selftest"), "weekly commands should include SC-002 supply-chain preflight selftest");
    assert(projection.commands.weekly.includes("pnpm maintenance:window:record:selftest"), "weekly commands should include maintenance window record selftest");
    assert(projection.commands.release.includes("pnpm sc:sc-002:preflight"), "release commands should include SC-002 supply-chain preflight");
    assert(projection.commands.release.includes("pnpm ops:long-term:gate"), "release commands should include long-term live evidence gate");
    assert(projection.nextActions.some((action) => action.residualRiskId === "AF-RISK-OPS-001"), "next actions should include executable residual");
    const summary = buildOperabilityStatusSummary(projection);
    const formattedSummary = formatOperabilityStatusSummary(summary);
    assert(summary.title === "AreaForge operability status", "summary should have a stable title");
    assert(summary.offlineOverall === "needs_live_evidence", "summary should preserve overall status");
    assert(summary.currentBlockers.length === 0, "summary should not invent current blockers");
    assert(summary.dueResiduals.some((item) => item.includes("AF-RISK-OPS-001")), "summary should include due residual IDs");
    assert(summary.nextEvidenceCommands.includes("pnpm ops:handoff --summary"), "summary should include human-readable next evidence commands");
    assert(summary.cannotClaim.includes("current production health"), "summary should include non-proof boundary");
    assert(formattedSummary.includes("AreaForge operability status"), "formatted summary should include title");
    assert(formattedSummary.includes("safetyFacts: readOnly=true"), "formatted summary should include safety facts");

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
