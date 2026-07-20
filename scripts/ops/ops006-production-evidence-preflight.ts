import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateReleaseCloseoutBinding } from "../quality/release-closeout-binding";
import { parseIndentedKeyValueRecord, type ValidationIssue } from "../quality/record-validator-common";
import { validateReleaseSupplyChainRecord } from "../quality/release-supply-chain-validate";
import { buildOps006ConcurrencyPreflight } from "../quality/ops006-concurrency-preflight";
import { validateOps006ProductionEvidenceBundle } from "../quality/ops006-production-evidence-validate";

export type Ops006ProductionPreflightStatus =
  | "needs_local_verification"
  | "needs_signed_release"
  | "needs_rollout_confirmation"
  | "needs_probe_confirmation"
  | "needs_production_evidence"
  | "ready_for_ops006_human_review"
  | "invalid";

type Check = {
  status: "pass" | "missing" | "invalid";
  detail: string;
};

type ReleaseValidator = (record: string, options: {
  assetDir?: string;
  strict?: boolean;
  cosignPublicKey?: string;
}) => ValidationIssue[];

type BundleValidator = typeof validateOps006ProductionEvidenceBundle;

export type Ops006ProductionPreflightOptions = {
  root?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  releaseValidator?: ReleaseValidator;
  bundleValidator?: BundleValidator;
  localStatus?: string;
  checkoutEvaluator?: typeof evaluateReleaseCloseoutBinding;
};

export function buildOps006ProductionEvidencePreflight(
  options: Ops006ProductionPreflightOptions = {},
) {
  const root = path.resolve(options.root ?? process.cwd());
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const paths = evidencePaths(root, env);
  const localStatus = options.localStatus ?? buildOps006ConcurrencyPreflight({
    root,
    doctorPath: env.AREAFORGE_OPS006_DOCTOR_RECORD?.trim(),
    runtimePath: env.AREAFORGE_OPS006_RUNTIME_RECORD?.trim(),
    now,
  }).status;
  const checks = {
    localVerification: localStatus === "local_verified"
      ? pass("current checkout has local_verified OPS-006 evidence")
      : missing(`local OPS-006 status is ${localStatus}`),
    signedRelease: checkSignedRelease(paths.releaseRecord, paths.releaseAssets, root, options.releaseValidator),
    checkoutBinding: missing("signed Release identity is not yet available"),
    rolloutConfirmation: checkConfirmation(
      "rollout",
      env.AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_ID,
      env.AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_SCOPE_SHA256,
      paths.productionRecord,
    ),
    controlledProbeConfirmation: checkConfirmation(
      "controlled probe",
      env.AREAFORGE_OPS006_PROBE_CONFIRMATION_ID,
      env.AREAFORGE_OPS006_PROBE_CONFIRMATION_SCOPE_SHA256,
      paths.productionRecord,
    ),
    productionEvidence: missing("production evidence is not yet available"),
  };

  const releaseRecord = readOptional(paths.releaseRecord);
  const releaseCommit = parseIndentedKeyValueRecord(releaseRecord).get("gitCommit") ?? "";
  if (checks.signedRelease.status === "pass") {
    checks.checkoutBinding = checkCheckoutBinding(root, releaseCommit, options.checkoutEvaluator);
  }
  const productionRecord = readOptional(paths.productionRecord);
  const releaseEvidence = readOptional(paths.releaseEvidence);
  const releaseEvidenceCsv = readOptional(paths.releaseEvidenceCsv);
  const releaseEvidenceSummary = readOptional(paths.releaseEvidenceSummary);
  const confirmations = configuredConfirmations(env);
  if (confirmations.rollout.id && confirmations.probe.id
    && confirmations.rollout.id === confirmations.probe.id) {
    checks.controlledProbeConfirmation = invalid("controlled probe confirmation must be independent from the base rollout confirmation");
  }
  if (checks.signedRelease.status === "pass" && confirmations.rollout.id && confirmations.probe.id
    && productionRecord && releaseEvidence) {
    checks.productionEvidence = checkProductionEvidence({
      root, now, paths, productionRecord, releaseRecord, releaseEvidence,
      releaseEvidenceCsv,
      releaseEvidenceSummary,
      confirmations,
      bundleValidator: options.bundleValidator,
    });
  }

  const status = determineStatus(checks, localStatus, Boolean(productionRecord));
  const productionFields = parseIndentedKeyValueRecord(productionRecord);
  return {
    schemaVersion: 1,
    mode: "read_only_ops006_production_evidence_preflight",
    status,
    residualRiskIds: ["AF-RISK-OPS-006"],
    checks,
    evidence: {
      releaseRecord: label(paths.releaseRecord),
      releaseAssets: label(paths.releaseAssets),
      releaseEvidenceRecord: label(paths.releaseEvidence),
      releaseEvidenceReconciliationCsv: label(paths.releaseEvidenceCsv),
      releaseEvidenceReconciliationSummary: label(paths.releaseEvidenceSummary),
      productionEvidenceRecord: label(paths.productionRecord),
      releaseGitCommit: releaseCommit || null,
      afterDoctorFile: productionFields.get("afterDoctorFile") ?? null,
      afterDoctorFileSha256: productionFields.get("afterDoctorFileSha256") ?? null,
      afterDoctorHash: productionFields.get("afterDoctorHash") ?? null,
      releaseEvidenceRecordSha256: productionFields.get("releaseEvidenceRecordSha256") ?? null,
      releaseEvidenceBundleHash: productionFields.get("releaseEvidenceBundleHash") ?? null,
      releaseTag: productionFields.get("releaseTag") ?? null,
      gitCommit: productionFields.get("gitCommit") ?? null,
      webImageDigest: productionFields.get("webImageDigest") ?? null,
      migrationImageDigest: productionFields.get("migrationImageDigest") ?? null,
    },
    requiredNextSteps: nextSteps(status),
    doesNotProve: [
      "AF-RISK-OPS-006 residual closure",
      "production authorization when the confirmation ID is absent",
      "historical data repair or destructive rollback",
      "future concurrency safety after this evidence window",
    ],
    forbiddenActions: [
      "create_release_or_tag",
      "run_production_migration",
      "execute_production_probe",
      "repair_or_delete_history",
      "perform_backup_or_restore",
      "execute_server_command",
      "read_or_print_secret_values",
      "close_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      releaseCreated: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      secretValuePrinted: false,
      residualLedgerUpdated: false,
    },
  };
}

function evidencePaths(root: string, env: Record<string, string | undefined>) {
  const resolve = (key: string) => env[key]?.trim() ? path.resolve(root, env[key]!.trim()) : "";
  return {
    releaseRecord: resolve("AREAFORGE_OPS006_RELEASE_RECORD"),
    releaseAssets: resolve("AREAFORGE_OPS006_RELEASE_ASSETS_DIR"),
    releaseEvidence: resolve("AREAFORGE_OPS006_RELEASE_EVIDENCE_RECORD"),
    releaseEvidenceCsv: resolve("AREAFORGE_OPS006_RELEASE_RECONCILIATION_CSV"),
    releaseEvidenceSummary: resolve("AREAFORGE_OPS006_RELEASE_RECONCILIATION_SUMMARY"),
    productionRecord: resolve("AREAFORGE_OPS006_PRODUCTION_EVIDENCE_RECORD"),
  };
}

function checkSignedRelease(recordPath: string, assetsPath: string, root: string, validator?: ReleaseValidator): Check {
  if (!recordPath || !assetsPath) return missing("signed Release record and assets directory are required");
  if (!isRegularFile(recordPath) || !isRealDirectory(assetsPath)) return invalid("signed Release record or assets directory is unavailable or unsafe");
  const issues = (validator ?? validateReleaseSupplyChainRecord)(readFileSync(recordPath, "utf8"), {
    assetDir: assetsPath,
    strict: true,
    cosignPublicKey: process.env.AREAFORGE_COSIGN_PUBLIC_KEY?.trim() || path.join(root, "docs/deployment/keys/areaforge-cosign.pub"),
  });
  return issues.length === 0 ? pass("strict manifest, checksum, asset, and cosign validation passed")
    : invalid(`signed Release validation failed: ${issues.map((issue) => issue.field).join(", ")}`);
}

function checkCheckoutBinding(root: string, releaseCommit: string, evaluator?: typeof evaluateReleaseCloseoutBinding): Check {
  const result = (evaluator ?? evaluateReleaseCloseoutBinding)({ root, releaseGitCommit: releaseCommit });
  return result.status === "exact" || result.status === "evidence_only"
    ? pass(`current clean checkout is ${result.status} relative to the signed Release`)
    : invalid(`signed Release checkout binding failed: ${result.issues.join(", ") || result.status}`);
}

function checkConfirmation(
  label: string,
  confirmationId: string | undefined,
  confirmationScopeSha256: string | undefined,
  productionRecord: string,
): Check {
  const id = confirmationId?.trim();
  const scope = confirmationScopeSha256?.trim();
  if ((!id || !scope) && productionRecord) return invalid(`production evidence exists without a configured ${label} confirmation ID and scope hash`);
  if (!id || !scope) return missing(`independent OPS-006 ${label} confirmation ID and scope hash are required`);
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(id)) return invalid(`${label} confirmation ID format is invalid`);
  if (!/^sha256:[a-f0-9]{64}$/i.test(scope)) return invalid(`${label} confirmation scope hash format is invalid`);
  return pass(`redacted ${label} confirmation ID and scope hash are configured`);
}

function configuredConfirmations(env: Record<string, string | undefined>) {
  return {
    rollout: {
      id: env.AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_ID?.trim() ?? "",
      scope: env.AREAFORGE_OPS006_ROLLOUT_CONFIRMATION_SCOPE_SHA256?.trim() ?? "",
    },
    probe: {
      id: env.AREAFORGE_OPS006_PROBE_CONFIRMATION_ID?.trim() ?? "",
      scope: env.AREAFORGE_OPS006_PROBE_CONFIRMATION_SCOPE_SHA256?.trim() ?? "",
    },
  };
}

function checkProductionEvidence(input: {
  root: string;
  now: Date;
  paths: ReturnType<typeof evidencePaths>;
  productionRecord: string;
  releaseRecord: string;
  releaseEvidence: string;
  releaseEvidenceCsv: string;
  releaseEvidenceSummary: string;
  confirmations: ReturnType<typeof configuredConfirmations>;
  bundleValidator?: BundleValidator;
}): Check {
  if (!isRegularFile(input.paths.releaseEvidenceCsv) || !isRegularFile(input.paths.releaseEvidenceSummary)) {
    return invalid("Release evidence reconciliation CSV and summary are required and must be safe regular files");
  }
  const fields = parseIndentedKeyValueRecord(input.productionRecord);
  const expectedConfirmations = [
    ["rolloutConfirmationId", input.confirmations.rollout.id],
    ["rolloutConfirmationScopeSha256", input.confirmations.rollout.scope],
    ["controlledProbeConfirmationId", input.confirmations.probe.id],
    ["controlledProbeConfirmationScopeSha256", input.confirmations.probe.scope],
  ] as const;
  if (expectedConfirmations.some(([field, value]) => fields.get(field) !== value)) {
    return invalid("production evidence confirmation IDs or scope hashes do not match the configured independent confirmations");
  }
  const issues = (input.bundleValidator ?? validateOps006ProductionEvidenceBundle)(
    input.productionRecord,
    input.releaseRecord,
    input.releaseEvidence,
    {
      root: input.root,
      now: input.now,
      evidenceBaseDir: path.dirname(input.paths.productionRecord),
      maxAgeHours: 24,
      releaseAssetsDir: input.paths.releaseAssets,
      releaseEvidenceCsv: input.releaseEvidenceCsv || undefined,
      releaseEvidenceSummary: input.releaseEvidenceSummary || undefined,
      cosignPublicKey: process.env.AREAFORGE_COSIGN_PUBLIC_KEY?.trim() || path.join(input.root, "docs/deployment/keys/areaforge-cosign.pub"),
    },
  );
  return issues.length === 0 ? pass("production rollout, doctor, probe, release, and rollback evidence passed")
    : invalid(`OPS-006 production evidence failed: ${issues.map((issue) => issue.field).join(", ")}`);
}

function determineStatus(
  checks: Record<string, Check>,
  localStatus: string,
  productionRecordPresent: boolean,
): Ops006ProductionPreflightStatus {
  if (Object.values(checks).some((check) => check.status === "invalid")) return "invalid";
  if (localStatus !== "local_verified") return "needs_local_verification";
  if (checks.signedRelease?.status !== "pass" || checks.checkoutBinding?.status !== "pass") return "needs_signed_release";
  if (checks.rolloutConfirmation?.status !== "pass") return "needs_rollout_confirmation";
  if (checks.controlledProbeConfirmation?.status !== "pass") return "needs_probe_confirmation";
  if (!productionRecordPresent || checks.productionEvidence?.status !== "pass") return "needs_production_evidence";
  return "ready_for_ops006_human_review";
}

function nextSteps(status: Ops006ProductionPreflightStatus): string[] {
  const values: Record<Ops006ProductionPreflightStatus, string[]> = {
    needs_local_verification: ["restore current local_verified doctor and isolated PostgreSQL evidence"],
    needs_signed_release: ["create and strictly validate a matching signed Release after explicit confirmation"],
    needs_rollout_confirmation: ["obtain the independent OPS-006 base rollout confirmation and canonical scope hash"],
    needs_probe_confirmation: ["after the base rollout is ready, obtain the separate controlled-write probe confirmation and canonical scope hash"],
    needs_production_evidence: ["collect fresh redacted before/after doctor, rollout, probe, Release evidence, and rollback bindings"],
    ready_for_ops006_human_review: ["perform human residual review; do not update the ledger automatically"],
    invalid: ["fix malformed, unsafe, stale, or mismatched evidence before continuing"],
  };
  return values[status];
}

function readOptional(file: string): string {
  return isRegularFile(file) ? readFileSync(file, "utf8") : "";
}

function isRegularFile(file: string): boolean {
  return Boolean(file) && existsSync(file) && !lstatSync(file).isSymbolicLink() && lstatSync(file).isFile();
}

function isRealDirectory(file: string): boolean {
  return Boolean(file) && existsSync(file) && !lstatSync(file).isSymbolicLink() && lstatSync(file).isDirectory();
}

function label(file: string): string | null {
  return file ? "<configured redacted path>" : null;
}

function pass(detail: string): Check {
  return { status: "pass", detail };
}

function missing(detail: string): Check {
  return { status: "missing", detail };
}

function invalid(detail: string): Check {
  return { status: "invalid", detail };
}

function main(): void {
  const result = buildOps006ProductionEvidencePreflight();
  console.log(JSON.stringify(result, null, 2));
  const strict = process.argv.includes("--require-human-review-ready");
  process.exitCode = result.status === "invalid" || (strict && result.status !== "ready_for_ops006_human_review") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
