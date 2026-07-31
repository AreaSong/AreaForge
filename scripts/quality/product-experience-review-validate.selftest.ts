import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import {
  PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  canonicalSha256,
  computeProductExperienceSourceHash,
  currentGitCommit,
} from "./product-experience-source";
import { createStoredRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import { evaluateProductExperienceEvidence } from "./product-experience-review-validate";
import {
  V11_DOES_NOT_PROVE,
  V11_FIXTURE_SCHEMA,
  V11_JOURNEY_CONTRACTS,
  V11_JOURNEY_IDS,
  V11_JOURNEY_SCHEMA,
  V11_VIEWPORT_CONTRACT,
  V11_VIEWPORTS,
  computeFixtureManifestHash,
  computeRuntimeResponseHash,
  type V11Assertion,
  type V11AssertionContract,
  type V11FixtureEvidence,
  type V11JourneyEvidence,
} from "./v11-browser-evidence-contract";

const root = process.cwd();
const binding = currentBinding();
const productionRuntimeIdentity = createStoredRuntimeIdentity({
  appVersion: binding.appVersion,
  gitCommit: binding.gitCommit,
  sourceFingerprintSchema: PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
  productExperienceSourceHash: binding.sourceHash,
  buildId: canonicalSha256({
    domain: "areaforge.runtime-build.v1",
    appVersion: binding.appVersion,
    gitCommit: binding.gitCommit,
    productExperienceSourceHash: binding.sourceHash,
    runtimeMode: "production-build",
  }),
  runtimeMode: "production-build",
});
mkdirSync(path.join(root, "output"), { recursive: true });
const tempDir = mkdtempSync(path.join(root, "output/.tmp-product-experience-review-"));
const reviewedAt = new Date().toISOString();
const staleReviewedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
const futureReviewedAt = new Date(Date.now() + 301_000).toISOString();

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
  const invalidJourneyHashRecord = path.join(tempDir, "product-experience-journey-hash.txt");
  const invalidFingerprintSchemaRecord = path.join(tempDir, "product-experience-fingerprint-schema.txt");
  const invalidStaleRecord = path.join(tempDir, "product-experience-stale.txt");
  const invalidFutureRecord = path.join(tempDir, "product-experience-future.txt");
  const legacyShapeRecord = path.join(tempDir, "product-experience-legacy-shape.txt");
  const unsafeParentRecord = path.join(tempDir, "product-experience-parent-symlink.txt");
  const runtimeEvidence = path.join(tempDir, "runtime-identity.json");
  const journeyEvidence = path.join(tempDir, "v11-browser-journey-evidence.json");
  const journeyScreenshotDir = path.join(tempDir, "screenshots");

  writeFileSync(desktopEvidence, Buffer.from("desktop screenshot fixture"));
  writeFileSync(mobileEvidence, Buffer.from("mobile screenshot fixture"));
  writeRuntimeIdentityEvidence(runtimeEvidence, reviewedAt);
  writeJourneyEvidence(journeyEvidence, journeyScreenshotDir, reviewedAt);
  writeFileSync(
    validRecord,
    createRecord(desktopEvidence, mobileEvidence, runtimeEvidence, journeyEvidence),
  );
  const hashes = printRecordHashes(validRecord);
  const valid = createRecord(
    desktopEvidence,
    mobileEvidence,
    runtimeEvidence,
    journeyEvidence,
    hashes,
  );
  writeFileSync(validRecord, valid);
  writeFileSync(invalidSecretRecord, `${valid}\nleaked: AI_API_KEY=sk-testtesttesttesttest\n`);
  writeFileSync(invalidViewportRecord, valid.replace("viewports: desktop,mobile", "viewports: desktop"));
  writeFileSync(invalidSafetyRecord, valid.replace("realStudyContentIncluded: no", "realStudyContentIncluded: yes"));
  writeFileSync(invalidResidualRecord, valid.replace("residualRiskIds: AF-RISK-UX-001", "residualRiskIds: none"));
  writeFileSync(invalidCommitRecord, valid.replace(`gitCommit: ${binding.gitCommit}`, `gitCommit: ${"2".repeat(40)}`));
  writeFileSync(invalidSourceHashRecord, valid.replace(`productExperienceSourceHash: ${binding.sourceHash}`, `productExperienceSourceHash: sha256:${"4".repeat(64)}`));
  writeFileSync(invalidReviewHashRecord, valid.replace(hashes.reviewResultHash, `sha256:${"8".repeat(64)}`));
  writeFileSync(invalidScreenshotHashRecord, valid.replace(hashes.screenshotEvidenceHash, `sha256:${"9".repeat(64)}`));
  writeFileSync(invalidJourneyHashRecord, valid.replace(hashes.journeyEvidenceHash, `sha256:${"7".repeat(64)}`));
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
    .replace(/^screenshotEvidenceHash:.*\n/m, "")
    .replace(/^journeyEvidence:.*\n/m, "")
    .replace(/^journeyEvidenceHash:.*\n/m, ""));
  const actualEvidenceDir = path.join(tempDir, "actual-evidence");
  const linkedEvidenceDir = path.join(tempDir, "linked-evidence");
  mkdirSync(actualEvidenceDir);
  writeFileSync(path.join(actualEvidenceDir, "desktop.png"), Buffer.from("linked desktop fixture"));
  symlinkSync(actualEvidenceDir, linkedEvidenceDir);
  writeFileSync(
    unsafeParentRecord,
    createRecord(
      path.join(linkedEvidenceDir, "desktop.png"),
      mobileEvidence,
      runtimeEvidence,
      journeyEvidence,
    ),
  );

  expectExit("valid product experience review record passes", [validRecord], 0, "productExperienceReviewEvidenceHash: sha256:");
  expectExit("secret-like values fail", [invalidSecretRecord], 1);
  expectExit("missing mobile viewport fails", [invalidViewportRecord], 1);
  expectExit("real study content safety violation fails", [invalidSafetyRecord], 1);
  expectExit("missing UX residual fails", [invalidResidualRecord], 1);
  expectExit("stale git commit fails", [invalidCommitRecord], 1);
  expectExit("stale source hash fails", [invalidSourceHashRecord], 1);
  expectExit("stale review result hash fails", [invalidReviewHashRecord], 1);
  expectExit("stale screenshot evidence hash fails", [invalidScreenshotHashRecord], 1);
  expectExit("stale journey evidence hash fails", [invalidJourneyHashRecord], 1);
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
  const journeyEvidenceHash = /^journeyEvidenceHash:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  const reviewResultHash = /^reviewResultHash:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  if (
    !runtimeIdentityEvidenceHash
    || !runtimeIdentityHash
    || !screenshotEvidenceHash
    || !journeyEvidenceHash
    || !reviewResultHash
  ) throw new Error(`invalid hash output: ${result.stdout}`);
  return {
    runtimeIdentityEvidenceHash,
    runtimeIdentityHash,
    screenshotEvidenceHash,
    journeyEvidenceHash,
    reviewResultHash,
  };
}

function testEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

function createRecord(
  desktopEvidence: string,
  mobileEvidence: string,
  runtimeEvidence: string,
  journeyEvidence: string,
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
    `journeyEvidence: ${path.relative(root, journeyEvidence)}`,
    `journeyEvidenceHash: ${hashes.journeyEvidenceHash}`,
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
  journeyEvidenceHash: string;
  reviewResultHash: string;
};

function placeholderHashes(): RecordHashes {
  return {
    runtimeIdentityEvidenceHash: `sha256:${"0".repeat(64)}`,
    runtimeIdentityHash: `sha256:${"0".repeat(64)}`,
    screenshotEvidenceHash: `sha256:${"0".repeat(64)}`,
    journeyEvidenceHash: `sha256:${"0".repeat(64)}`,
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
  const runtimeIdentity = productionRuntimeIdentityAt(observedAt);
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

function writeJourneyEvidence(file: string, screenshotDir: string, generatedAt: string): void {
  mkdirSync(screenshotDir, { recursive: true });
  const runtimeIdentity = productionRuntimeIdentityAt(generatedAt);
  const accounts = [
    ...V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journeyId) => ({
      accountRef: canonicalSha256({ domain: "v11-selftest-account", id: `${viewport}-${journeyId}` }),
      purpose: "journey" as const,
      viewport,
      journeyId,
    }))),
    {
      accountRef: canonicalSha256({ domain: "v11-selftest-account", id: "accessibility-suite" }),
      purpose: "accessibility" as const,
      viewport: "suite" as const,
      journeyId: null,
    },
  ];
  const fixtureProjection = {
    schemaVersion: V11_FIXTURE_SCHEMA,
    fixtureSetId: "product-experience-selftest",
    generatedAt,
    contentClassification: "synthetic-only",
    isolation: "one-user-per-viewport-journey",
    journeyAccountCount: 18,
    accessibilityAccountCount: 1,
    accounts,
  } as const satisfies Omit<V11FixtureEvidence, "manifestSha256">;
  const fixtureEvidence: V11FixtureEvidence = {
    ...fixtureProjection,
    manifestSha256: computeFixtureManifestHash(fixtureProjection),
  };
  const baseTime = Date.parse(generatedAt) - 40_000;
  let index = 0;
  const journeys: V11JourneyEvidence["journeys"] = [];

  for (const viewportId of V11_VIEWPORTS) {
    for (const journey of V11_JOURNEY_IDS) {
      const id = `${viewportId}-${journey}`;
      const screenshotFile = path.join(screenshotDir, `${id}.png`);
      const viewportContract = V11_VIEWPORT_CONTRACT[viewportId];
      const screenshotBytes = buildPng(viewportContract.width, viewportContract.height);
      writeFileSync(screenshotFile, screenshotBytes);
      const contract = V11_JOURNEY_CONTRACTS[journey];
      const startedAt = new Date(baseTime + index * 2_000).toISOString();
      const finishedAt = new Date(baseTime + index * 2_000 + 1_000).toISOString();
      const viewport = {
        id: viewportId,
        ...V11_VIEWPORT_CONTRACT[viewportId],
      };
      journeys.push({
        id,
        journey,
        viewport,
        accountRef: accounts[index]!.accountRef,
        startPath: materializeRoute(contract.startPath),
        terminalPath: materializeRoute(contract.terminalPath),
        mutation: {
          initiatedBy: "page-ui",
          uiOriginatedMutation: true,
          method: contract.mutation.method,
          path: materializeRoute(contract.mutation.path),
          status: contract.mutation.status,
          requestCount: 1,
        },
        oracle: {
          method: "GET",
          path: contract.oraclePath,
          before: {
            status: contract.beforeStatus,
            responseSha256: canonicalSha256({ domain: "v11-selftest-oracle-before", id }),
            assertions: passingAssertions(contract.beforeAssertions),
          },
          after: {
            status: contract.afterStatus,
            responseSha256: canonicalSha256({ domain: "v11-selftest-oracle-after", id }),
            assertions: passingAssertions(contract.afterAssertions),
          },
        },
        terminalAssertions: passingAssertions(contract.terminalAssertions),
        screenshot: {
          path: path.relative(root, screenshotFile),
          sha256: rawSha256(screenshotBytes),
          width: viewport.width,
          height: viewport.height,
          syntheticContent: true,
        },
        telemetry: {
          consoleErrors: [],
          pageErrors: [],
          requestFailures: [],
          httpFailures: [],
          unexplainedFailureCount: 0,
        },
        startedAt,
        finishedAt,
        durationMs: 1_000,
        result: "pass",
      });
      index += 1;
    }
  }

  const evidence: V11JourneyEvidence = {
    schemaVersion: V11_JOURNEY_SCHEMA,
    generatedAt,
    environment: {
      kind: "local-production-mode",
      baseUrl: "http://127.0.0.1:3102",
      browserName: "chrome",
      browserVersion: "selftest-chrome-1",
      playwrightVersion: "selftest-1",
    },
    runtimeIdentityEvidence: {
      request: { method: "GET", path: "/api/health", status: 200 },
      runtimeIdentity,
      responseSha256: computeRuntimeResponseHash(runtimeIdentity),
    },
    fixtureEvidence,
    summary: {
      total: 18,
      passed: 18,
      failed: 0,
      skipped: 0,
      desktop: 9,
      mobile: 9,
      uiOriginatedMutations: 18,
      getOnlyOracles: 18,
      unexplainedFailureCount: 0,
    },
    journeys,
    doesNotProve: [...V11_DOES_NOT_PROVE],
    safetyFacts: {
      localBaseUrl: true,
      localDatabase: true,
      explicitWriteOptIn: true,
      passwordSource: "restricted-file",
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      destructiveActionAttempted: false,
      updaterApplyAttempted: false,
      releaseCreated: false,
      secretValuePrinted: false,
      realStudyContentIncluded: false,
      residualLedgerUpdated: false,
    },
  };
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
}

function passingAssertions(contracts: readonly V11AssertionContract[]): V11Assertion[] {
  return contracts.map((contract) => {
    let expected: V11Assertion["expected"];
    if (contract.expected.kind === "literal") expected = structuredClone(contract.expected.value);
    else if (contract.expected.kind === "integer") expected = contract.expected.min;
    else if (contract.expected.kind === "route") expected = "/selftest";
    else expected = "selftest-token";
    return {
      id: contract.id,
      predicate: contract.predicate,
      expected,
      actual: structuredClone(expected),
      passed: true,
    };
  });
}

function materializeRoute(route: string): string {
  return route
    .replace(":sessionId", "selftest-session")
    .replace(":reportId", "selftest-report")
    .replace(":examId", "selftest-exam");
}

function buildPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  const rows = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function productionRuntimeIdentityAt(
  observedAt: string,
): V11JourneyEvidence["runtimeIdentityEvidence"]["runtimeIdentity"] {
  return {
    ...productionRuntimeIdentity,
    observedAt,
    reasonCode: "NONE",
  };
}

function rawSha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
