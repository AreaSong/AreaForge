import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
  computeProductExperienceSourceHash,
  currentGitCommit,
} from "../../apps/web/lib/system/product-experience-source";
import { createDevelopmentRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-development";
import { getRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity";
import { evaluateProductExperienceEvidence } from "./product-experience-review-validate";

const root = process.cwd();
const developmentRuntimeIdentity = createDevelopmentRuntimeIdentity(root);
mkdirSync(path.join(root, "output"), { recursive: true });
const tempDir = mkdtempSync(path.join(root, "output/.tmp-product-experience-review-"));
const reviewedAt = new Date().toISOString();
const staleReviewedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
const futureReviewedAt = new Date(Date.now() + 301_000).toISOString();
const binding = currentBinding();

try {
  const desktopEvidence = path.join(tempDir, "desktop.png");
  const mobileEvidence = path.join(tempDir, "mobile.png");
  const validRecord = path.join(tempDir, "product-experience-review.txt");
  const invalidSecretRecord = path.join(tempDir, "product-experience-secret.txt");
  const invalidViewportRecord = path.join(tempDir, "product-experience-viewport.txt");
  const invalidSafetyRecord = path.join(tempDir, "product-experience-safety.txt");
  const invalidResidualRecord = path.join(tempDir, "product-experience-residual.txt");
  const invalidCommitRecord = path.join(tempDir, "product-experience-commit.txt");
  const invalidSourceHashRecord = path.join(tempDir, "product-experience-source-hash.txt");
  const invalidReviewHashRecord = path.join(tempDir, "product-experience-review-hash.txt");
  const invalidScreenshotHashRecord = path.join(tempDir, "product-experience-screenshot-hash.txt");
  const invalidFingerprintSchemaRecord = path.join(tempDir, "product-experience-fingerprint-schema.txt");
  const invalidStaleRecord = path.join(tempDir, "product-experience-stale.txt");
  const invalidFutureRecord = path.join(tempDir, "product-experience-future.txt");
  const legacyShapeRecord = path.join(tempDir, "product-experience-legacy-shape.txt");
  const unsafeParentRecord = path.join(tempDir, "product-experience-parent-symlink.txt");
  const runtimeEvidence = path.join(tempDir, "runtime-identity.json");

  writeFileSync(desktopEvidence, Buffer.from("desktop screenshot fixture"));
  writeFileSync(mobileEvidence, Buffer.from("mobile screenshot fixture"));
  writeRuntimeIdentityEvidence(runtimeEvidence, reviewedAt);
  writeFileSync(validRecord, createRecord(desktopEvidence, mobileEvidence, runtimeEvidence));
  const hashes = printRecordHashes(validRecord);
  const valid = createRecord(desktopEvidence, mobileEvidence, runtimeEvidence, hashes);
  writeFileSync(validRecord, valid);
  writeFileSync(invalidSecretRecord, `${valid}\nleaked: AI_API_KEY=sk-testtesttesttesttest\n`);
  writeFileSync(invalidViewportRecord, valid.replace("viewports: desktop,mobile", "viewports: desktop"));
  writeFileSync(invalidSafetyRecord, valid.replace("realStudyContentIncluded: no", "realStudyContentIncluded: yes"));
  writeFileSync(invalidResidualRecord, valid.replace("residualRiskIds: AF-RISK-UX-001", "residualRiskIds: none"));
  writeFileSync(invalidCommitRecord, valid.replace(`gitCommit: ${binding.gitCommit}`, `gitCommit: ${"2".repeat(40)}`));
  writeFileSync(invalidSourceHashRecord, valid.replace(`productExperienceSourceHash: ${binding.sourceHash}`, `productExperienceSourceHash: sha256:${"4".repeat(64)}`));
  writeFileSync(invalidReviewHashRecord, valid.replace(hashes.reviewResultHash, `sha256:${"8".repeat(64)}`));
  writeFileSync(invalidScreenshotHashRecord, valid.replace(hashes.screenshotEvidenceHash, `sha256:${"9".repeat(64)}`));
  writeFileSync(invalidFingerprintSchemaRecord, valid.replace("sourceFingerprintSchema: ux-source-v2", "sourceFingerprintSchema: ux-source-v1"));
  writeFileSync(invalidStaleRecord, valid.replace(`reviewedAt: ${reviewedAt}`, `reviewedAt: ${staleReviewedAt}`));
  writeFileSync(invalidFutureRecord, valid.replace(`reviewedAt: ${reviewedAt}`, `reviewedAt: ${futureReviewedAt}`));
  writeFileSync(legacyShapeRecord, valid
    .replace(/^gitCommit:.*\n/m, "")
    .replace(/^sourceFingerprintSchema:.*\n/m, "")
    .replace(/^productExperienceSourceHash:.*\n/m, "")
    .replace(/^runtimeIdentityEvidence:.*\n/m, "")
    .replace(/^runtimeIdentityEvidenceHash:.*\n/m, "")
    .replace(/^runtimeIdentityHash:.*\n/m, "")
    .replace(/^screenshotEvidenceHash:.*\n/m, ""));
  const actualEvidenceDir = path.join(tempDir, "actual-evidence");
  const linkedEvidenceDir = path.join(tempDir, "linked-evidence");
  mkdirSync(actualEvidenceDir);
  writeFileSync(path.join(actualEvidenceDir, "desktop.png"), Buffer.from("linked desktop fixture"));
  symlinkSync(actualEvidenceDir, linkedEvidenceDir);
  writeFileSync(unsafeParentRecord, createRecord(path.join(linkedEvidenceDir, "desktop.png"), mobileEvidence, runtimeEvidence));

  expectExit("valid product experience review record passes", [validRecord], 0, "productExperienceReviewEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("missing mobile viewport fails", [invalidViewportRecord], 1);
  expectExit("real study content safety violation fails", [invalidSafetyRecord], 1);
  expectExit("missing UX residual fails", [invalidResidualRecord], 1);
  expectExit("stale git commit fails", [invalidCommitRecord], 1);
  expectExit("stale source hash fails", [invalidSourceHashRecord], 1);
  expectExit("stale review result hash fails", [invalidReviewHashRecord], 1);
  expectExit("stale screenshot evidence hash fails", [invalidScreenshotHashRecord], 1);
  expectExit("unknown source fingerprint schema fails", [invalidFingerprintSchemaRecord], 1);
  expectExit("stale review timestamp fails", [invalidStaleRecord], 1);
  expectExit("future review timestamp beyond skew fails", [invalidFutureRecord], 1);
  expectExit("legacy shape requires explicit shape-only", [legacyShapeRecord], 1);
  expectExit("legacy shape passes only as historical structure", [legacyShapeRecord, "--shape-only"], 0, "bindingStatus: shape-only");
  expectExit("current binding can be printed for record creation", ["--print-current-binding"], 0, "productExperienceSourceHash: sha256:");
  expectFailureContains("parent symlink screenshot path fails", [unsafeParentRecord, "--print-record-hashes"], "unsafe evidence path");

  const freshEvaluation = evaluateProductExperienceEvidence({
    root,
    configuredPath: validRecord,
    now: new Date(Date.parse(reviewedAt) + 60_000),
  });
  assert(freshEvaluation.status === "fresh" && freshEvaluation.ageSeconds === 60, "shared evaluator must classify current bound evidence as fresh");
  assert(
    freshEvaluation.command.includes("output/.tmp-product-experience-review-") && !freshEvaluation.command.includes(root),
    "shared evaluator command must use a safe workspace-relative path",
  );

  const wrongExpectedVersion = evaluateProductExperienceEvidence({
    root,
    configuredPath: validRecord,
    now: new Date(Date.parse(reviewedAt) + 60_000),
    expectedVersion: "9.9.9",
  });
  assert(
    wrongExpectedVersion.status === "invalid" && wrongExpectedVersion.issueFields.includes("appVersion"),
    "shared evaluator must enforce an explicit expected version",
  );

  const staleEvaluation = evaluateProductExperienceEvidence({
    root,
    configuredPath: validRecord,
    now: new Date(Date.parse(reviewedAt) + 15 * 24 * 60 * 60 * 1000),
  });
  assert(staleEvaluation.status === "stale" && staleEvaluation.issueFields.includes("reviewedAt"), "shared evaluator must distinguish structurally valid stale evidence");

  const invalidEvaluation = evaluateProductExperienceEvidence({
    root,
    configuredPath: invalidCommitRecord,
    now: new Date(Date.parse(reviewedAt) + 60_000),
  });
  assert(invalidEvaluation.status === "invalid" && invalidEvaluation.issueFields.includes("gitCommit"), "shared evaluator must prioritize current-binding invalidity over freshness");

  const missingEvaluation = evaluateProductExperienceEvidence({
    root,
    configuredPath: path.join(tempDir, "missing-review.txt"),
    now: new Date(reviewedAt),
  });
  assert(missingEvaluation.status === "missing" && missingEvaluation.recordSha256 === null, "shared evaluator must classify absent evidence as missing");

  const externalDir = mkdtempSync(path.join(os.tmpdir(), "areaforge-external-product-experience-review-"));
  const externalRecord = path.join(externalDir, "review.txt");
  writeFileSync(externalRecord, valid);
  try {
    const externalEvaluation = evaluateProductExperienceEvidence({ root, configuredPath: externalRecord, now: new Date(reviewedAt) });
    assert(
      externalEvaluation.status === "invalid" && externalEvaluation.recordSha256 === null && externalEvaluation.issueFields.includes("recordPath"),
      "shared evaluator must reject workspace-external records without reading or hashing them",
    );
  } finally {
    rmSync(externalDir, { force: true, recursive: true });
  }

  console.log("product experience review validator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectExit(label: string, args: string[], expectedStatus: number, expectedStdout?: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: testEnvironment(),
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

function expectFailureContains(label: string, args: string[], expectedStderr: string): void {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: testEnvironment(),
  });
  if (result.status !== 1 || !result.stderr.includes(expectedStderr)) {
    throw new Error(`${label}: ${result.stdout}\n${result.stderr}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function printRecordHashes(recordPath: string): RecordHashes {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", recordPath, "--print-record-hashes"], {
    cwd: root,
    encoding: "utf8",
    env: testEnvironment(),
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const runtimeIdentityEvidenceHash = /^runtimeIdentityEvidenceHash:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  const runtimeIdentityHash = /^runtimeIdentityHash:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  const screenshotEvidenceHash = /^screenshotEvidenceHash:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  const reviewResultHash = /^reviewResultHash:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  if (!runtimeIdentityEvidenceHash || !runtimeIdentityHash || !screenshotEvidenceHash || !reviewResultHash) throw new Error(`invalid hash output: ${result.stdout}`);
  return { runtimeIdentityEvidenceHash, runtimeIdentityHash, screenshotEvidenceHash, reviewResultHash };
}

function testEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

function createRecord(
  desktopEvidence: string,
  mobileEvidence: string,
  runtimeEvidence: string,
  hashes: RecordHashes = placeholderHashes(),
): string {
  return [
    "recordId: product-experience-review-20260710",
    `reviewedAt: ${reviewedAt}`,
    "reviewer: areasong",
    "environment: local",
    "baseUrl: http://127.0.0.1:3102",
    `appVersion: ${binding.appVersion}`,
    `gitCommit: ${binding.gitCommit}`,
    `sourceFingerprintSchema: ${PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA}`,
    `productExperienceSourceHash: ${binding.sourceHash}`,
    `runtimeIdentityEvidence: ${path.relative(root, runtimeEvidence)}`,
    `runtimeIdentityEvidenceHash: ${hashes.runtimeIdentityEvidenceHash}`,
    `runtimeIdentityHash: ${hashes.runtimeIdentityHash}`,
    "source: local UX smoke plus browser screenshots",
    "reviewCommand: pnpm smoke:local-ux and playwright desktop/mobile browser review",
    "reviewStatus: pass",
    `reviewResultHash: ${hashes.reviewResultHash}`,
    "viewports: desktop,mobile",
    "journeys: login,dashboard,timer-closeout,review,notes,syllabus,reports,simulation,update-center",
    `screenshotEvidence: desktop=${path.relative(root, desktopEvidence)}; mobile=${path.relative(root, mobileEvidence)}`,
    `screenshotEvidenceHash: ${hashes.screenshotEvidenceHash}`,
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

type RecordHashes = {
  runtimeIdentityEvidenceHash: string;
  runtimeIdentityHash: string;
  screenshotEvidenceHash: string;
  reviewResultHash: string;
};

function placeholderHashes(): RecordHashes {
  return {
    runtimeIdentityEvidenceHash: `sha256:${"0".repeat(64)}`,
    runtimeIdentityHash: `sha256:${"0".repeat(64)}`,
    screenshotEvidenceHash: `sha256:${"0".repeat(64)}`,
    reviewResultHash: `sha256:${"0".repeat(64)}`,
  };
}

function currentBinding(): { appVersion: string; gitCommit: string; sourceHash: string } {
  const packageJson = JSON.parse(requireText(path.join(root, "package.json"))) as { version?: string };
  return {
    appVersion: packageJson.version ?? "unknown",
    gitCommit: currentGitCommit(root),
    sourceHash: computeProductExperienceSourceHash(root),
  };
}

function requireText(file: string): string {
  return readFileSync(file, "utf8");
}

function writeRuntimeIdentityEvidence(file: string, observedAt: string): void {
  const runtimeIdentity = getRuntimeIdentity(new Date(observedAt), developmentRuntimeIdentity);
  writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    baseUrl: "http://127.0.0.1:3102",
    observedAt,
    responseHash: canonicalSha256({ ok: true, service: "AreaForge", version: runtimeIdentity.appVersion, runtimeIdentity }),
    runtimeIdentity,
    safetyFacts: {
      requestMethod: "GET",
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      secretValueIncluded: false,
    },
  }, null, 2)}\n`);
}
