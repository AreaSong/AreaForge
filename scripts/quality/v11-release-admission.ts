import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildSc004Preflight } from "../ops/sc004-main-protection-preflight";
import { evaluateSc002Preflight } from "../ops/sc002-supply-chain-preflight";
import { evaluateProductExperienceEvidence } from "./product-experience-review-validate";
import { computeProductExperienceSourceHash } from "./product-experience-source";
import { evaluateReleaseCloseoutBinding } from "./release-closeout-binding";
import { parseStrictIndentedKeyValueRecord, type ValidationIssue } from "./record-validator-common";
import {
  V11_ACCESSIBILITY_SCHEMA,
  V11_ACCESSIBILITY_CHECK_IDS,
  V11_JOURNEY_SCHEMA,
  V11_JOURNEY_IDS,
  V11_VIEWPORTS,
  type V11EvidenceBinding,
  type V11EvidenceSchema,
  type V11EvidenceValidationResult,
} from "./v11-browser-evidence-contract";
import { validateV11BrowserEvidenceFile } from "./v11-browser-evidence-validate";
import {
  currentMigrationManifest,
  floorCommit,
  floorMigrationManifest,
  legacyCommit,
  legacyMigrationManifest,
  migrationManifestDigest,
} from "./v11-compatibility-floor-manifest";

export type V11ReleaseAdmissionStatus = "ready_for_signed_release" | "not_ready" | "invalid";
const SC004_CONTROLLED_REQUIRED_CHECK_FAILURE: string = 1;
type CheckStatus = "ready" | "not_ready" | "invalid";

type EvidenceReference = {
  path: string;
  absolutePath: string;
  sha256: string;
  raw: string;
};

type AdmissionCheck = {
  id: string;
  status: CheckStatus;
  detail: string;
  path?: string;
  sha256?: string;
};

export type V11ReleaseAdmissionResult = {
  schemaVersion: 1;
  mode: "read_only_v11_release_admission";
  status: V11ReleaseAdmissionStatus;
  releaseTag: string;
  releaseVersion: string;
  recordPath: string;
  sourceGitCommit: string | null;
  currentGitCommit: string | null;
  bindingStatus: string | null;
  checks: AdmissionCheck[];
  doesNotProve: string[];
  safetyFacts: Record<string, boolean>;
};

type CompletionEvaluation = { status: "ready" | "invalid"; detail: string };

export type V11ReleaseAdmissionDependencies = {
  evaluateCompletion?: (root: string, recordPath: string) => CompletionEvaluation;
  evaluateProductExperience?: typeof evaluateProductExperienceEvidence;
  evaluateSc002?: typeof evaluateSc002Preflight;
  evaluateSc004?: typeof buildSc004Preflight;
  evaluateBinding?: typeof evaluateReleaseCloseoutBinding;
  validateBrowserEvidence?: typeof validateV11BrowserEvidenceFile;
};

export type V11ReleaseAdmissionOptions = {
  root?: string;
  recordPath?: string;
  releaseTag?: string;
  currentGitCommit?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  dependencies?: V11ReleaseAdmissionDependencies;
};

type AdmissionBase = Omit<V11ReleaseAdmissionResult, "status">;

const defaultReleaseTag = "v1.1.1";
const v11ReleaseTagPattern = /^v1\.1\.(?:0|[1-9]\d*)$/;
const canonicalRecordPath = "docs/development/v11-release-admission-record.md";
const maxEvidenceBytes = 4 * 1024 * 1024;
const evidenceSections = [
  "completionEvidence",
  "productExperienceEvidence",
  "accessibilityEvidence",
  "compatibilityFloorEvidence",
  "compatibilityRuntimeEvidence",
  "ops006007ReviewEvidence",
  "sc002Evidence",
  "sc004ReadbackEvidence",
  "sc004ControlledPrEvidence",
] as const;
const ops006RuntimePath = "docs/development/ops-006-production-evidence-v0.1.9-20260721/ops-006-production-evidence-v0.1.9-20260721.txt";
const ops007RuntimePath = "docs/development/ops-007-production-protocol-v0.1.9-20260721.txt";
const manifestContracts = {
  legacy: { count: legacyMigrationManifest.length, sha256: migrationManifestDigest(legacyMigrationManifest) },
  floor: { count: floorMigrationManifest.length, sha256: migrationManifestDigest(floorMigrationManifest) },
  current: { count: currentMigrationManifest.length, sha256: migrationManifestDigest(currentMigrationManifest) },
} as const;

export function evaluateV11ReleaseAdmission(options: V11ReleaseAdmissionOptions = {}): V11ReleaseAdmissionResult {
  const env = options.env ?? process.env;
  const root = path.resolve(options.root ?? env.AREAFORGE_V11_RELEASE_ADMISSION_ROOT ?? process.cwd());
  const configuredReleaseTag = options.releaseTag ?? env.AREAFORGE_RELEASE_TAG;
  const releaseTag = configuredReleaseTag?.trim() || defaultReleaseTag;
  const releaseVersion = releaseTag.startsWith("v") ? releaseTag.slice(1) : releaseTag;
  const configuredRecordPath = options.recordPath ?? env.AREAFORGE_V11_RELEASE_ADMISSION_RECORD ?? canonicalRecordPath;
  const recordPathLabel = normalizeRelativePath(configuredRecordPath) ?? configuredRecordPath;
  const checks: AdmissionCheck[] = [];
  const base = {
    schemaVersion: 1 as const,
    mode: "read_only_v11_release_admission" as const,
    releaseTag,
    releaseVersion,
    recordPath: recordPathLabel,
    sourceGitCommit: null as string | null,
    currentGitCommit: options.currentGitCommit ?? env.AREAFORGE_WORKFLOW_SHA ?? null,
    bindingStatus: null as string | null,
    checks,
    doesNotProve: [
      "signed Release assets or GitHub Release creation",
      "production backup, migration, apply, smoke, rollback, or health",
      "automatic residual-risk closure",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      releaseCreated: false,
      tagPushed: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      secretValuePrinted: false,
      residualLedgerUpdated: false,
    },
  };

  if (!v11ReleaseTagPattern.test(releaseTag)) {
    checks.push(invalid("release_identity", "release tag must identify the v1.1.x patch series"));
    return finish(base);
  }

  if (recordPathLabel !== canonicalRecordPath) {
    checks.push(invalid("admission_record", `record path must be exactly ${canonicalRecordPath}`));
    return finish(base);
  }

  const admissionRecord = readRepoFile(root, recordPathLabel);
  if (!("reference" in admissionRecord)) {
    checks.push(admissionRecord.status === "missing"
      ? notReady("admission_record", `required admission record is missing: ${canonicalRecordPath}`)
      : invalid("admission_record", admissionRecord.detail));
    return finish(base);
  }

  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(admissionRecord.reference.raw, parseIssues);
  validateAdmissionRecordFields(fields, parseIssues, releaseTag, releaseVersion);
  if (parseIssues.length > 0) {
    checks.push(invalid("admission_record", summarizeIssues(parseIssues)));
    return finish(base);
  }
  checks.push(ready("admission_record", "fixed v1.1 admission record parsed", admissionRecord.reference));

  base.sourceGitCommit = fields.get("sourceGitCommit") ?? null;
  base.currentGitCommit = base.currentGitCommit ?? gitHead(root);
  if (!base.currentGitCommit) {
    checks.push(invalid("source_binding", "current Git commit is unavailable"));
    return finish(base);
  }

  const dependencies = options.dependencies ?? {};
  const binding = evaluateSourceBinding(root, base, dependencies);
  checks.push(binding.check);
  const evidence = collectEvidence(root, fields, checks);

  if (checks.some((check) => check.status === "invalid")) return finish(base);
  if (evidence.size !== evidenceSections.length) return finish(base);

  const sourceGitCommit = base.sourceGitCommit as string;
  const completion = evidence.get("completionEvidence") as EvidenceReference;
  const productExperience = evidence.get("productExperienceEvidence") as EvidenceReference;
  const browserBinding = resolveBrowserEvidenceBinding(root, sourceGitCommit, releaseVersion, checks);
  if (!browserBinding) return finish(base);
  checks.push(evaluateCompletionCheck(root, completion, sourceGitCommit, dependencies));
  checks.push(evaluateProductExperienceCheck(root, productExperience, releaseVersion, options.now, dependencies));
  checks.push(validateStructuredBrowserEvidence({
    root,
    record: productExperience,
    pathField: "journeyEvidence",
    hashField: "journeyEvidenceHash",
    expectedSchema: V11_JOURNEY_SCHEMA,
    checkId: "product_experience_structured_evidence",
    evidenceKey: "productExperienceStructuredEvidence",
    binding: browserBinding,
    evidence,
    dependencies,
  }));
  checks.push(validateAccessibility(
    evidence.get("accessibilityEvidence") as EvidenceReference,
    sourceGitCommit,
    releaseVersion,
  ));
  checks.push(validateStructuredBrowserEvidence({
    root,
    record: evidence.get("accessibilityEvidence") as EvidenceReference,
    pathField: "structuredEvidence.path",
    hashField: "structuredEvidence.sha256",
    expectedSchema: V11_ACCESSIBILITY_SCHEMA,
    checkId: "accessibility_structured_evidence",
    evidenceKey: "accessibilityStructuredEvidence",
    binding: browserBinding,
    evidence,
    dependencies,
  }));
  checks.push(validateCompatibilityFloor(
    evidence.get("compatibilityFloorEvidence") as EvidenceReference,
    evidence.get("compatibilityRuntimeEvidence") as EvidenceReference,
    sourceGitCommit,
  ));
  checks.push(validateOpsReview(
    root,
    evidence.get("ops006007ReviewEvidence") as EvidenceReference,
    sourceGitCommit,
    evidence,
  ));
  checks.push(evaluateSc002Check(root, sourceGitCommit, binding.worktreeClean,
    evidence.get("sc002Evidence") as EvidenceReference, options.now, dependencies));
  checks.push(evaluateSc004Check(root, sourceGitCommit, evidence, env, options.now, dependencies));
  checks.push(...evaluateFinalState(root, base, admissionRecord.reference, evidence, dependencies));

  return finish(base);
}

function evaluateSourceBinding(
  root: string,
  base: AdmissionBase,
  dependencies: V11ReleaseAdmissionDependencies,
): { check: AdmissionCheck; worktreeClean: boolean } {
  try {
    const binding = (dependencies.evaluateBinding ?? evaluateReleaseCloseoutBinding)({
      root,
      releaseGitCommit: base.sourceGitCommit ?? "",
      currentGitCommit: base.currentGitCommit ?? "",
    });
    base.bindingStatus = binding.status;
    const identityMatches = binding.releaseGitCommit === base.sourceGitCommit
      && binding.currentGitCommit === base.currentGitCommit;
    const issueDetail = binding.issues.join("; ")
      || (!identityMatches ? "source/evidence-only binding commit identity mismatch"
        : !binding.worktreeClean ? "source/evidence-only binding requires a clean worktree"
          : "source/evidence-only binding is invalid");
    return {
      check: binding.status === "invalid" || !identityMatches || !binding.worktreeClean
        ? invalid("source_binding", issueDetail)
        : ready("source_binding", `binding status is ${binding.status}`),
      worktreeClean: binding.worktreeClean,
    };
  } catch (error) {
    return { check: invalid("source_binding", safeError(error)), worktreeClean: false };
  }
}

function evaluateCompletionCheck(
  root: string,
  reference: EvidenceReference,
  sourceGitCommit: string,
  dependencies: V11ReleaseAdmissionDependencies,
): AdmissionCheck {
  const semanticIssues = validateCompletionSemantics(reference.raw, sourceGitCommit);
  if (semanticIssues.length > 0) return invalid("completion", semanticIssues.join("; "));
  try {
    const result = (dependencies.evaluateCompletion ?? evaluateCompletionWithCli)(root, reference.path);
    if (result.status !== "ready") return invalid("completion", result.detail);
    const reread = verifyReferenceUnchanged(root, reference);
    return reread
      ? invalid("completion", reread)
      : ready("completion", `${result.detail}; PASS semantics and source binding confirmed`, reference);
  } catch (error) {
    return invalid("completion", safeError(error));
  }
}

function collectEvidence(root: string, fields: Map<string, string>, checks: AdmissionCheck[]): Map<string, EvidenceReference> {
  const evidence = new Map<string, EvidenceReference>();
  for (const section of evidenceSections) {
    const result = readEvidenceReference(root, fields, section);
    if (result.status === "ready") {
      evidence.set(section, result.reference);
      checks.push(ready(`${section}_hash`, "repository evidence hash matches", result.reference));
    } else {
      checks.push(result.status === "missing"
        ? notReady(`${section}_hash`, result.detail)
        : invalid(`${section}_hash`, result.detail));
    }
  }
  return evidence;
}

function evaluateProductExperienceCheck(
  root: string,
  reference: EvidenceReference,
  expectedVersion: string,
  now: Date | undefined,
  dependencies: V11ReleaseAdmissionDependencies,
): AdmissionCheck {
  try {
    const ux = (dependencies.evaluateProductExperience ?? evaluateProductExperienceEvidence)({
      root, configuredPath: reference.path, expectedVersion, now,
    });
    const reread = verifyReferenceUnchanged(root, reference);
    if (reread) return invalid("product_experience", reread);
    if (ux.status === "fresh" && ux.recordSha256 === reference.sha256) return ready("product_experience", ux.detail, reference);
    if (ux.status === "missing" || ux.status === "stale") return notReady("product_experience", ux.detail);
    return invalid("product_experience", ux.recordSha256 !== reference.sha256
      ? "product experience evaluator hash does not match the admission binding"
      : ux.detail);
  } catch (error) {
    return invalid("product_experience", safeError(error));
  }
}

function resolveBrowserEvidenceBinding(
  root: string,
  sourceGitCommit: string,
  expectedVersion: string,
  checks: AdmissionCheck[],
): V11EvidenceBinding | null {
  try {
    const expectedSourceHash = computeProductExperienceSourceHash(root);
    checks.push(ready(
      "browser_evidence_source_binding",
      `structured browser evidence source hash is ${expectedSourceHash}`,
    ));
    return {
      root,
      expectedCommit: sourceGitCommit,
      expectedVersion,
      expectedSourceHash,
    };
  } catch (error) {
    checks.push(invalid("browser_evidence_source_binding", safeError(error)));
    return null;
  }
}

function validateStructuredBrowserEvidence(options: {
  root: string;
  record: EvidenceReference;
  pathField: string;
  hashField: string;
  expectedSchema: V11EvidenceSchema;
  checkId: string;
  evidenceKey: string;
  binding: V11EvidenceBinding;
  evidence: Map<string, EvidenceReference>;
  dependencies: V11ReleaseAdmissionDependencies;
}): AdmissionCheck {
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(options.record.raw, parseIssues);
  requireValue(fields, options.pathField, parseIssues);
  requireValue(fields, options.hashField, parseIssues);
  if (parseIssues.length > 0) return invalid(options.checkId, summarizeIssues(parseIssues));

  const evidencePath = fields.get(options.pathField) ?? "";
  const expectedSha = fields.get(options.hashField) ?? "";
  const pathIssue = validateStructuredEvidencePath(evidencePath);
  if (pathIssue) return invalid(options.checkId, `${options.pathField}: ${pathIssue}`);
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSha)) {
    return invalid(options.checkId, `${options.hashField}: must be sha256:<64 lowercase hex>`);
  }

  const nested = readRepoFile(options.root, evidencePath);
  if (!("reference" in nested)) {
    return nested.status === "missing"
      ? notReady(options.checkId, nested.detail)
      : invalid(options.checkId, nested.detail);
  }
  if (nested.reference.sha256 !== expectedSha) {
    return invalid(options.checkId, `${options.hashField}: must match the current structured evidence bytes`);
  }

  const validator = options.dependencies.validateBrowserEvidence ?? validateV11BrowserEvidenceFile;
  let validated: V11EvidenceValidationResult;
  try {
    validated = validator(nested.reference.path, options.binding);
  } catch (error) {
    return invalid(options.checkId, safeError(error));
  }
  const validationIssue = describeBrowserEvidenceFailure(validated, options.expectedSchema);
  if (validationIssue) return invalid(options.checkId, validationIssue);
  const reread = verifyReferenceUnchanged(options.root, nested.reference);
  if (reread) return invalid(options.checkId, reread);

  const artifacts = collectStructuredBrowserArtifacts(
    options.root,
    nested.reference,
    options.expectedSchema,
  );
  if ("detail" in artifacts) return invalid(options.checkId, artifacts.detail);

  options.evidence.set(options.evidenceKey, nested.reference);
  for (const artifact of artifacts.references) {
    options.evidence.set(`${options.evidenceKey}:${artifact.path}`, artifact);
  }
  return ready(
    options.checkId,
    `${options.expectedSchema} and ${artifacts.references.length} nested artifacts are hash-bound, source-bound, and validator-confirmed`,
    nested.reference,
  );
}

function collectStructuredBrowserArtifacts(
  root: string,
  evidence: EvidenceReference,
  schema: V11EvidenceSchema,
): { references: EvidenceReference[] } | { detail: string } {
  let value: unknown;
  try {
    value = JSON.parse(evidence.raw) as unknown;
  } catch {
    return { detail: "structured browser evidence must contain valid JSON before nested artifact binding" };
  }
  if (!isRecord(value) || value.schemaVersion !== schema) {
    return { detail: `structured browser evidence must use ${schema} before nested artifact binding` };
  }

  const expectedCount = schema === V11_JOURNEY_SCHEMA ? 18 : 24;
  const items = schema === V11_JOURNEY_SCHEMA ? value.journeys : value.checks;
  if (!Array.isArray(items) || items.length !== expectedCount) {
    return { detail: `${schema} must expose exactly ${expectedCount} nested artifact references` };
  }

  const expectedIds = schema === V11_JOURNEY_SCHEMA
    ? V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journey) => `${viewport}-${journey}`))
    : [...V11_ACCESSIBILITY_CHECK_IDS];
  const seenPaths = new Set<string>();
  const references: EvidenceReference[] = [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || item.id !== expectedIds[index]) {
      return { detail: `${schema} nested artifact item ${index} must use canonical id ${expectedIds[index]}` };
    }
    const artifact = schema === V11_JOURNEY_SCHEMA ? item.screenshot : item.artifact;
    if (!isRecord(artifact) || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
      return { detail: `${schema} nested artifact ${String(item.id)} must contain path and sha256` };
    }
    if (seenPaths.has(artifact.path)) {
      return { detail: `${schema} nested artifact path must be unique: ${artifact.path}` };
    }
    seenPaths.add(artifact.path);
    const bound = readBoundEvidence(root, artifact.path, artifact.sha256, `${schema}.${String(item.id)}`);
    if (!("reference" in bound)) return { detail: bound.detail };
    references.push(bound.reference);
  }
  return { references };
}

function validateStructuredEvidencePath(value: string): string | null {
  if (!value.endsWith(".json")) return "must reference a repository JSON evidence file";
  if (value.startsWith("scripts/") || /(?:^|\/)\.?[^/]*selftest(?:\.|$)/i.test(value)) {
    return "must reference evidence, not a script or selftest";
  }
  return null;
}

function describeBrowserEvidenceFailure(
  result: V11EvidenceValidationResult,
  expectedSchema: V11EvidenceSchema,
): string | null {
  if (result.valid && result.schemaVersion === expectedSchema) return null;
  const issues = result.issues.slice(0, 5)
    .map((issue) => `${issue.field}: ${issue.message}`)
    .join("; ");
  if (issues) return issues;
  return `structured evidence schema must be ${expectedSchema}`;
}

function evaluateSc002Check(
  root: string,
  sourceGitCommit: string,
  worktreeClean: boolean,
  reference: EvidenceReference,
  now: Date | undefined,
  dependencies: V11ReleaseAdmissionDependencies,
): AdmissionCheck {
  try {
    const result = (dependencies.evaluateSc002 ?? evaluateSc002Preflight)({
      root,
      env: { AREAFORGE_SC002_CI_RECORD: reference.path },
      checkoutBinding: { gitCommit: sourceGitCommit, worktreeClean },
      now,
    });
    const reread = verifyReferenceUnchanged(root, reference);
    if (reread) return invalid("sc002", reread);
    if (result.status === "ready_for_sc002_review") return ready("sc002", "SC-002 CI evidence is valid and current-bound", reference);
    if (result.status === "needs_evidence") return notReady("sc002", "SC-002 evidence is incomplete");
    return invalid("sc002", `SC-002 evaluator returned ${result.status}`);
  } catch (error) {
    return invalid("sc002", safeError(error));
  }
}

function evaluateSc004Check(
  root: string,
  sourceGitCommit: string,
  evidence: Map<string, EvidenceReference>,
  env: NodeJS.ProcessEnv,
  now: Date | undefined,
  dependencies: V11ReleaseAdmissionDependencies,
): AdmissionCheck {
  const readback = evidence.get("sc004ReadbackEvidence") as EvidenceReference;
  const controlledPr = evidence.get("sc004ControlledPrEvidence") as EvidenceReference;
  try {
    const result = (dependencies.evaluateSc004 ?? buildSc004Preflight)({
      AREAFORGE_SC004_READBACK_RECORD: readback.absolutePath,
      AREAFORGE_SC004_CONTROLLED_PR_RECORD: controlledPr.absolutePath,
      AREAFORGE_SC004_MAX_AGE_SECONDS: env.AREAFORGE_SC004_MAX_AGE_SECONDS,
    }, now?.getTime());
    const readbackReread = verifyReferenceUnchanged(root, readback);
    const controlledPrReread = verifyReferenceUnchanged(root, controlledPr);
    if (readbackReread || controlledPrReread) {
      return invalid("sc004", readbackReread ?? controlledPrReread ?? "SC-004 evidence changed");
    }
    const status = String(result.status ?? "invalid");
    if (status === "ready_for_human_review") {
      return isSc004SourceBound(root, sourceGitCommit, readJsonString(controlledPr.raw, "headSha"))
        ? ready("sc004", "SC-004 readback and controlled PR are fresh and target-bound")
        : invalid("sc004", "SC-004 controlled PR headSha must match sourceGitCommit or its merge-commit PR parent");
    }
    if (status === "needs_remote_readback" || status === "needs_controlled_pr") {
      return notReady("sc004", `SC-004 evaluator returned ${status}`);
    }
    return invalid("sc004", `SC-004 evaluator returned ${status}`);
  } catch (error) {
    return invalid("sc004", safeError(error));
  }
}

export function isSc004SourceBound(root: string, sourceGitCommit: string, controlledPrHeadSha: string | null): boolean {
  if (!controlledPrHeadSha || !/^[a-f0-9]{40}$/.test(controlledPrHeadSha)) return false;
  if (controlledPrHeadSha === sourceGitCommit) return true;
  if (!/^[a-f0-9]{40}$/.test(sourceGitCommit)) return false;

  const result = spawnSync("git", ["rev-list", "--parents", "-n", "1", sourceGitCommit], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return false;
  const [commit, _baseParent, prHeadParent, ...extraParents] = result.stdout.trim().split(/\s+/);
  return commit === sourceGitCommit
    && extraParents.length === 0
    && prHeadParent === controlledPrHeadSha;
}

export function exitCodeForV11ReleaseAdmission(status: V11ReleaseAdmissionStatus): 0 | 1 | 2 {
  if (status === "ready_for_signed_release") return 0;
  return status === "not_ready" ? 1 : 2;
}

function validateAdmissionRecordFields(
  fields: Map<string, string>,
  issues: ValidationIssue[],
  expectedTag: string,
  expectedVersion: string,
): void {
  const exactTopLevel = ["schemaVersion", "releaseTag", "releaseVersion", "sourceGitCommit", "bindingPolicy"];
  for (const field of exactTopLevel) requireValue(fields, field, issues);
  for (const section of evidenceSections) {
    requireValue(fields, `${section}.path`, issues);
    requireValue(fields, `${section}.sha256`, issues);
  }
  if (fields.get("schemaVersion") !== "1") issues.push({ field: "schemaVersion", message: "must be 1" });
  if (fields.get("releaseTag") !== expectedTag) issues.push({ field: "releaseTag", message: `must be ${expectedTag}` });
  if (fields.get("releaseVersion") !== expectedVersion) issues.push({ field: "releaseVersion", message: `must be ${expectedVersion}` });
  if (!/^[a-f0-9]{40}$/.test(fields.get("sourceGitCommit") ?? "")) {
    issues.push({ field: "sourceGitCommit", message: "must be a 40-character lowercase Git commit" });
  }
  if (fields.get("bindingPolicy") !== "source-or-evidence-only") {
    issues.push({ field: "bindingPolicy", message: "must be source-or-evidence-only" });
  }
  const allowed = new Set([...exactTopLevel, ...evidenceSections.flatMap((section) => [section, `${section}.path`, `${section}.sha256`])]);
  for (const field of fields.keys()) {
    if (!allowed.has(field)) issues.push({ field, message: "is not allowed in the admission record" });
  }
}

function readEvidenceReference(
  root: string,
  fields: Map<string, string>,
  section: typeof evidenceSections[number],
): { status: "ready"; reference: EvidenceReference } | { status: "missing" | "invalid"; detail: string } {
  const rawPath = fields.get(`${section}.path`) ?? "";
  const expectedSha = fields.get(`${section}.sha256`) ?? "";
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSha)) {
    return { status: "invalid", detail: `${section}.sha256 must be sha256:<64 lowercase hex>` };
  }
  if (rawPath.startsWith("scripts/") || /(?:^|\/)\.?.*selftest(?:\.|$)/i.test(rawPath)) {
    return { status: "invalid", detail: `${section}.path must reference evidence, not a script or selftest` };
  }
  const read = readRepoFile(root, rawPath);
  if (read.status !== "ready") return read;
  if (read.reference.sha256 !== expectedSha) {
    return { status: "invalid", detail: `${section} content hash does not match the admission record` };
  }
  return read;
}

function readRepoFile(root: string, inputPath: string):
  | { status: "ready"; reference: EvidenceReference }
  | { status: "missing" | "invalid"; detail: string } {
  const relative = normalizeRelativePath(inputPath);
  if (!relative) return { status: "invalid", detail: "evidence path must be a normalized repository-relative path" };
  const absolutePath = path.resolve(root, relative);
  if (!isWithin(root, absolutePath)) return { status: "invalid", detail: "evidence path escapes the repository" };
  if (!existsSync(absolutePath)) return { status: "missing", detail: `evidence file is missing: ${relative}` };
  try {
    rejectSymlinkTraversal(root, absolutePath);
    const before = lstatSync(absolutePath);
    if (!before.isFile() || before.isSymbolicLink()) return { status: "invalid", detail: `evidence must be a regular non-symlink file: ${relative}` };
    const descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        return { status: "invalid", detail: `evidence identity changed during open: ${relative}` };
      }
      if (opened.size > maxEvidenceBytes) return { status: "invalid", detail: `evidence exceeds ${maxEvidenceBytes} bytes: ${relative}` };
      const bytes = Buffer.alloc(opened.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(descriptor, bytes, offset, bytes.length - offset, offset);
        if (count === 0) break;
        offset += count;
      }
      const after = fstatSync(descriptor);
      if (offset !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
        return { status: "invalid", detail: `evidence changed while reading: ${relative}` };
      }
      return {
        status: "ready",
        reference: {
          path: relative,
          absolutePath,
          sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
          raw: bytes.toString("utf8"),
        },
      };
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return { status: "invalid", detail: `evidence file could not be safely read: ${relative}` };
  }
}

function evaluateCompletionWithCli(root: string, recordPath: string): CompletionEvaluation {
  const result = spawnSync("pnpm", [
    "exec", "tsx", "scripts/quality/completion-evidence-validate.ts", recordPath, "--shape-only",
  ], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0 && result.stdout.includes("bindingStatus: unavailable")) {
    return { status: "ready", detail: "completion evidence shape validator passed" };
  }
  return { status: "invalid", detail: sanitizeOutput(result.stderr || result.stdout || "completion evidence validator failed") };
}

function validateCompletionSemantics(raw: string, sourceGitCommit: string): string[] {
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(raw, parseIssues);
  const issues = parseIssues.map((issue) => `${issue.field}: ${issue.message}`);
  if (fields.get("schemaVersion") !== "2") issues.push("schemaVersion must be 2");
  if (fields.get("result")?.toLowerCase() !== "pass") issues.push("result must be PASS");
  if (fields.get("sourceBaseline.sourceHashOrCommit") !== sourceGitCommit) {
    issues.push("sourceBaseline.sourceHashOrCommit must match sourceGitCommit");
  }
  const clearFields = [
    "unverified.skippedChecks",
    "unverified.reason",
    "blockers.product",
    "blockers.securityPrivacy",
    "blockers.dependencySupplyChain",
    "blockers.ciRelease",
    "blockers.gitCheckpoint",
  ];
  for (const field of clearFields) {
    if (!isClearEvidenceValue(fields.get(field))) issues.push(`${field} must be none or not-applicable`);
  }
  return issues.slice(0, 8);
}

function validateAccessibility(
  reference: EvidenceReference,
  sourceGitCommit: string,
  expectedVersion: string,
): AdmissionCheck {
  const issues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(reference.raw, issues);
  const passFields = [
    "keyboardNavigation",
    "focusRecovery",
    "screenReaderSemantics",
    "ariaLive",
    "nonColorStatus",
    "zoom200Percent",
    "canvasEquivalentList",
  ];
  for (const field of ["schemaVersion", "recordId", "reviewedAt", "appVersion", "gitCommit", "status", "environment", "doesNotProve", ...passFields]) {
    requireValue(fields, field, issues);
  }
  if (fields.get("schemaVersion") !== "1") issues.push({ field: "schemaVersion", message: "must be 1" });
  if (fields.get("status") !== "pass") issues.push({ field: "status", message: "must be pass" });
  if (fields.get("appVersion") !== expectedVersion) issues.push({ field: "appVersion", message: `must be ${expectedVersion}` });
  if (fields.get("gitCommit") !== sourceGitCommit) issues.push({ field: "gitCommit", message: "must match sourceGitCommit" });
  if (Number.isNaN(Date.parse(fields.get("reviewedAt") ?? ""))) issues.push({ field: "reviewedAt", message: "must be ISO-8601" });
  if (!new Set(["production-mode-local", "staging"]).has(fields.get("environment") ?? "")) {
    issues.push({ field: "environment", message: "must be production-mode-local or staging" });
  }
  for (const field of passFields) if (fields.get(field) !== "pass") issues.push({ field, message: "must be pass" });
  const boundary = fields.get("doesNotProve")?.toLowerCase() ?? "";
  for (const term of ["signed release", "production apply", "residual closure"]) {
    if (!boundary.includes(term)) issues.push({ field: "doesNotProve", message: `must include ${term}` });
  }
  return issues.length === 0
    ? ready("accessibility", "independent accessibility record covers all required checks", reference)
    : invalid("accessibility", summarizeIssues(issues));
}

function validateCompatibilityFloor(
  reference: EvidenceReference,
  runtimeReference: EvidenceReference,
  sourceGitCommit: string,
): AdmissionCheck {
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(reference.raw, parseIssues);
  const issues = parseIssues.map((issue) => `${issue.field}: ${issue.message}`);
  const expected: Record<string, string> = {
    schemaVersion: "1",
    status: "pass",
    candidateImplementationCommit: sourceGitCommit,
    "compatibilityRuntimeEvidence.path": runtimeReference.path,
    "compatibilityRuntimeEvidence.sha256": runtimeReference.sha256,
    legacyMigrationCount: String(manifestContracts.legacy.count),
    legacyMigrationManifestSha256: `sha256:${manifestContracts.legacy.sha256}`,
    floorMigrationCount: String(manifestContracts.floor.count),
    floorMigrationManifestSha256: `sha256:${manifestContracts.floor.sha256}`,
    repositoryMigrationCount: String(manifestContracts.current.count),
    repositoryMigrationManifestSha256: `sha256:${manifestContracts.current.sha256}`,
    migrationReplayStatus: "pass",
    candidateSeedStatus: "pass",
    floorProductionBuildStatus: "pass",
    floorReadProbeStatus: "pass",
    repeatDeployStatus: "pass",
    cleanupStatus: "pass",
  };
  const allowedFields = new Set([
    ...Object.keys(expected),
    "compatibilityRuntimeEvidence",
    "candidateWorktreeFingerprint",
    "doesNotProve",
  ]);
  for (const field of fields.keys()) {
    if (!allowedFields.has(field)) issues.push(`${field} is not allowed in the compatibility record`);
  }
  for (const [field, value] of Object.entries(expected)) {
    if (fields.get(field) !== value) issues.push(`${field} must be ${value}`);
  }
  const runtime = parseCompatibilityRuntime(runtimeReference.raw, reference.path, sourceGitCommit);
  issues.push(...runtime.issues);
  if (fields.get("candidateWorktreeFingerprint") !== runtime.candidateFingerprintDigest) {
    issues.push("candidateWorktreeFingerprint must match runtime candidateFingerprint.digest");
  }
  const doesNotProve = fields.get("doesNotProve")?.toLowerCase() ?? "";
  for (const term of ["signed release", "production apply", "residual closure"]) {
    if (!doesNotProve.includes(term)) issues.push(`doesNotProve must include ${term}`);
  }
  return issues.length === 0
    ? ready(
      "compatibility_floor",
      `compatibility markdown and runtime JSON satisfy the ${manifestContracts.legacy.count}/${manifestContracts.floor.count}/${manifestContracts.current.count} contract`,
      reference,
    )
    : invalid("compatibility_floor", issues.slice(0, 8).join("; "));
}

function validateOpsReview(
  root: string,
  reference: EvidenceReference,
  sourceGitCommit: string,
  evidence: Map<string, EvidenceReference>,
): AdmissionCheck {
  const parseIssues: ValidationIssue[] = [];
  const fields = parseStrictIndentedKeyValueRecord(reference.raw, parseIssues);
  const issues = parseIssues.map((issue) => `${issue.field}: ${issue.message}`);
  const expected: Record<string, string> = {
    schemaVersion: "1",
    status: "pass",
    sourceGitCommit,
    reviewOutcome: "ops006_ops007_four_gate_pass",
    "ops006RuntimeEvidence.path": ops006RuntimePath,
    "ops007RuntimeEvidence.path": ops007RuntimePath,
  };
  const allowedFields = new Set([
    ...Object.keys(expected),
    "ops006RuntimeEvidence", "ops006RuntimeEvidence.sha256",
    "ops007RuntimeEvidence", "ops007RuntimeEvidence.sha256",
    "doesNotProve",
  ]);
  for (const field of fields.keys()) {
    if (!allowedFields.has(field)) issues.push(`${field} is not allowed in the OPS-006/007 review`);
  }
  for (const [field, value] of Object.entries(expected)) {
    if (fields.get(field) !== value) issues.push(`${field} must be ${value}`);
  }
  for (const [section, expectedPath] of [
    ["ops006RuntimeEvidence", ops006RuntimePath],
    ["ops007RuntimeEvidence", ops007RuntimePath],
  ] as const) {
    const nested = readBoundEvidence(root, expectedPath, fields.get(`${section}.sha256`) ?? "", section);
    if ("reference" in nested) evidence.set(section, nested.reference);
    else issues.push(nested.detail);
  }
  const boundary = fields.get("doesNotProve")?.toLowerCase() ?? "";
  for (const term of ["new production apply", "production migration", "residual closure", "v1.1 runtime behavior"]) {
    if (!boundary.includes(term)) issues.push(`doesNotProve must include ${term}`);
  }
  return issues.length === 0
    ? ready("ops006007_review", "OPS-006/007 structured four-gate review and runtime bindings passed", reference)
    : invalid("ops006007_review", issues.slice(0, 8).join("; "));
}

function parseCompatibilityRuntime(
  raw: string,
  compatibilityRecordPath: string,
  sourceGitCommit: string,
): { issues: string[]; candidateFingerprintDigest: string | null } {
  const issues: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { issues: ["compatibility runtime evidence must be valid JSON"], candidateFingerprintDigest: null };
  }
  const state = requireExactObject(parsed, [
    "schemaVersion", "expectedDatabaseName", "postgresServerVersionNum", "candidateCommit", "legacyCommit",
    "floorCommit", "manifests", "fingerprintExcludedPaths", "candidateFingerprint", "seedChecks",
    "floorPackageVersion", "floorFingerprint", "probeChecks", "finalValidation",
  ], "runtime", issues);
  if (!state) return { issues, candidateFingerprintDigest: null };

  expectJson(state, "schemaVersion", "v11-compatibility-floor-runtime-v2", "runtime", issues);
  expectJson(state, "candidateCommit", sourceGitCommit, "runtime", issues);
  expectJson(state, "legacyCommit", legacyCommit, "runtime", issues);
  expectJson(state, "floorCommit", floorCommit, "runtime", issues);
  expectJson(state, "floorPackageVersion", "0.1.9", "runtime", issues);
  const databaseName = typeof state.expectedDatabaseName === "string" ? state.expectedDatabaseName : "";
  if (!databaseName.includes("v11compat")) issues.push("runtime.expectedDatabaseName must contain v11compat");
  const postgresVersion = state.postgresServerVersionNum;
  if (!Number.isInteger(postgresVersion) || Number(postgresVersion) < 160000 || Number(postgresVersion) >= 170000) {
    issues.push("runtime.postgresServerVersionNum must identify PostgreSQL 16.x");
  }
  if (JSON.stringify(state.fingerprintExcludedPaths) !== JSON.stringify([compatibilityRecordPath])) {
    issues.push("runtime.fingerprintExcludedPaths must contain only the compatibility markdown path");
  }

  const manifests = requireExactObject(state.manifests, ["legacy", "floor", "current"], "runtime.manifests", issues);
  for (const name of ["legacy", "floor", "current"] as const) {
    const manifest = requireExactObject(manifests?.[name], ["count", "sha256"], `runtime.manifests.${name}`, issues);
    if (!manifest) continue;
    expectJson(manifest, "count", manifestContracts[name].count, `runtime.manifests.${name}`, issues);
    expectJson(manifest, "sha256", manifestContracts[name].sha256, `runtime.manifests.${name}`, issues);
  }

  const candidateFingerprint = validateRuntimeFingerprint(
    state.candidateFingerprint, sourceGitCommit, "runtime.candidateFingerprint", issues,
  );
  validateFixtureChecks(state.seedChecks, "runtime.seedChecks", issues);
  const floorFingerprint = validateRuntimeFingerprint(
    state.floorFingerprint, floorCommit, "runtime.floorFingerprint", issues,
  );
  if (floorFingerprint && JSON.stringify(floorFingerprint.changedPaths) !== "[]") {
    issues.push("runtime.floorFingerprint.changedPaths must be empty");
  }
  validateFixtureChecks(state.probeChecks, "runtime.probeChecks", issues);

  const finalValidation = requireExactObject(state.finalValidation, [
    "status", "databaseName", "migrationCount", "candidateFingerprintStable", "repeatDeployLedgerStable",
  ], "runtime.finalValidation", issues);
  if (finalValidation) {
    expectJson(finalValidation, "status", "pass", "runtime.finalValidation", issues);
    expectJson(finalValidation, "databaseName", databaseName, "runtime.finalValidation", issues);
    expectJson(
      finalValidation,
      "migrationCount",
      manifestContracts.current.count,
      "runtime.finalValidation",
      issues,
    );
    expectJson(finalValidation, "candidateFingerprintStable", true, "runtime.finalValidation", issues);
    expectJson(finalValidation, "repeatDeployLedgerStable", true, "runtime.finalValidation", issues);
  }
  return {
    issues,
    candidateFingerprintDigest: typeof candidateFingerprint?.digest === "string" ? candidateFingerprint.digest : null,
  };
}

function validateRuntimeFingerprint(
  value: unknown,
  expectedCommit: string,
  label: string,
  issues: string[],
): Record<string, unknown> | null {
  const fingerprint = requireExactObject(value, [
    "algorithm", "gitHead", "worktreeState", "worktreeHash", "changedPaths", "commands", "profile", "digest",
  ], label, issues);
  if (!fingerprint) return null;
  expectJson(fingerprint, "algorithm", "sha256", label, issues);
  expectJson(fingerprint, "gitHead", expectedCommit, label, issues);
  expectJson(fingerprint, "worktreeState", "clean", label, issues);
  expectJson(fingerprint, "commands", ["pnpm ops:v11:compatibility-floor:orchestrate"], label, issues);
  expectJson(fingerprint, "profile", "custom", label, issues);
  for (const field of ["worktreeHash", "digest"] as const) {
    if (!/^sha256:[a-f0-9]{64}$/.test(typeof fingerprint[field] === "string" ? fingerprint[field] as string : "")) {
      issues.push(`${label}.${field} must be sha256:<64 lowercase hex>`);
    }
  }
  if (!Array.isArray(fingerprint.changedPaths)) issues.push(`${label}.changedPaths must be an array`);
  if (JSON.stringify(fingerprint.changedPaths) !== "[]") issues.push(`${label}.changedPaths must be empty`);
  if (typeof fingerprint.worktreeHash === "string" && typeof fingerprint.digest === "string") {
    const computed = `sha256:${createHash("sha256").update(JSON.stringify({
      gitHead: fingerprint.gitHead,
      worktreeHash: fingerprint.worktreeHash,
      changedPaths: fingerprint.changedPaths,
      commands: fingerprint.commands,
      profile: fingerprint.profile,
    })).digest("hex")}`;
    if (fingerprint.digest !== computed) issues.push(`${label}.digest does not match its fingerprint fields`);
  }
  return fingerprint;
}

function validateFixtureChecks(value: unknown, label: string, issues: string[]): void {
  const checks = requireExactObject(value, [
    "legacySubjectWritten", "secondWorkspaceWritten", "customSubjectsWithNullLegacyCode",
    "workspaceCompositeRowsWritten", "sameWorkspaceCompositeDuplicatesRejected",
  ], label, issues);
  if (!checks) return;
  const expected = {
    legacySubjectWritten: true,
    secondWorkspaceWritten: true,
    customSubjectsWithNullLegacyCode: 2,
    workspaceCompositeRowsWritten: 6,
    sameWorkspaceCompositeDuplicatesRejected: 3,
  } as const;
  for (const [field, expectedValue] of Object.entries(expected)) expectJson(checks, field, expectedValue, label, issues);
}

function requireExactObject(
  value: unknown,
  keys: string[],
  label: string,
  issues: string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${label} must be an object`);
    return null;
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`${label} must contain exactly: ${expected.join(", ")}`);
  return record;
}

function expectJson(
  record: Record<string, unknown>,
  field: string,
  expected: unknown,
  label: string,
  issues: string[],
): void {
  if (JSON.stringify(record[field]) !== JSON.stringify(expected)) issues.push(`${label}.${field} has an invalid value`);
}

function readBoundEvidence(
  root: string,
  expectedPath: string,
  expectedSha: string,
  label: string,
): { reference: EvidenceReference } | { detail: string } {
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSha)) return { detail: `${label}.sha256 must be sha256:<64 lowercase hex>` };
  const result = readRepoFile(root, expectedPath);
  if (!("reference" in result)) return { detail: result.detail };
  if (result.reference.sha256 !== expectedSha) return { detail: `${label} content hash does not match the review record` };
  return { reference: result.reference };
}

function evaluateFinalState(
  root: string,
  base: AdmissionBase,
  admissionRecord: EvidenceReference,
  evidence: Map<string, EvidenceReference>,
  dependencies: V11ReleaseAdmissionDependencies,
): AdmissionCheck[] {
  const bindingIssues: string[] = [];
  const actualHead = gitHead(root);
  if (actualHead !== base.currentGitCommit) bindingIssues.push("actual Git HEAD must match currentGitCommit");
  try {
    const binding = (dependencies.evaluateBinding ?? evaluateReleaseCloseoutBinding)({
      root,
      releaseGitCommit: base.sourceGitCommit ?? "",
      currentGitCommit: base.currentGitCommit ?? "",
    });
    base.bindingStatus = binding.status;
    if (binding.status === "invalid") bindingIssues.push(...binding.issues);
    if (binding.releaseGitCommit !== base.sourceGitCommit || binding.currentGitCommit !== base.currentGitCommit) {
      bindingIssues.push("final binding commit identity mismatch");
    }
    if (!binding.worktreeClean) bindingIssues.push("final release admission requires a clean worktree");
  } catch (error) {
    bindingIssues.push(safeError(error));
  }
  const bindingCheck = bindingIssues.length === 0
    ? ready("final_source_binding", "HEAD, source/evidence-only binding, and clean worktree were rechecked")
    : invalid("final_source_binding", bindingIssues.slice(0, 5).join("; "));

  const integrityIssues: string[] = [];
  for (const reference of [admissionRecord, ...evidence.values()]) {
    const issue = verifyReferenceUnchanged(root, reference);
    if (issue) integrityIssues.push(issue);
  }
  const integrity = integrityIssues.length === 0
    ? ready("final_evidence_integrity", "admission record and every bound evidence SHA were rechecked")
    : invalid("final_evidence_integrity", integrityIssues.slice(0, 5).join("; "));
  return [bindingCheck, integrity];
}

function verifyReferenceUnchanged(root: string, reference: EvidenceReference): string | null {
  const reread = readRepoFile(root, reference.path);
  if (!("reference" in reread)) return `${reference.path} could not be safely re-read: ${reread.detail}`;
  return reread.reference.sha256 === reference.sha256
    ? null
    : `${reference.path} changed after its admission hash was checked`;
}

function isClearEvidenceValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "none" || normalized === "not-applicable";
}

function readJsonString(raw: string, key: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed[key] === "string" ? parsed[key] as string : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finish(base: Omit<V11ReleaseAdmissionResult, "status">): V11ReleaseAdmissionResult {
  const status: V11ReleaseAdmissionStatus = base.checks.some((check) => check.status === "invalid")
    ? "invalid"
    : base.checks.some((check) => check.status === "not_ready")
      ? "not_ready"
      : "ready_for_signed_release";
  return { ...base, status };
}

function ready(id: string, detail: string, reference?: EvidenceReference): AdmissionCheck {
  return { id, status: "ready", detail, ...(reference ? { path: reference.path, sha256: reference.sha256 } : {}) };
}

function notReady(id: string, detail: string): AdmissionCheck {
  return { id, status: "not_ready", detail };
}

function invalid(id: string, detail: string): AdmissionCheck {
  return { id, status: "invalid", detail };
}

function requireValue(fields: Map<string, string>, field: string, issues: ValidationIssue[]): void {
  if (!(fields.get(field)?.trim())) issues.push({ field, message: "is required" });
}

function summarizeIssues(issues: ValidationIssue[]): string {
  return issues.slice(0, 6).map((issue) => `${issue.field}: ${issue.message}`).join("; ");
}

function normalizeRelativePath(value: string): string | null {
  if (!value || path.isAbsolute(value) || value.includes("\\")) return null;
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.split("/").includes("..")) return null;
  return normalized;
}

function rejectSymlinkTraversal(root: string, absolutePath: string): void {
  const realRoot = realpathSync(root);
  let current = root;
  for (const part of path.relative(root, absolutePath).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("evidence path or parent directory is a symlink");
  }
  if (!isWithin(realRoot, realpathSync(absolutePath))) throw new Error("evidence realpath escapes the repository");
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitHead(root: string): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const value = result.stdout.trim();
  return result.status === 0 && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function safeError(error: unknown): string {
  return sanitizeOutput(error instanceof Error ? error.message : String(error));
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, "<redacted-token>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function main(): void {
  const result = evaluateV11ReleaseAdmission();
  console.log(JSON.stringify(result));
  process.exitCode = exitCodeForV11ReleaseAdmission(result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
