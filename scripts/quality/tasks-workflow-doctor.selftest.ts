import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const fixture = mkdtempSync(path.join(tmpdir(), "areaforge-tasks-doctor-"));

try {
  for (const directory of ["tasks/active", "tasks/backlog", "tasks/done", ".codex/skills-src/areaforge-sre-ops", "docs/development"]) {
    mkdirSync(path.join(fixture, directory), { recursive: true });
  }
  writeFileSync(path.join(fixture, ".codex/skills-src/areaforge-sre-ops/SKILL.md"), "# fixture\n");
  writeFileSync(path.join(fixture, "tasks/backlog/0001-legacy.md"), "# legacy history\n");
  writeFileSync(path.join(fixture, "tasks/done/0002-done.md"), task("done", "complete", [], false, []));
  const activeFile = path.join(fixture, "tasks/active/0003-active.md");
  writeFileSync(activeFile, task("blocked", "awaiting-high-risk-confirmation", ["explicit confirmation"], true));
  writeLedger(["tasks/active/0003-active.md"]);

  expectStatus("valid fixture", 0);
  writeFileSync(path.join(fixture, "docs/development/residual-risk-ledger.json"), JSON.stringify({
    schemaVersion: 1,
    source: "docs/development/residual-risk-ledger.md",
    items: [],
  }));
  expectStatus("V1 ledger rejected", 1);
  writeLedger([]);
  expectStatus("task to ledger binding mismatch", 1);
  writeLedger(["tasks/active/0003-active.md", "tasks/done/0002-done.md"]);
  expectStatus("ledger to task binding mismatch", 1);
  writeLedger(["tasks/active/0003-active.md"]);
  writeFileSync(activeFile, task("done", "awaiting-high-risk-confirmation", ["explicit confirmation"], true));
  expectStatus("directory/status mismatch", 1);
  writeFileSync(activeFile, task("blocked", "awaiting-high-risk-confirmation", [], true));
  expectStatus("blocked without blocker", 1);
  writeFileSync(activeFile, task("blocked", "awaiting-high-risk-confirmation", ["explicit confirmation"], true).replace("areaforge-sre-ops", "missing-skill"));
  expectStatus("missing owner skill", 1);
  writeFileSync(activeFile, task("blocked", "awaiting-high-risk-confirmation", ["explicit confirmation"], true).replace(
    "releaseRequired: true\n```",
    "releaseRequired: true\nevidenceClass: migration_preimage_candidate\npreflightContract: OPS-006-PREFLIGHT-CONTRACT-V1\n```",
  ));
  expectStatus("optional evidence metadata", 0);
  for (const evidenceClass of ["protocol_preimage_candidate", "runtime_preimage_candidate"]) {
    writeFileSync(activeFile, task("blocked", "awaiting-high-risk-confirmation", ["explicit confirmation"], true).replace(
      "releaseRequired: true\n```",
      `releaseRequired: true\nevidenceClass: ${evidenceClass}\npreflightContract: OPS-008-PREFLIGHT-CONTRACT-V1\n\`\`\``,
    ));
    expectStatus(`${evidenceClass} metadata`, 0);
  }
  writeFileSync(activeFile, task("blocked", "awaiting-high-risk-confirmation", ["explicit confirmation"], true).replace(
    "releaseRequired: true\n```",
    "releaseRequired: true\nevidenceClass: unsupported\n```",
  ));
  expectStatus("unsupported evidence metadata", 1);

  console.log("tasks workflow doctor selftest passed.");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function task(
  status: string,
  phase: string,
  blockers: string[],
  releaseRequired: boolean,
  residualRiskIds = ["AF-RISK-OPS-008"],
): string {
  const residuals = residualRiskIds.length > 0
    ? `residualRiskIds:\n${residualRiskIds.map((value) => `  - ${value}`).join("\n")}`
    : "residualRiskIds: []";
  return `# Fixture\n\n\`\`\`yaml\nstatus: ${status}\nphase: ${phase}\nblockers:\n${blockers.map((value) => `  - ${value}`).join("\n")}\nrisk: high\nownerSkill: areaforge-sre-ops\nvalidation:\n  - pnpm check\n${residuals}\nreleaseRequired: ${releaseRequired}\n\`\`\`\n`;
}

function writeLedger(taskRefs: string[]): void {
  writeFileSync(path.join(fixture, "docs/development/residual-risk-ledger.json"), JSON.stringify({
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items: [
      {
        id: "AF-RISK-OPS-008",
        type: "current-blocker",
        reviewAt: "2026-08-10",
        currentImpact: "fixture impact",
        executableNow: false,
        closeCondition: "fixture close condition",
        requiredEvidence: "fixture evidence",
        ownerSkills: ["areaforge-sre-ops"],
        taskRefs,
        taskPromotionWaiver: null,
        acceptedException: null,
      },
    ],
  }));
}

function expectStatus(label: string, expected: number): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/tasks-workflow-doctor.ts", fixture], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expected) {
    throw new Error(`FAIL ${label}: expected ${expected}, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}
