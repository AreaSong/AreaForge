import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-product-experience-review-"));

try {
  const validRecord = path.join(tempDir, "product-experience-review.txt");
  const invalidSecretRecord = path.join(tempDir, "product-experience-secret.txt");
  const invalidViewportRecord = path.join(tempDir, "product-experience-viewport.txt");
  const invalidSafetyRecord = path.join(tempDir, "product-experience-safety.txt");
  const invalidResidualRecord = path.join(tempDir, "product-experience-residual.txt");

  writeFileSync(validRecord, createRecord());
  writeFileSync(invalidSecretRecord, `${createRecord()}\nleaked: AI_API_KEY=sk-testtesttesttesttest\n`);
  writeFileSync(invalidViewportRecord, createRecord().replace("viewports: desktop,mobile", "viewports: desktop"));
  writeFileSync(invalidSafetyRecord, createRecord().replace("realStudyContentIncluded: no", "realStudyContentIncluded: yes"));
  writeFileSync(invalidResidualRecord, createRecord().replace("residualRiskIds: AF-RISK-UX-001", "residualRiskIds: none"));

  expectExit("valid product experience review record passes", [validRecord], 0, "productExperienceReviewEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("missing mobile viewport fails", [invalidViewportRecord], 1);
  expectExit("real study content safety violation fails", [invalidSafetyRecord], 1);
  expectExit("missing UX residual fails", [invalidResidualRecord], 1);

  console.log("product experience review validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
  if (expectedStdout && !result.stdout.includes(expectedStdout)) {
    console.error(`FAIL ${label}: expected stdout to include ${expectedStdout}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function createRecord(): string {
  return [
    "recordId: product-experience-review-20260710",
    "reviewedAt: 2026-07-10T23:20:00+08:00",
    "reviewer: areasong",
    "environment: local",
    "baseUrl: http://127.0.0.1:3102",
    "appVersion: 0.1.5",
    "source: local UX smoke plus browser screenshots",
    "reviewCommand: pnpm smoke:local-ux and playwright desktop/mobile browser review",
    "reviewStatus: pass",
    "reviewResultHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "viewports: desktop,mobile",
    "journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center",
    "screenshotEvidence: desktop=output/product-experience/desktop.png; mobile=output/product-experience/mobile.png",
    "nextActionWithin5s: yes",
    "recommendationsExplainWhy: yes",
    "confirmOnlyBoundariesVisible: yes",
    "recoveryPathVisible: yes",
    "mobileReadable: yes",
    "emptyUnauthorizedErrorStatesChecked: yes",
    "residualRiskIds: AF-RISK-UX-001",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  destructiveActionAttempted: no",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "",
  ].join("\n");
}
