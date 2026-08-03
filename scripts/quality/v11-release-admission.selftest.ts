import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  evaluateV11ReleaseAdmission,
  exitCodeForV11ReleaseAdmission,
  type V11ReleaseAdmissionDependencies,
} from "./v11-release-admission";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import {
  V11_ACCESSIBILITY_CHECK_IDS,
  V11_ACCESSIBILITY_SCHEMA,
  V11_JOURNEY_IDS,
  V11_JOURNEY_SCHEMA,
  V11_VIEWPORTS,
  type V11EvidenceValidationResult,
} from "./v11-browser-evidence-contract";

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/quality/v11-release-admission.ts");
const tempRoot = mkdtempSync(path.join(tmpdir(), "areaforge-v11-release-admission-"));
let sourceCommit = "";
let currentCommit = "";

const evidencePaths = {
  completionEvidence: "docs/evidence/completion.md",
  productExperienceEvidence: "docs/evidence/product-experience.md",
  accessibilityEvidence: "docs/evidence/accessibility.md",
  compatibilityFloorEvidence: "docs/evidence/compatibility-floor.md",
  compatibilityRuntimeEvidence: "output/v11-compatibility/compatibility-floor-runtime-v1.1.1-fixture.json",
  ops006007ReviewEvidence: "docs/evidence/ops-review.md",
  sc002Evidence: "docs/evidence/sc002.md",
  sc004ReadbackEvidence: "docs/evidence/sc004-readback.json",
  sc004ControlledPrEvidence: "docs/evidence/sc004-controlled-pr.json",
} as const;
const ops006Path = "docs/development/ops-006-production-evidence-v0.1.9-20260721/ops-006-production-evidence-v0.1.9-20260721.txt";
const ops007Path = "docs/development/ops-007-production-protocol-v0.1.9-20260721.txt";
const structuredEvidencePaths = {
  journey: "output/playwright/v11-browser-evidence-fixture/v11-browser-journey-evidence.json",
  accessibility: "output/playwright/v11-browser-evidence-fixture/v11-accessibility-evidence.json",
} as const;

try {
  createFixture();
  const dependencies = passingDependencies();
  const ready = evaluate(dependencies);
  assert.equal(ready.status, "ready_for_signed_release", JSON.stringify(ready));
  assert.equal(exitCodeForV11ReleaseAdmission(ready.status), 0);
  assert(ready.checks.every((check) => check.status === "ready"));
  assert.equal(evaluate(dependencies, {}).status, "ready_for_signed_release", "the v1.1 command must default to v1.1.1");
  assert.equal(evaluate(dependencies, { releaseTag: "v1.2.0" }).status, "invalid", "a tag outside v1.1.x must fail");

  rmSync(path.join(tempRoot, evidencePaths.completionEvidence));
  const missing = evaluate(dependencies);
  assert.equal(missing.status, "not_ready", "missing evidence must fail closed as not_ready");
  assert.equal(exitCodeForV11ReleaseAdmission(missing.status), 1);
  restoreFixtureFiles();

  writeFileSync(path.join(tempRoot, evidencePaths.accessibilityEvidence), "tampered\n");
  assert.equal(evaluate(dependencies).status, "invalid", "evidence hash drift must be invalid");
  assert.equal(exitCodeForV11ReleaseAdmission("invalid"), 2);
  restoreFixtureFiles();

  const completionPath = path.join(tempRoot, evidencePaths.completionEvidence);
  rmSync(completionPath);
  symlinkSync(path.join(tempRoot, evidencePaths.productExperienceEvidence), completionPath);
  assert.equal(evaluate(dependencies).status, "invalid", "symlink evidence must be invalid");
  rmSync(completionPath);
  restoreFixtureFiles();

  writeAdmissionRecord({ completionEvidence: "scripts/quality/fake.selftest.ts" });
  assert.equal(evaluate(dependencies).status, "invalid", "a selftest path must never count as evidence");
  restoreFixtureFiles();

  writeEvidence(evidencePaths.completionEvidence, completionRecord("NOT-READY"));
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "a shape-valid non-PASS completion record must fail");
  restoreFixtureFiles();

  writeEvidence(evidencePaths.completionEvidence, completionRecord("PASS", "needs CI evidence"));
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "PASS with a blocker must fail");
  restoreFixtureFiles();

  rmSync(path.join(tempRoot, structuredEvidencePaths.accessibility));
  assert.equal(evaluate(dependencies).status, "not_ready", "missing nested accessibility evidence must be not_ready");
  restoreFixtureFiles();

  writeJson(structuredEvidencePaths.journey, { schemaVersion: V11_JOURNEY_SCHEMA, tampered: true });
  assert.equal(evaluate(dependencies).status, "invalid", "nested journey evidence hash drift must be invalid");
  restoreFixtureFiles();

  const wrongJourneySchema = evaluate({
    ...dependencies,
    validateBrowserEvidence: (evidencePath, binding) => {
      const result = dependencies.validateBrowserEvidence?.(evidencePath, binding)
        ?? invalidBrowserEvidence("missing fixture validator");
      return evidencePath === structuredEvidencePaths.journey
        ? { ...result, schemaVersion: V11_ACCESSIBILITY_SCHEMA }
        : result;
    },
  });
  assert.equal(wrongJourneySchema.status, "invalid", "journey evidence must use the journey schema");

  const tamperDuringStructuredValidation = evaluate({
    ...dependencies,
    validateBrowserEvidence: (evidencePath, binding) => {
      const result = dependencies.validateBrowserEvidence?.(evidencePath, binding)
        ?? invalidBrowserEvidence("missing fixture validator");
      if (evidencePath === structuredEvidencePaths.accessibility) {
        writeEvidence(evidencePath, `${JSON.stringify({ changed: true })}\n`);
      }
      return result;
    },
  });
  assert.equal(
    tamperDuringStructuredValidation.status,
    "invalid",
    "nested evidence changed during validation must fail",
  );
  restoreFixtureFiles();

  const journeyArtifact = structuredJourneyArtifactPath("desktop-login");
  const tamperNestedArtifactAfterBinding = evaluate({
    ...dependencies,
    evaluateSc002: (options) => {
      writeEvidence(journeyArtifact, "changed after nested artifact binding\n");
      return dependencies.evaluateSc002!(options);
    },
  });
  assert.equal(
    tamperNestedArtifactAfterBinding.status,
    "invalid",
    "a screenshot changed after nested binding must fail the final integrity reread",
  );
  restoreFixtureFiles();

  const badManifest = compatibilityRuntime();
  badManifest.manifests.current.sha256 = "0".repeat(64);
  writeJson(evidencePaths.compatibilityRuntimeEvidence, badManifest);
  writeCompatibilityRecord();
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "an incorrect migration manifest digest must fail");
  restoreFixtureFiles();

  const badCount = compatibilityRuntime();
  badCount.manifests.current.count = 23;
  writeJson(evidencePaths.compatibilityRuntimeEvidence, badCount);
  writeCompatibilityRecord();
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "an incorrect migration manifest count must fail");
  restoreFixtureFiles();

  const wrongCommit = compatibilityRuntime();
  wrongCommit.candidateCommit = "f".repeat(40);
  writeJson(evidencePaths.compatibilityRuntimeEvidence, wrongCommit);
  writeCompatibilityRecord();
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "runtime candidateCommit must match sourceGitCommit");
  restoreFixtureFiles();

  const failedRuntimeCheck = compatibilityRuntime();
  failedRuntimeCheck.seedChecks.legacySubjectWritten = false;
  writeJson(evidencePaths.compatibilityRuntimeEvidence, failedRuntimeCheck);
  writeCompatibilityRecord();
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "a failed seed/probe runtime check must fail");
  restoreFixtureFiles();

  const failedRepeat = compatibilityRuntime();
  failedRepeat.finalValidation.repeatDeployLedgerStable = false;
  writeJson(evidencePaths.compatibilityRuntimeEvidence, failedRepeat);
  writeCompatibilityRecord();
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "a failed repeat-deploy check must fail");
  restoreFixtureFiles();

  writeCompatibilityRecord("output/v11-compatibility/other.json");
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "markdown/runtime path cross-binding mismatch must fail");
  restoreFixtureFiles();

  writeEvidence(evidencePaths.ops006007ReviewEvidence, [
    "OPS-006 / OPS-007 four-gate review does not pass",
    "local implementation confirmed is not established",
    "matching signed patch evidence is absent",
    "independent production apply evidence is absent",
    "human residual review is absent",
    "",
  ].join("\n"));
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "mere or negated gate mentions must not pass");
  restoreFixtureFiles();

  writeOpsReview({ ops006Sha: `sha256:${"0".repeat(64)}` });
  writeAdmissionRecord();
  assert.equal(evaluate(dependencies).status, "invalid", "OPS runtime hash mismatch must fail");
  restoreFixtureFiles();

  const tamperDuringUx = evaluate({
    ...dependencies,
    evaluateProductExperience: () => {
      writeEvidence(evidencePaths.productExperienceEvidence, "changed during evaluator\n");
      return freshUx();
    },
  });
  assert.equal(tamperDuringUx.status, "invalid", "evaluator-time evidence mutation must fail");
  restoreFixtureFiles();

  const tamperDuringCompletion = evaluate({
    ...dependencies,
    evaluateCompletion: () => {
      writeEvidence(evidencePaths.completionEvidence, completionRecord("FAIL"));
      return { status: "ready", detail: "shape validator returned success before mutation" };
    },
  });
  assert.equal(tamperDuringCompletion.status, "invalid", "completion evidence changed after validation must fail");
  restoreFixtureFiles();

  let bindingCalls = 0;
  const finalBindingFailure = evaluate({
    ...dependencies,
    evaluateBinding: () => {
      bindingCalls += 1;
      return bindingCalls === 1 ? bindingResult("evidence_only") : bindingResult("invalid", ["final binding drift"]);
    },
  });
  assert.equal(finalBindingFailure.status, "invalid", "final binding must be re-evaluated");
  assert.equal(bindingCalls, 2);

  const missingRoot = path.join(tempRoot, "missing-root");
  mkdirSync(missingRoot);
  const cliMissing = spawnSync("pnpm", ["exec", "tsx", scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_V11_RELEASE_ADMISSION_ROOT: missingRoot,
      AREAFORGE_WORKFLOW_SHA: currentCommit,
      AREAFORGE_RELEASE_TAG: "",
    },
  });
  assert.equal(cliMissing.status, 1, cliMissing.stderr);
  assert.equal(JSON.parse(cliMissing.stdout).releaseTag, "v1.1.1");
  assert.equal(JSON.parse(cliMissing.stdout).status, "not_ready");

  console.log("PASS v1.1 release admission selftest");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function evaluate(
  dependencies: V11ReleaseAdmissionDependencies,
  options: { releaseTag?: string } = { releaseTag: "v1.1.1" },
) {
  return evaluateV11ReleaseAdmission({
    root: tempRoot,
    currentGitCommit: currentCommit,
    env: {},
    now: new Date("2026-07-27T00:00:00.000Z"),
    dependencies,
    ...options,
  });
}

function passingDependencies(): V11ReleaseAdmissionDependencies {
  return {
    evaluateCompletion: () => ({ status: "ready", detail: "completion shape fixture passed" }),
    evaluateBinding: () => bindingResult("evidence_only"),
    evaluateProductExperience: () => freshUx(),
    evaluateSc002: (options) => {
      assert.equal(options.checkoutBinding.gitCommit, sourceCommit, "SC-002 must bind the source commit");
      return {
        schemaVersion: 1,
        generatedAt: options.now?.toISOString() ?? "2026-07-27T00:00:00.000Z",
        mode: "fixture",
        residualRiskId: "AF-RISK-SC-002",
        relatedResidualRiskIds: [],
        status: "ready_for_sc002_review",
        checkoutBinding: options.checkoutBinding,
        evidence: [],
        requiredPreflight: [],
        nextCommand: "none",
        forbiddenActions: [],
        safetyFacts: {
          readOnly: true,
          networkRequested: false,
          githubApiCalled: false,
          releaseCreated: false,
          tagPushed: false,
          releaseAssetsDownloaded: false,
          serverCommandAttempted: false,
          backupRestoreAttempted: false,
          migrationAttempted: false,
          productionWriteAttempted: false,
          updaterApplyAttempted: false,
          residualLedgerUpdated: false,
          secretValuePrinted: false,
        },
      };
    },
    evaluateSc004: () => ({ status: "ready_for_human_review" }),
    validateBrowserEvidence: (evidencePath, binding) => {
      assert.equal(binding.expectedCommit, sourceCommit, "browser evidence must bind the source commit");
      assert.equal(binding.expectedVersion, "1.1.1", "browser evidence must bind the requested v1.1 patch");
      assert.equal(
        binding.expectedSourceHash,
        computeProductExperienceSourceHash(tempRoot),
        "browser evidence must bind the current source fingerprint",
      );
      if (evidencePath === structuredEvidencePaths.journey) {
        return validBrowserEvidence(V11_JOURNEY_SCHEMA, 18);
      }
      if (evidencePath === structuredEvidencePaths.accessibility) {
        return validBrowserEvidence(V11_ACCESSIBILITY_SCHEMA, 24);
      }
      return invalidBrowserEvidence(`unexpected structured evidence path: ${evidencePath}`);
    },
  };
}

function freshUx() {
  return {
    status: "fresh" as const,
    recordPathLabel: evidencePaths.productExperienceEvidence,
    recordSha256: sha(readFixtureContent(path.join(tempRoot, evidencePaths.productExperienceEvidence))),
    reviewedAt: "2026-07-27T00:00:00.000Z",
    ageSeconds: 0,
    maxAgeSeconds: 100,
    appVersion: "1.1.1",
    expectedVersion: "1.1.1",
    detail: "current UX fixture passed",
    issueFields: [],
    command: "fixture",
  };
}

function bindingResult(status: "evidence_only" | "invalid", issues: string[] = []) {
  return {
    status,
    releaseGitCommit: sourceCommit,
    currentGitCommit: currentCommit,
    worktreeClean: true,
    changedPaths: ["docs/development/v11-release-admission-record.md"],
    issues,
  };
}

function createFixture(): void {
  git(["init", "-q"]);
  git(["config", "user.email", "test@areaforge.invalid"]);
  git(["config", "user.name", "AreaForge selftest"]);
  writeEvidence("apps/source.ts", "export const candidate = true;\n");
  commit("source candidate");
  sourceCommit = git(["rev-parse", "HEAD"]).trim();
  restoreFixtureFiles();
  commit("evidence-only descendant");
  currentCommit = git(["rev-parse", "HEAD"]).trim();
}

function restoreFixtureFiles(): void {
  writeEvidence(evidencePaths.completionEvidence, completionRecord("PASS"));
  writeStructuredBrowserArtifacts();
  writeJson(structuredEvidencePaths.journey, structuredJourneyEvidence());
  writeJson(structuredEvidencePaths.accessibility, structuredAccessibilityEvidence());
  writeEvidence(evidencePaths.productExperienceEvidence, productExperienceRecord());
  writeEvidence(evidencePaths.accessibilityEvidence, accessibilityRecord());
  writeJson(evidencePaths.compatibilityRuntimeEvidence, compatibilityRuntime());
  writeCompatibilityRecord();
  writeEvidence(ops006Path, "recordId: ops-006-production-evidence-v0.1.9-20260721\nstatus: pass\n");
  writeEvidence(ops007Path, "recordId: ops-007-production-protocol-v0.1.9-20260721\nstatus: pass\n");
  writeOpsReview();
  writeEvidence(evidencePaths.sc002Evidence, "SC-002 fixture\n");
  writeJson(evidencePaths.sc004ReadbackEvidence, { fixture: true });
  writeJson(evidencePaths.sc004ControlledPrEvidence, { headSha: sourceCommit });
  writeAdmissionRecord();
}

function writeStructuredBrowserArtifacts(): void {
  for (const id of structuredJourneyIds()) {
    writeEvidence(structuredJourneyArtifactPath(id), `synthetic screenshot fixture ${id}\n`);
  }
  for (const id of V11_ACCESSIBILITY_CHECK_IDS) {
    writeEvidence(structuredAccessibilityArtifactPath(id), `${JSON.stringify({ synthetic: true, id })}\n`);
  }
}

function structuredJourneyEvidence() {
  return {
    schemaVersion: V11_JOURNEY_SCHEMA,
    journeys: structuredJourneyIds().map((id) => {
      const artifactPath = structuredJourneyArtifactPath(id);
      return {
        id,
        screenshot: {
          path: artifactPath,
          sha256: sha(readFixtureContent(path.join(tempRoot, artifactPath))),
        },
      };
    }),
  };
}

function structuredAccessibilityEvidence() {
  return {
    schemaVersion: V11_ACCESSIBILITY_SCHEMA,
    checks: V11_ACCESSIBILITY_CHECK_IDS.map((id) => {
      const artifactPath = structuredAccessibilityArtifactPath(id);
      return {
        id,
        artifact: {
          path: artifactPath,
          sha256: sha(readFixtureContent(path.join(tempRoot, artifactPath))),
        },
      };
    }),
  };
}

function structuredJourneyIds(): string[] {
  return V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journey) => `${viewport}-${journey}`));
}

function structuredJourneyArtifactPath(id: string): string {
  return `output/playwright/v11-browser-evidence-fixture/screenshots/${id}.png`;
}

function structuredAccessibilityArtifactPath(id: string): string {
  return `output/playwright/v11-browser-evidence-fixture/observations/a11y-${id.toLowerCase()}.json`;
}

function productExperienceRecord(): string {
  return [
    "recordId: product-experience-fixture",
    `journeyEvidence: ${structuredEvidencePaths.journey}`,
    `journeyEvidenceHash: ${sha(readFixtureContent(path.join(tempRoot, structuredEvidencePaths.journey)))}`,
    "",
  ].join("\n");
}

function completionRecord(result: string, ciBlocker = "none"): string {
  return [
    "schemaVersion: 2",
    "sourceBaseline:",
    `  sourceHashOrCommit: ${sourceCommit}`,
    "unverified:",
    "  skippedChecks: none",
    "  reason: not-applicable",
    "blockers:",
    "  product: none",
    "  securityPrivacy: none",
    "  dependencySupplyChain: none",
    `  ciRelease: ${ciBlocker}`,
    "  gitCheckpoint: not-applicable",
    `result: ${result}`,
    "",
  ].join("\n");
}

function accessibilityRecord(): string {
  return [
    "schemaVersion: 1",
    "recordId: accessibility-fixture",
    "reviewedAt: 2026-07-27T00:00:00.000Z",
    "appVersion: 1.1.1",
    `gitCommit: ${sourceCommit}`,
    "status: pass",
    "environment: production-mode-local",
    "keyboardNavigation: pass",
    "focusRecovery: pass",
    "screenReaderSemantics: pass",
    "ariaLive: pass",
    "nonColorStatus: pass",
    "zoom200Percent: pass",
    "canvasEquivalentList: pass",
    "structuredEvidence:",
    `  path: ${structuredEvidencePaths.accessibility}`,
    `  sha256: ${sha(readFixtureContent(path.join(tempRoot, structuredEvidencePaths.accessibility)))}`,
    "doesNotProve: signed Release, production apply, residual closure",
    "",
  ].join("\n");
}

function compatibilityRuntime() {
  const candidateFingerprint = fingerprint(sourceCommit);
  const floorFingerprint = fingerprint("c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4");
  const checks = {
    legacySubjectWritten: true,
    secondWorkspaceWritten: true,
    customSubjectsWithNullLegacyCode: 2,
    workspaceCompositeRowsWritten: 6,
    sameWorkspaceCompositeDuplicatesRejected: 3,
  };
  return {
    schemaVersion: "v11-compatibility-floor-runtime-v2",
    expectedDatabaseName: "areaforge_v11compat_fixture",
    postgresServerVersionNum: 160010,
    candidateCommit: sourceCommit,
    legacyCommit: "749692ba719d801f14186a94af97b96350380141",
    floorCommit: "c30fe8f59e9e9a64ed0ee9d2ef115a0ed5214dd4",
    manifests: {
      legacy: { count: 12, sha256: "90b88fe3555ff44696cc0968b42b5b7f7828daa1bb2b58115caf003cd7511368" },
      floor: { count: 15, sha256: "e86f1d7e8f850b76f7b5470c11ccf08cab409ed092ea809d198b74fc8610e57d" },
      current: { count: 33, sha256: "b2d04b442d666be93dea324ae5e8648ca133e767655cd4fd153c8ba3f450432d" },
    },
    fingerprintExcludedPaths: [evidencePaths.compatibilityFloorEvidence],
    candidateFingerprint,
    seedChecks: checks,
    floorPackageVersion: "0.1.9",
    floorFingerprint,
    probeChecks: checks,
    finalValidation: {
      status: "pass",
      databaseName: "areaforge_v11compat_fixture",
      migrationCount: 33,
      candidateFingerprintStable: true,
      repeatDeployLedgerStable: true,
    },
  };
}

function fingerprint(gitHead: string) {
  const value = {
    gitHead,
    worktreeHash: `sha256:${"1".repeat(64)}`,
    changedPaths: [] as string[],
    commands: ["pnpm ops:v11:compatibility-floor:orchestrate"],
    profile: "custom",
  };
  return {
    algorithm: "sha256",
    ...value,
    worktreeState: "clean",
    digest: sha(JSON.stringify(value)),
  };
}

function writeCompatibilityRecord(runtimePath: string = evidencePaths.compatibilityRuntimeEvidence): void {
  const runtimeRaw = readFixtureContent(path.join(tempRoot, evidencePaths.compatibilityRuntimeEvidence));
  const runtime = JSON.parse(runtimeRaw) as ReturnType<typeof compatibilityRuntime>;
  writeEvidence(evidencePaths.compatibilityFloorEvidence, [
    "schemaVersion: 1",
    "status: pass",
    `candidateImplementationCommit: ${sourceCommit}`,
    "compatibilityRuntimeEvidence:",
    `  path: ${runtimePath}`,
    `  sha256: ${sha(runtimeRaw)}`,
    `candidateWorktreeFingerprint: ${runtime.candidateFingerprint.digest}`,
    "legacyMigrationCount: 12",
    "legacyMigrationManifestSha256: sha256:90b88fe3555ff44696cc0968b42b5b7f7828daa1bb2b58115caf003cd7511368",
    "floorMigrationCount: 15",
    "floorMigrationManifestSha256: sha256:e86f1d7e8f850b76f7b5470c11ccf08cab409ed092ea809d198b74fc8610e57d",
    "repositoryMigrationCount: 33",
    "repositoryMigrationManifestSha256: sha256:b2d04b442d666be93dea324ae5e8648ca133e767655cd4fd153c8ba3f450432d",
    "migrationReplayStatus: pass",
    "candidateSeedStatus: pass",
    "floorProductionBuildStatus: pass",
    "floorReadProbeStatus: pass",
    "repeatDeployStatus: pass",
    "cleanupStatus: pass",
    "doesNotProve: signed Release, production apply, residual closure",
    "",
  ].join("\n"));
}

function writeOpsReview(overrides: { ops006Sha?: string; ops007Sha?: string } = {}): void {
  writeEvidence(evidencePaths.ops006007ReviewEvidence, [
    "schemaVersion: 1",
    "status: pass",
    `sourceGitCommit: ${sourceCommit}`,
    "reviewOutcome: ops006_ops007_four_gate_pass",
    "ops006RuntimeEvidence:",
    `  path: ${ops006Path}`,
    `  sha256: ${overrides.ops006Sha ?? sha(readFixtureContent(path.join(tempRoot, ops006Path)))}`,
    "ops007RuntimeEvidence:",
    `  path: ${ops007Path}`,
    `  sha256: ${overrides.ops007Sha ?? sha(readFixtureContent(path.join(tempRoot, ops007Path)))}`,
    "doesNotProve: new production apply, production migration, residual closure, v1.1 runtime behavior",
    "",
  ].join("\n"));
}

function writeAdmissionRecord(overrides: Partial<Record<keyof typeof evidencePaths, string>> = {}): void {
  const lines = [
    "schemaVersion: 1",
    "releaseTag: v1.1.1",
    "releaseVersion: 1.1.1",
    `sourceGitCommit: ${sourceCommit}`,
    "bindingPolicy: source-or-evidence-only",
  ];
  for (const [section, defaultPath] of Object.entries(evidencePaths)) {
    const evidencePath = overrides[section as keyof typeof evidencePaths] ?? defaultPath;
    const content = evidencePath.startsWith("scripts/") ? "not evidence\n" : readFixtureContent(path.join(tempRoot, evidencePath));
    lines.push(`${section}:`, `  path: ${evidencePath}`, `  sha256: ${sha(content)}`);
  }
  writeEvidence("docs/development/v11-release-admission-record.md", `${lines.join("\n")}\n`);
}

function writeJson(relative: string, value: unknown): void {
  writeEvidence(relative, `${JSON.stringify(value, null, 2)}\n`);
}

function readFixtureContent(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function writeEvidence(relative: string, content: string): void {
  const absolute = path.join(tempRoot, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function commit(message: string): void {
  git(["add", "-A"]);
  git(["commit", "-qm", message]);
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: tempRoot, encoding: "utf8" });
}

function sha(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function validBrowserEvidence(
  schemaVersion: typeof V11_JOURNEY_SCHEMA | typeof V11_ACCESSIBILITY_SCHEMA,
  itemCount: number,
): V11EvidenceValidationResult {
  return { valid: true, schemaVersion, itemCount, issues: [] };
}

function invalidBrowserEvidence(message: string): V11EvidenceValidationResult {
  return {
    valid: false,
    schemaVersion: null,
    itemCount: 0,
    issues: [{ field: "recordPath", message }],
  };
}
