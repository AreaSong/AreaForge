import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOperationalHandoff } from "../ops/operational-handoff";

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
  "scripts/ops/operational-readiness-summary.ts",
  "scripts/ops/operational-evidence-bundle.ts",
  "scripts/ops/support-bundle-preview.ts",
  "scripts/ops/ops001-evidence-preflight.ts",
  "scripts/ops/sc002-supply-chain-preflight.ts",
  "scripts/ops/operational-alert-preview.ts",
  "scripts/ops/residual-review-due.ts",
  "scripts/ops/generate-maintenance-window-record.ts",
  "scripts/quality/enterprise-operability-preflight.ts",
  "scripts/quality/residual-ledger-validate.ts",
  "scripts/quality/operational-handoff.selftest.ts",
  "scripts/quality/maintenance-window-record.selftest.ts",
  "scripts/quality/maintenance-window-record-validate.ts",
  "scripts/quality/maintenance-window-record-validate.selftest.ts",
  "scripts/quality/support-bundle-preview-validate.ts",
  "scripts/quality/support-bundle-preview.selftest.ts",
  "scripts/quality/ops001-evidence-preflight.selftest.ts",
  "scripts/quality/sc002-supply-chain-preflight.selftest.ts",
];

const requiredScripts = [
  "ops:status",
  "ops:status:selftest",
  "ops:handoff",
  "ops:handoff:selftest",
  "ops:readiness:summary",
  "ops:evidence:bundle",
  "ops:support:bundle-preview",
  "ops:support:bundle-preview:validate",
  "ops:support:bundle-preview:selftest",
  "ops:ops-001:preflight",
  "ops:ops-001:preflight:selftest",
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
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-operational-handoff-"));
  try {
    writeFixture(root);
    const handoff = buildOperationalHandoff({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });

    assert(handoff.schemaVersion === 1, "schemaVersion should be 1");
    assert(handoff.mode === "read_only_operational_handoff", "mode should identify handoff");
    assert(handoff.status.controlPlane === "pass", "fixture control plane should pass");
    assert(handoff.status.offlineOverall === "needs_live_evidence", "monitoring gap should require live evidence");
    assert(handoff.status.releaseTrain === "needs_release_evidence", "release train should need release evidence");
    assert(handoff.evidenceFocus.immediate.some((item) => item.residualRiskId === "AF-RISK-OPS-001"), "handoff should prioritize executable residual");
    assert(handoff.evidenceFocus.dueOrSoon.some((item) => item.residualRiskId === "AF-RISK-SC-002"), "handoff should include due release residual");
    assert(handoff.evidenceFocus.releaseRelevantIds.includes("AF-RISK-SC-002"), "handoff should preserve release relevant IDs");
    assert(handoff.claimBoundary.cannotClaim.some((claim) => claim.includes("current production health")), "handoff should forbid production health overclaim");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:support:bundle-preview"), "handoff should include support bundle preview command");
    assert(handoff.nextCommands.handoff.includes("pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>"), "handoff should include support bundle preview validation command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm maintenance:window:record"), "handoff should include maintenance window record generation command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:ops-001:preflight"), "handoff should include OPS-001 evidence preflight command");
    assert(handoff.nextCommands.liveEvidence.includes("pnpm ops:evidence:bundle"), "handoff should include evidence bundle command");
    assert(handoff.nextCommands.release.includes("pnpm sc:sc-002:preflight"), "handoff should include SC-002 supply-chain preflight command");
    assert(handoff.safetyFacts.readOnly === true, "handoff should be read-only");
    assert(handoff.safetyFacts.networkRequested === false, "handoff should not request network");
    assert(handoff.safetyFacts.handoffWritten === false, "handoff should not write files");

    rmSync(path.join(root, "scripts/ops/operational-handoff.ts"));
    const blocked = buildOperationalHandoff({
      root,
      asOf: "2026-07-11",
      generatedAt: "2026-07-11T00:00:00.000Z",
    });
    assert(blocked.status.controlPlane === "fail", "missing handoff script should fail control plane");
    assert(blocked.status.offlineOverall === "blocked", "missing control-plane file should block handoff status");

    console.log("PASS operational handoff selftest");
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
        currentImpact: "production extra smoke needs server configuration",
        executableNow: true,
        closeCondition: "recent read-only smoke record",
        requiredEvidence: "redacted smoke record",
        ownerSkills: ["areaforge-sre-ops", "areaforge-qa-smoke"],
      },
      {
        id: "AF-RISK-SC-002",
        type: "release-follow-up",
        reviewAt: "2026-07-24",
        currentImpact: "next GitHub CI or Release run evidence is missing",
        executableNow: false,
        closeCondition: "next run records actions pinning and audit evidence",
        requiredEvidence: "GitHub Actions run record",
        ownerSkills: ["areaforge-supply-chain", "areaforge-enterprise-governance"],
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
