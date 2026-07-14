import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildResidualEvidencePreflight } from "./residual-evidence-preflight";

function main(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-residual-evidence-"));
  try {
    writeFixture(root, {
      requiredEvidence: "docs/development/evidence.txt、pnpm ops:readiness",
      currentImpact: "evidence exists",
      closeCondition: "证据存在不自动关闭 residual",
      evidenceContent: "redacted evidence record\n",
    });
    expectStatus(root, "needs_attention");

    writeFixture(root, {
      requiredEvidence: "docs/development/missing.txt",
      currentImpact: "仍缺维护者人工复核",
      closeCondition: "证据存在不自动关闭 residual",
      evidenceContent: "redacted evidence record\n",
    });
    expectPathStatus(root, "missing");

    writeFixture(root, {
      requiredEvidence: "docs/development/.env",
      currentImpact: "仍缺维护者人工复核",
      closeCondition: "证据存在不自动关闭 residual",
      evidenceContent: "redacted evidence record\n",
    });
    expectPathStatus(root, "unsafe");

    writeFixture(root, {
      requiredEvidence: "docs/development/evidence.txt",
      currentImpact: "has evidence",
      closeCondition: "close when reviewed",
      evidenceContent: "redacted evidence record\n",
    });
    expectStatus(root, "ready_for_human_review");

    writeFixture(root, {
      requiredEvidence: "docs/development/evidence.txt",
      currentImpact: "仍缺维护者人工复核",
      closeCondition: "证据存在不自动关闭 residual",
      evidenceContent: "DATABASE_URL=postgresql://user:pass@localhost:5432/db\n",
    });
    expectStatus(root, "ready_for_human_review");

    writeFixture(root, {
      requiredEvidence: "docs/development/evidence.txt、pnpm ops:missing-script",
      currentImpact: "仍缺维护者人工复核",
      closeCondition: "证据存在不自动关闭 residual",
      evidenceContent: "redacted evidence record\n",
    });
    expectStatus(root, "needs_attention");

    console.log("PASS residual evidence preflight selftest");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function writeFixture(root: string, input: {
  requiredEvidence: string;
  currentImpact: string;
  closeCondition: string;
  evidenceContent: string;
}): void {
  rmSync(path.join(root, "docs"), { force: true, recursive: true });
  mkdirSync(path.join(root, "docs/development"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      "ops:readiness": "tsx scripts/quality/ops-readiness-preflight.ts",
    },
  }, null, 2));
  if (!input.requiredEvidence.includes("missing") && !input.requiredEvidence.includes(".env")) {
    writeFileSync(path.join(root, "docs/development/evidence.txt"), input.evidenceContent);
  }
  writeFileSync(path.join(root, "docs/development/residual-risk-ledger.json"), JSON.stringify({
    schemaVersion: 1,
    source: "docs/development/residual-risk-ledger.md",
    items: [
      {
        id: "AF-RISK-OPS-001",
        type: "monitoring-gap",
        reviewAt: "2026-08-10",
        currentImpact: input.currentImpact,
        executableNow: false,
        closeCondition: input.closeCondition,
        requiredEvidence: input.requiredEvidence,
        ownerSkills: ["areaforge-sre-ops"],
      },
    ],
  }, null, 2));
}

function expectStatus(root: string, status: "ready_for_human_review" | "needs_attention" | "blocked"): void {
  const result = buildResidualEvidencePreflight({
    root,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  if (result.safetyFacts.readOnly !== true || result.safetyFacts.secretValuePrinted !== false) {
    throw new Error("expected residual evidence preflight to expose read-only safetyFacts");
  }
  if (result.status !== status) {
    throw new Error(`expected status ${status}, got ${result.status}`);
  }
}

function expectPathStatus(root: string, status: "missing" | "unsafe" | "not_file" | "empty"): void {
  const result = buildResidualEvidencePreflight({
    root,
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  const paths = result.records.flatMap((record) => [...record.pathsMissing, ...record.pathsUnsafe]);
  if (!paths.some((item) => item.status === status)) {
    throw new Error(`expected path status ${status}, got ${paths.map((item) => item.status).join(", ") || "none"}`);
  }
}

main();
