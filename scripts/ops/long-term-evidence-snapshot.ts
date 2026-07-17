import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildOperabilityStatusProjection, type OperabilityStatusProjection } from "./operability-status";
import { validateDataIntegrityDoctor } from "../quality/data-integrity-doctor-validate";
import { resolveReleaseEvidenceValidationArgs } from "../quality/release-evidence-validate";
import { resolveProductExperienceReviewPath } from "../quality/product-experience-review-discovery";

type SnapshotStatus = "ready_for_long_term_operability_review" | "needs_live_evidence" | "invalid";
type CheckStatus = "pass" | "needs_live_evidence" | "missing" | "stale" | "invalid";

type JsonRecord = Record<string, unknown>;

export type SnapshotCheck = {
  key: string;
  label: string;
  status: CheckStatus;
  actualStatus: string;
  expectedStatus: string;
  validatorCommand: string;
  evidenceHash: string | null;
  residualRiskIds: string[];
  freshness: Record<string, unknown>;
  versionMatch: boolean | "not_applicable";
  doesNotProve: string[];
  metadata: Record<string, unknown>;
};

type EvidencePath = {
  key: string;
  pathLabel: string | null;
  configured: boolean;
  exists: boolean;
  sha256: string | null;
};

type LongTermEvidenceSnapshot = {
  schemaVersion: 3;
  mode: "read_only_long_term_evidence_snapshot";
  generatedAt: string;
  snapshotHash: string;
  expectedVersion: string;
  releaseTag: string;
  packageVersion: string;
  scope: "long_term_operability_current_checkout";
  status: SnapshotStatus;
  nextCommand: string;
  sourceSnapshot: {
    controlPlaneSourceHash: string;
    protectedPathFingerprint: OperabilityStatusProjection["sourceSnapshot"]["protectedPathFingerprint"];
    files: string[];
    missingFiles: string[];
    evidencePaths: EvidencePath[];
    inputHashes: Array<Pick<EvidencePath, "key" | "pathLabel" | "sha256">>;
  };
  checks: SnapshotCheck[];
  doesNotProve: string[];
  forbiddenActions: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    githubApiCalled: false;
    serverCommandAttempted: false;
    backupRestoreAttempted: false;
    migrationAttempted: false;
    productionWriteAttempted: false;
    updaterApplyAttempted: false;
    residualLedgerUpdated: false;
    secretValuePrinted: false;
    destructiveActionAttempted: false;
    realStudyContentIncluded: false;
    passwordValuePrinted: false;
    writeSmokeAttempted: false;
    releaseCreated: false;
    tagPushed: false;
    releaseAssetsDownloaded: false;
    productionEnvIncluded: false;
    backupIncluded: false;
    notificationSent: false;
    externalAlertReceiverCalled: false;
  };
};

const defaultOperationalEvidenceBundle = "docs/development/operational-evidence-bundle-v0.1.7-20260712.json";
const defaultOps004AlertPreview = "docs/development/ops-004-alert-preview-v0.1.7-20260712.json";
const defaultOps004AlertDrillRecord = "docs/development/ops-004-alert-drill-v0.1.7-20260712-manual-window.txt";
const defaultReleaseEvidenceRecord = "docs/development/release-v0.1.7-record.md";
const defaultReleaseSupplyChainRecord = "docs/development/release-supply-chain-v0.1.7.md";
const defaultMaxUxAgeDays = 14;
const defaultMaxDataIntegrityAgeHours = 24;

const requiredSignalKeys = [
  "health",
  "releaseIdentity",
  "updateAgent",
  "authenticatedSmoke",
  "backup",
  "rollback",
  "infrastructure",
];

function main(): void {
  const packageVersion = expectedVersion();
  const releaseTag = `v${packageVersion}`;
  const projection = buildOperabilityStatusProjection();
  const paths = collectEvidencePaths();
  const checks = [
    checkControlPlane(projection.sourceSnapshot.controlPlaneSourceHash),
    checkOps001(paths),
    checkOps004(paths),
    checkOps005(paths, packageVersion, releaseTag),
    buildDataIntegritySnapshotCheck(paths),
    checkReleaseEvidence(paths, packageVersion, releaseTag),
    checkSupplyChain(paths, packageVersion, releaseTag),
    checkUxReview(paths, packageVersion),
    checkOperationalEvidenceBundle(paths, packageVersion, releaseTag),
  ];

  const status = snapshotStatus(checks);
  const snapshotWithoutHash = {
    schemaVersion: 3,
    mode: "read_only_long_term_evidence_snapshot" as const,
    generatedAt: new Date().toISOString(),
    snapshotHash: "",
    expectedVersion: packageVersion,
    releaseTag,
    packageVersion,
    scope: "long_term_operability_current_checkout" as const,
    status,
    nextCommand: snapshotNextCommand(status, checks),
    sourceSnapshot: {
      controlPlaneSourceHash: projection.sourceSnapshot.controlPlaneSourceHash,
      protectedPathFingerprint: projection.sourceSnapshot.protectedPathFingerprint,
      files: projection.sourceSnapshot.files,
      missingFiles: projection.sourceSnapshot.missingFiles,
      evidencePaths: paths,
      inputHashes: paths
        .filter((item) => item.sha256)
        .map((item) => ({ key: item.key, pathLabel: item.pathLabel, sha256: item.sha256 })),
    },
    checks,
    doesNotProve: [
      "current production health without post-version live smoke and update-agent evidence",
      "OPS-001 closure or residual ledger closure",
      "OPS-004 alert recovery drill completion or residual ledger closure",
      "OPS-005 expected-before V2 implementation, signed Release, production deployment, or residual ledger closure without ready_for_ops005_human_review evidence",
      "OPS-006 concurrency safety or residual closure from a passing data-integrity doctor record",
      "release evidence record validation when backup hashes are root-only or missing",
      "backup freshness, restore execution, migration execution, or rollback execution",
      "server updater apply completion for a future release",
      "GitHub Release creation or release asset download",
      "production write smoke safety",
      "full real user data experience",
      "AI provider payload safety beyond existing release records",
    ],
    forbiddenActions: [
      "execute_server_command",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "trigger_production_write_smoke",
      "read_or_print_secret_values",
      "create_github_release",
      "push_git_tag",
      "download_release_assets",
      "call_github_api",
      "update_residual_ledger",
      "send_notification",
      "call_external_alert_receiver",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      githubApiCalled: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      updaterApplyAttempted: false,
      residualLedgerUpdated: false,
      secretValuePrinted: false,
      destructiveActionAttempted: false,
      realStudyContentIncluded: false,
      passwordValuePrinted: false,
      writeSmokeAttempted: false,
      releaseCreated: false,
      tagPushed: false,
      releaseAssetsDownloaded: false,
      productionEnvIncluded: false,
      backupIncluded: false,
      notificationSent: false,
      externalAlertReceiverCalled: false,
    },
  } satisfies LongTermEvidenceSnapshot;

  const snapshot: LongTermEvidenceSnapshot = {
    ...snapshotWithoutHash,
    snapshotHash: hashSnapshot(snapshotWithoutHash),
  };

  console.log(JSON.stringify(snapshot, null, 2));

  if (snapshot.status === "invalid" || shouldFail(snapshot.status, process.env.AREAFORGE_LONG_TERM_SNAPSHOT_FAIL_ON)) {
    process.exit(1);
  }
}

function checkControlPlane(controlPlaneSourceHash: string): SnapshotCheck {
  const command = "pnpm exec tsx scripts/quality/enterprise-operability-preflight.ts";
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/enterprise-operability-preflight.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) {
    return {
      key: "controlPlane",
      label: "enterprise operability control plane",
      status: "pass",
      actualStatus: "pass",
      expectedStatus: "pass",
      validatorCommand: command,
      evidenceHash: `sha256:${controlPlaneSourceHash}`,
      residualRiskIds: [],
      freshness: { source: "current checkout" },
      versionMatch: "not_applicable",
      doesNotProve: [
        "production health",
        "live smoke passed",
        "release update completion",
        "residual ledger closure",
      ],
      metadata: {
        controlPlaneSourceHash,
      },
    };
  }
  return {
    key: "controlPlane",
    label: "enterprise operability control plane",
    status: "invalid",
    actualStatus: "preflight_failed",
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: `sha256:${controlPlaneSourceHash}`,
    residualRiskIds: [],
    freshness: { source: "current checkout" },
    versionMatch: "not_applicable",
    doesNotProve: ["production health", "residual ledger closure"],
    metadata: {
      detail: sanitizeOutput(result.stderr || result.stdout || "enterprise operability preflight failed"),
      controlPlaneSourceHash,
    },
  };
}

function checkOps001(paths: EvidencePath[]): SnapshotCheck {
  const command = "pnpm exec tsx scripts/ops/ops001-evidence-preflight.ts";
  const result = runJsonCommand(["pnpm", "exec", "tsx", "scripts/ops/ops001-evidence-preflight.ts"], {
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: envOrExisting("AREAFORGE_OPS001_EVIDENCE_BUNDLE", defaultOperationalEvidenceBundle),
  });
  const actualStatus = stringValue(result.body?.status, result.ok ? "missing" : "invalid");
  return {
    key: "ops001",
    label: "OPS-001 production read-only smoke and update-agent evidence",
    status: statusFromExpected(result, actualStatus, "ready_for_human_close"),
    actualStatus,
    expectedStatus: "ready_for_human_close",
    validatorCommand: command,
    evidenceHash: commandEvidenceHash(result.raw, paths, [
      "ops001SmokeRecord",
      "ops001UpdateStatusRecord",
      "ops001EvidenceBundle",
      "ops001ClosurePacket",
      "ops001BlockedRecord",
    ]),
    residualRiskIds: ["AF-RISK-OPS-001"],
    freshness: { source: "OPS-001 preflight output" },
    versionMatch: "not_applicable",
    doesNotProve: [
      "OPS-001 residual closure",
      "post-version authenticated production smoke passed unless actualStatus is ready_for_human_close",
      "backup or rollback evidence",
      "production write smoke safety",
    ],
    metadata: {
      preflightMode: stringValue(result.body?.mode, "missing"),
      nextCommand: stringValue(result.body?.nextCommand, ""),
    },
  };
}

function checkOps004(paths: EvidencePath[]): SnapshotCheck {
  const command = "pnpm exec tsx scripts/ops/ops004-alert-evidence-preflight.ts";
  const result = runJsonCommand(["pnpm", "exec", "tsx", "scripts/ops/ops004-alert-evidence-preflight.ts"], {
    AREAFORGE_OPS004_ALERT_PREVIEW: envOrExisting("AREAFORGE_OPS004_ALERT_PREVIEW", defaultOps004AlertPreview),
    AREAFORGE_OPS004_ALERT_DRILL_RECORD: envOrExisting("AREAFORGE_OPS004_ALERT_DRILL_RECORD", defaultOps004AlertDrillRecord),
  });
  const actualStatus = stringValue(result.body?.status, result.ok ? "missing" : "invalid");
  return {
    key: "ops004",
    label: "OPS-004 alert and recovery drill evidence",
    status: statusFromExpected(result, actualStatus, "ready_for_human_close"),
    actualStatus,
    expectedStatus: "ready_for_human_close",
    validatorCommand: command,
    evidenceHash: commandEvidenceHash(result.raw, paths, ["ops004AlertPreview", "ops004AlertDrillRecord"]),
    residualRiskIds: ["AF-RISK-OPS-004"],
    freshness: { source: "OPS-004 preflight output" },
    versionMatch: "not_applicable",
    doesNotProve: [
      "alert notification sent",
      "external alert receiver called",
      "OPS-004 residual closure",
      "production health",
    ],
    metadata: {
      preflightMode: stringValue(result.body?.mode, "missing"),
      nextCommand: stringValue(result.body?.nextCommand, ""),
    },
  };
}

function checkOps005(paths: EvidencePath[], packageVersion: string, releaseTag: string): SnapshotCheck {
  const command = "pnpm exec tsx scripts/ops/ops005-evidence-preflight.ts";
  const result = runJsonCommand(["pnpm", "exec", "tsx", "scripts/ops/ops005-evidence-preflight.ts"], {
    AREAFORGE_OPS005_RELEASE_RECORD: process.env.AREAFORGE_OPS005_RELEASE_RECORD,
    AREAFORGE_OPS005_RELEASE_ASSETS_DIR: process.env.AREAFORGE_OPS005_RELEASE_ASSETS_DIR,
    AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD: process.env.AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD,
    AREAFORGE_OPS005_GIT_COMMIT: process.env.AREAFORGE_OPS005_GIT_COMMIT,
    AREAFORGE_OPS005_NOW: process.env.AREAFORGE_OPS005_NOW,
  });
  const actualStatus = stringValue(result.body?.status, result.ok ? "missing" : "invalid");
  const productionRecordPath = process.env.AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD?.trim() ?? "";
  const productionFields = productionRecordPath ? parseFieldsIfExists(productionRecordPath) : new Map<string, string>();
  const versionMatch = result.body?.packageVersion === packageVersion && result.body?.releaseTag === releaseTag;
  const checkStatus = statusFromExpected(result, actualStatus, "ready_for_ops005_human_review");
  const recordedAt = productionFields.get("recordedAt") ?? null;
  const maxAgeHours = Number(productionFields.get("evidenceFreshnessMaxAgeHours") ?? "24");
  const ageHours = recordedAt ? ageInHours(recordedAt) : Number.NaN;
  const fresh = Number.isFinite(ageHours) && ageHours <= maxAgeHours;
  const checks = isRecord(result.body?.checks) ? result.body.checks : {};
  const local = isRecord(checks.localImplementation) ? checks.localImplementation : {};
  const release = isRecord(checks.signedRelease) ? checks.signedRelease : {};
  const production = isRecord(checks.productionEvidence) ? checks.productionEvidence : {};

  return {
    key: "ops005",
    label: "OPS-005 expected-before V2 release and production evidence",
    status: checkStatus === "pass" && versionMatch && fresh ? "pass" : checkStatus === "invalid" ? "invalid" : "needs_live_evidence",
    actualStatus,
    expectedStatus: "ready_for_ops005_human_review",
    validatorCommand: command,
    evidenceHash: evidencePathHash(paths, "ops005ProductionEvidence") ?? commandEvidenceHash(result.raw, paths, ["ops005ProductionEvidence"]),
    residualRiskIds: ["AF-RISK-OPS-005"],
    freshness: {
      recordedAt,
      ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
      maxAgeHours,
      status: fresh ? "fresh" : recordedAt ? "stale" : "unknown",
    },
    versionMatch,
    doesNotProve: [
      "AF-RISK-OPS-005 residual closure",
      "production deployment without matching release identity",
      "mutation safety without fresh redacted V2 evidence",
    ],
    metadata: {
      localImplementation: stringValue(local.status, "missing"),
      signedRelease: stringValue(release.status, "missing"),
      productionDeployment: stringValue(production.status, "missing"),
      v2Check: productionFields.get("v2CheckStatus") ?? "missing",
      expectedBeforeRejection: productionFields.get("expectedBeforeRejectionStatus") ?? "missing",
      expectedBeforeRejectionExecutionAttempted: productionFields.get("expectedBeforeRejectionExecutionAttempted") ?? "missing",
      sharedProductionStateLock: productionFields.get("sharedProductionStateLockStatus") ?? "missing",
      processingReconciliation: productionFields.get("processingReconciliationStatus") ?? "missing",
      autoApply: productionFields.get("autoApply") ?? "missing",
      releaseTag: result.body?.releaseTag ?? null,
      gitCommit: result.body?.gitCommit ?? null,
    },
  };
}

export function buildDataIntegritySnapshotCheck(paths: EvidencePath[]): SnapshotCheck {
  const command = "pnpm ops:data-integrity:validate <data-integrity-doctor.json>";
  const configuredPath = process.env.AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD?.trim();
  if (!configuredPath) {
    return unavailableDataIntegrityCheck(paths, "missing", "record_not_configured", command);
  }
  const absolutePath = path.resolve(configuredPath);
  if (!existsSync(absolutePath)) {
    return unavailableDataIntegrityCheck(paths, "missing", "record_missing", command);
  }
  const raw = readFileSync(absolutePath, "utf8");
  const issues = validateDataIntegrityDoctor(raw);
  if (issues.length > 0) {
    return unavailableDataIntegrityCheck(paths, "invalid", "record_invalid", command, sanitizeOutput(issues.join("; ")));
  }
  const body = JSON.parse(raw) as JsonRecord;
  const status = isRecord(body.status) ? body.status : {};
  const source = isRecord(body.source) ? body.source : {};
  const safety = isRecord(body.safetyFacts) ? body.safetyFacts : {};
  const checks = Array.isArray(body.checks) ? body.checks.filter(isRecord) : [];
  const attachment = checks.find((item) => item.id === "attachments.reconciliation") ?? {};
  const generatedAt = stringValue(body.generatedAt, "");
  const ageHours = signedAgeInHours(generatedAt);
  const maxAgeHours = maxDataIntegrityAgeHours();
  const timestampValid = Number.isFinite(ageHours) && ageHours >= -5 / 60;
  const fresh = timestampValid && ageHours <= maxAgeHours;
  const recordPasses = status.overall === "pass" &&
    source.database === "configured_read_only_query" &&
    safety.databaseReadAttempted === true &&
    attachment.status === "pass";
  const checkStatus = !timestampValid
    ? "invalid"
    : !recordPasses ? "needs_live_evidence" : !fresh ? "stale" : "pass";
  return {
    key: "dataIntegrity",
    label: "fresh business data integrity doctor",
    status: checkStatus,
    actualStatus: stringValue(status.overall, "missing"),
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: evidencePathHash(paths, "dataIntegrityRecord"),
    residualRiskIds: ["AF-RISK-OPS-006"],
    freshness: {
      generatedAt: generatedAt || null,
      ageHours: Number.isFinite(ageHours) ? Number(Math.max(0, ageHours).toFixed(2)) : null,
      maxAgeHours,
      status: fresh ? "fresh" : "stale",
    },
    versionMatch: "not_applicable",
    doesNotProve: [
      "database account permissions or query origin attestation",
      "future concurrency safety after the recorded snapshot",
      "automatic data repair, migration, or residual ledger closure",
    ],
    metadata: {
      doctorMode: stringValue(body.mode, "missing"),
      overall: stringValue(status.overall, "missing"),
      native: stringValue(status.native, "missing"),
      databaseSource: stringValue(source.database, "missing"),
      databaseReadAttempted: safety.databaseReadAttempted === true,
      attachmentStatus: stringValue(attachment.status, "missing"),
      doctorHash: stringValue(body.doctorHash, "missing"),
    },
  };
}

function unavailableDataIntegrityCheck(
  paths: EvidencePath[],
  status: "missing" | "invalid",
  actualStatus: string,
  command: string,
  detail?: string,
): SnapshotCheck {
  return {
    key: "dataIntegrity",
    label: "fresh business data integrity doctor",
    status,
    actualStatus,
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: evidencePathHash(paths, "dataIntegrityRecord"),
    residualRiskIds: ["AF-RISK-OPS-006"],
    freshness: {
      generatedAt: null,
      ageHours: null,
      maxAgeHours: maxDataIntegrityAgeHours(),
      status: "unknown",
    },
    versionMatch: "not_applicable",
    doesNotProve: [
      "database account permissions or query origin attestation",
      "future concurrency safety after the recorded snapshot",
      "automatic data repair, migration, or residual ledger closure",
    ],
    metadata: {
      doctorMode: "missing",
      overall: "missing",
      native: "missing",
      databaseSource: "missing",
      databaseReadAttempted: false,
      attachmentStatus: "missing",
      doctorHash: "missing",
      ...(detail ? { detail } : {}),
    },
  };
}

function checkSupplyChain(paths: EvidencePath[], packageVersion: string, releaseTag: string): SnapshotCheck {
  const command = "pnpm exec tsx scripts/ops/sc002-supply-chain-preflight.ts";
  const releaseRecordPath = envOrExisting("AREAFORGE_SC002_RELEASE_RECORD", defaultReleaseSupplyChainRecord);
  const result = runJsonCommand(["pnpm", "exec", "tsx", "scripts/ops/sc002-supply-chain-preflight.ts"], {
    AREAFORGE_SC002_RELEASE_RECORD: releaseRecordPath,
  });
  const actualStatus = stringValue(result.body?.status, result.ok ? "missing" : "invalid");
  const recordFields = releaseRecordPath ? parseFieldsIfExists(releaseRecordPath) : new Map<string, string>();
  const versionMatch = recordFields.get("packageVersion") === packageVersion && recordFields.get("releaseTag") === releaseTag;
  const checkStatus = statusFromExpected(result, actualStatus, "ready_for_sc001_sc002_review");
  return {
    key: "supplyChain",
    label: "signed Release supply-chain evidence",
    status: checkStatus === "pass" && versionMatch ? "pass" : checkStatus === "invalid" ? "invalid" : "needs_live_evidence",
    actualStatus,
    expectedStatus: "ready_for_sc001_sc002_review",
    validatorCommand: command,
    evidenceHash: evidencePathHash(paths, "releaseSupplyChainRecord") ?? commandEvidenceHash(result.raw, paths, []),
    residualRiskIds: ["AF-RISK-SC-001", "AF-RISK-SC-002"],
    freshness: {
      recordedAt: recordFields.get("recordedAt") ?? null,
      source: "signed Release supply-chain record",
    },
    versionMatch,
    doesNotProve: [
      "production update completion by itself",
      "SC residual ledger closure",
      "future Release asset trust",
      "OPS-001 or OPS-004 evidence",
    ],
    metadata: {
      releaseTag: recordFields.get("releaseTag") ?? null,
      packageVersion: recordFields.get("packageVersion") ?? null,
      workflowRunConclusion: recordFields.get("workflowRunConclusion") ?? null,
      checksumVerification: recordFields.get("checksumVerification") ?? null,
      signatureVerification: recordFields.get("signatureVerification") ?? null,
      unsignedPlaceholderPresent: recordFields.get("unsignedPlaceholderPresent") ?? null,
    },
  };
}

function checkReleaseEvidence(paths: EvidencePath[], packageVersion: string, releaseTag: string): SnapshotCheck {
  const recordPath = envOrExisting("AREAFORGE_RELEASE_EVIDENCE_RECORD", defaultReleaseEvidenceRecord);
  const command = `pnpm exec tsx scripts/quality/release-evidence-validate.ts ${recordPath ? path.basename(recordPath) : "<missing>"} <attachment-reconciliation.csv> <attachment-reconciliation-summary.json>`;
  if (!recordPath) {
    return missingCheck("releaseEvidenceRecord", "production release evidence record", command, [
      "AF-RISK-OPS-001",
      "AF-RISK-OPS-004",
      "AF-RISK-REL-001",
    ]);
  }
  const absolutePath = path.resolve(recordPath);
  if (!existsSync(absolutePath)) {
    return invalidCheck("releaseEvidenceRecord", "production release evidence record", command, "release evidence record does not exist", [
      "AF-RISK-OPS-001",
      "AF-RISK-OPS-004",
      "AF-RISK-REL-001",
    ]);
  }
  const validationArgs = resolveReleaseEvidenceValidationArgs(absolutePath);
  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/release-evidence-validate.ts", ...validationArgs], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const fields = parseIndentedKeyValueRecord(readFileSync(absolutePath, "utf8"));
  const versionMatch = fields.get("releaseTag") === releaseTag;
  const validationPassed = validation.status === 0;
  const failureDetail = validationPassed ? "" : sanitizeOutput(validation.stderr || validation.stdout || "release evidence validator failed");
  return {
    key: "releaseEvidenceRecord",
    label: "production release evidence record",
    status: validationPassed && versionMatch ? "pass" : "needs_live_evidence",
    actualStatus: validationPassed ? "pass" : "validation_failed",
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: commandEvidenceHash("release evidence inputs", paths, ["releaseEvidenceRecord", "releaseAttachmentReconciliationCsv", "releaseAttachmentReconciliationSummary"]),
    residualRiskIds: stringArrayFromCsv(fields.get("residualRiskIds")).filter((id) => id.startsWith("AF-RISK-")),
    freshness: {
      releasedAt: fields.get("releasedAt") ?? null,
      source: "release evidence record",
    },
    versionMatch,
    doesNotProve: [
      "backup freshness when backup hash fields are root-only or unavailable",
      "production restore execution",
      "production write smoke safety",
      "OPS-001 or OPS-004 residual closure",
      "residual ledger closure",
    ],
    metadata: {
      releaseTag: fields.get("releaseTag") ?? null,
      gitCommit: fields.get("gitCommit") ?? null,
      migrationApplied: fields.get("migrationApplied") ?? null,
      migrationRunner: fields.get("migrationRunner") ?? null,
      postReleaseHealth: fields.get("postReleaseSmoke.health") ?? null,
      postReleaseTaskTimerReview: fields.get("postReleaseSmoke.taskTimerReview") ?? null,
      postReleaseAttachmentSmoke: fields.get("postReleaseSmoke.attachmentSmoke") ?? null,
      postReleaseAiFallbackOrProvider: fields.get("postReleaseSmoke.aiFallbackOrProvider") ?? null,
      releaseEvidenceBundleHashStatus: hashFieldStatus(fields.get("releaseEvidenceBundleHash"), true),
      databaseBackupSha256Status: hashFieldStatus(fields.get("databaseBackupSha256")),
      uploadsBackupSha256Status: hashFieldStatus(fields.get("uploadsBackupSha256")),
      envBackupSha256Status: hashFieldStatus(fields.get("envBackupSha256")),
      attachmentReconciliationCsvSha256Status: hashFieldStatus(fields.get("attachmentReconciliationCsvSha256"), true),
      attachmentReconciliationSummaryHashStatus: hashFieldStatus(fields.get("attachmentReconciliationSummaryHash"), true),
      attachmentReconciliationStatus: fields.get("attachmentReconciliationStatus") ?? null,
      validatorDetail: validationPassed ? "validator passed" : failureDetail,
    },
  };
}

function checkUxReview(paths: EvidencePath[], packageVersion: string): SnapshotCheck {
  const recordPath = resolveProductExperienceReviewPath(process.cwd(), process.env.AREAFORGE_LONG_TERM_UX_RECORD);
  const command = `pnpm exec tsx scripts/quality/product-experience-review-validate.ts ${recordPath ? path.basename(recordPath) : "<missing>"}`;
  if (!recordPath) {
    return missingCheck("uxReview", "fresh desktop/mobile product experience review", command, ["AF-RISK-UX-001"]);
  }
  const absolutePath = path.resolve(recordPath);
  if (!existsSync(absolutePath)) {
    return invalidCheck("uxReview", "fresh desktop/mobile product experience review", command, "UX review record does not exist", ["AF-RISK-UX-001"]);
  }
  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/product-experience-review-validate.ts", absolutePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const fields = parseIndentedKeyValueRecord(readFileSync(absolutePath, "utf8"));
  const ageDays = ageInDays(fields.get("reviewedAt") ?? "");
  const versionMatch = fields.get("appVersion") === packageVersion;
  const fresh = Number.isFinite(ageDays) && ageDays <= maxUxAgeDays();
  const actualStatus = validation.status === 0 ? fields.get("reviewStatus") ?? "pass" : "invalid";
  let status: CheckStatus = "pass";
  if (validation.status !== 0) status = "invalid";
  else if (!versionMatch) status = "needs_live_evidence";
  else if (!fresh) status = "stale";
  return {
    key: "uxReview",
    label: "fresh desktop/mobile product experience review",
    status,
    actualStatus,
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: evidencePathHash(paths, "uxReviewRecord"),
    residualRiskIds: ["AF-RISK-UX-001"],
    freshness: {
      reviewedAt: fields.get("reviewedAt") ?? null,
      ageDays: Number.isFinite(ageDays) ? Number(ageDays.toFixed(2)) : null,
      maxAgeDays: maxUxAgeDays(),
      status: fresh ? "fresh" : "stale",
    },
    versionMatch,
    doesNotProve: [
      "production write smoke safety",
      "production attachment write safety",
      "full real user data experience",
      "OPS-001 or OPS-004 evidence",
    ],
    metadata: {
      appVersion: fields.get("appVersion") ?? null,
      environment: fields.get("environment") ?? null,
      viewports: fields.get("viewports") ?? null,
      journeys: fields.get("journeys") ?? null,
      validatorDetail: validation.status === 0
        ? "validator passed"
        : sanitizeOutput(validation.stderr || validation.stdout || "UX validator failed"),
    },
  };
}

function checkOperationalEvidenceBundle(paths: EvidencePath[], packageVersion: string, releaseTag: string): SnapshotCheck {
  const bundlePath = envOrExisting("AREAFORGE_LONG_TERM_EVIDENCE_BUNDLE", defaultOperationalEvidenceBundle);
  const command = `pnpm exec tsx scripts/quality/operational-evidence-bundle-validate.ts ${bundlePath ? path.basename(bundlePath) : "<missing>"}`;
  if (!bundlePath) {
    return missingCheck("operationalEvidenceBundle", "operational evidence bundle", command, ["AF-RISK-OPS-001", "AF-RISK-OPS-004"]);
  }
  const absolutePath = path.resolve(bundlePath);
  if (!existsSync(absolutePath)) {
    return invalidCheck("operationalEvidenceBundle", "operational evidence bundle", command, "operational evidence bundle does not exist", [
      "AF-RISK-OPS-001",
      "AF-RISK-OPS-004",
    ]);
  }
  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/operational-evidence-bundle-validate.ts", absolutePath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    return invalidCheck(
      "operationalEvidenceBundle",
      "operational evidence bundle",
      command,
      sanitizeOutput(validation.stderr || validation.stdout || "operational evidence bundle validator failed"),
      ["AF-RISK-OPS-001", "AF-RISK-OPS-004"],
    );
  }

  const bundle = JSON.parse(readFileSync(absolutePath, "utf8")) as JsonRecord;
  const summary = isRecord(bundle.summary) ? bundle.summary : {};
  const expected = isRecord(summary.expected) ? summary.expected : {};
  const freshness = isRecord(bundle.freshness) ? bundle.freshness : {};
  const signals = extractBundleSignals(bundle);
  const bundleStatus = stringValue(bundle.status, "missing");
  const summaryOverall = stringValue(summary.overall, "missing");
  const latestFreshness = stringValue(freshness.latestEvidenceFreshnessStatus, "missing");
  const versionMatch = expected.version === packageVersion && expected.releaseTag === releaseTag;
  const ready =
    bundleStatus === "ready" &&
    summaryOverall === "pass" &&
    latestFreshness === "fresh" &&
    requiredSignalKeys.every((key) => signals[key]?.status === "pass" || signals[key]?.status === "ready") &&
    versionMatch;

  return {
    key: "operationalEvidenceBundle",
    label: "operational evidence bundle",
    status: ready ? "pass" : "needs_live_evidence",
    actualStatus: `bundle.status=${bundleStatus}; summary.overall=${summaryOverall}; freshness=${latestFreshness}`,
    expectedStatus: "bundle.status=ready; summary.overall=pass; freshness=fresh",
    validatorCommand: command,
    evidenceHash: evidencePathHash(paths, "operationalEvidenceBundle"),
    residualRiskIds: stringArray(summary.residualRiskIds),
    freshness: {
      latestEvidenceFreshnessStatus: latestFreshness,
      signals: isRecord(freshness.signals) ? freshness.signals : {},
    },
    versionMatch,
    doesNotProve: [
      "missing signals are healthy",
      "bundle hash proves production health",
      "authenticated smoke passed when authenticatedSmoke is warn or unknown",
      "backup freshness when backup signal is unknown",
      "OPS-001 or OPS-004 residual closure",
    ],
    metadata: {
      bundleHash: stringValue(bundle.bundleHash, ""),
      bundleStatus,
      summaryOverall,
      latestEvidenceFreshnessStatus: latestFreshness,
      signals,
    },
  };
}

export function collectEvidencePaths(): EvidencePath[] {
  const inputs: Array<{ key: string; envKey: string; defaultPath?: string; includeMissingDefault?: boolean }> = [
    { key: "ops001SmokeRecord", envKey: "AREAFORGE_OPS001_SMOKE_RECORD" },
    { key: "ops001UpdateStatusRecord", envKey: "AREAFORGE_OPS001_UPDATE_STATUS_RECORD" },
    { key: "ops001EvidenceBundle", envKey: "AREAFORGE_OPS001_EVIDENCE_BUNDLE", defaultPath: defaultOperationalEvidenceBundle },
    { key: "ops001ClosurePacket", envKey: "AREAFORGE_OPS001_CLOSURE_PACKET" },
    { key: "ops001BlockedRecord", envKey: "AREAFORGE_OPS001_BLOCKED_RECORD" },
    { key: "ops004AlertPreview", envKey: "AREAFORGE_OPS004_ALERT_PREVIEW", defaultPath: defaultOps004AlertPreview },
    {
      key: "ops004AlertDrillRecord",
      envKey: "AREAFORGE_OPS004_ALERT_DRILL_RECORD",
      defaultPath: defaultOps004AlertDrillRecord,
      includeMissingDefault: true,
    },
    { key: "ops005ProductionEvidence", envKey: "AREAFORGE_OPS005_PRODUCTION_EVIDENCE_RECORD" },
    { key: "dataIntegrityRecord", envKey: "AREAFORGE_LONG_TERM_DATA_INTEGRITY_RECORD" },
    { key: "releaseEvidenceRecord", envKey: "AREAFORGE_RELEASE_EVIDENCE_RECORD", defaultPath: defaultReleaseEvidenceRecord },
    { key: "releaseSupplyChainRecord", envKey: "AREAFORGE_SC002_RELEASE_RECORD", defaultPath: defaultReleaseSupplyChainRecord },
    { key: "uxReviewRecord", envKey: "AREAFORGE_LONG_TERM_UX_RECORD" },
    { key: "operationalEvidenceBundle", envKey: "AREAFORGE_LONG_TERM_EVIDENCE_BUNDLE", defaultPath: defaultOperationalEvidenceBundle },
  ];
  const paths = inputs.map((input) => {
    const configuredPath = input.key === "uxReviewRecord"
      ? resolveProductExperienceReviewPath(process.cwd(), process.env[input.envKey]) ?? ""
      : process.env[input.envKey]?.trim() || input.defaultPath || "";
    if (!configuredPath) {
      return { key: input.key, pathLabel: null, configured: false, exists: false, sha256: null };
    }
    const absolutePath = path.resolve(configuredPath);
    const exists = existsSync(absolutePath);
    const configured = Boolean(process.env[input.envKey]?.trim()) || exists || Boolean(input.includeMissingDefault);
    return {
      key: input.key,
      pathLabel: pathLabel(configuredPath),
      configured,
      exists,
      sha256: exists ? `sha256:${sha256(readFileSync(absolutePath))}` : null,
    };
  });
  const releaseRecord = process.env.AREAFORGE_RELEASE_EVIDENCE_RECORD?.trim() || defaultReleaseEvidenceRecord;
  if (!existsSync(path.resolve(releaseRecord))) return paths;
  const validationArgs = resolveReleaseEvidenceValidationArgs(path.resolve(releaseRecord));
  for (const [index, evidencePath] of validationArgs.slice(1).entries()) {
    const exists = existsSync(evidencePath);
    paths.push({
      key: index === 0 ? "releaseAttachmentReconciliationCsv" : "releaseAttachmentReconciliationSummary",
      pathLabel: pathLabel(evidencePath),
      configured: true,
      exists,
      sha256: exists ? `sha256:${sha256(readFileSync(evidencePath))}` : null,
    });
  }
  return paths;
}

function runJsonCommand(command: string[], env: Record<string, string | undefined>): { ok: boolean; raw: string; body: JsonRecord | null } {
  const result = spawnSync(command[0] ?? "pnpm", command.slice(1), {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => Boolean(entry[1]))),
    },
  });
  const raw = result.stdout || result.stderr || "";
  try {
    const parsed = parseJsonFromLog(raw);
    return { ok: result.status === 0, raw, body: isRecord(parsed) ? parsed : null };
  } catch {
    return { ok: false, raw, body: null };
  }
}

function statusFromExpected(
  result: { ok: boolean; body: JsonRecord | null },
  actualStatus: string,
  expectedStatus: string,
): CheckStatus {
  if (!result.ok && actualStatus === "invalid") return "invalid";
  if (!result.body) return "invalid";
  if (actualStatus === expectedStatus) return "pass";
  if (actualStatus === "invalid") return "invalid";
  if (actualStatus === "needs_evidence" || actualStatus === "missing") return "missing";
  return "needs_live_evidence";
}

function missingCheck(key: string, label: string, command: string, residualRiskIds: string[]): SnapshotCheck {
  return {
    key,
    label,
    status: "missing",
    actualStatus: "missing",
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: null,
    residualRiskIds,
    freshness: { status: "unknown" },
    versionMatch: "not_applicable",
    doesNotProve: ["production health", "residual ledger closure"],
    metadata: {},
  };
}

function invalidCheck(
  key: string,
  label: string,
  command: string,
  detail: string,
  residualRiskIds: string[],
): SnapshotCheck {
  return {
    key,
    label,
    status: "invalid",
    actualStatus: "invalid",
    expectedStatus: "pass",
    validatorCommand: command,
    evidenceHash: null,
    residualRiskIds,
    freshness: { status: "unknown" },
    versionMatch: "not_applicable",
    doesNotProve: ["production health", "residual ledger closure"],
    metadata: { detail },
  };
}

function snapshotStatus(checks: SnapshotCheck[]): SnapshotStatus {
  if (checks.some((check) => check.status === "invalid")) return "invalid";
  if (checks.every((check) => check.status === "pass")) return "ready_for_long_term_operability_review";
  return "needs_live_evidence";
}

function snapshotNextCommand(status: SnapshotStatus, checks: SnapshotCheck[]): string {
  if (status === "ready_for_long_term_operability_review") {
    return "review residual close conditions without automatic closure";
  }
  const keys = checks.filter((check) => check.status !== "pass").map((check) => check.key);
  if (status === "invalid") return `fix invalid checks and rerun snapshot: ${keys.join(",")}`;
  return `collect or refresh evidence and rerun snapshot: ${keys.join(",")}`;
}

function extractBundleSignals(bundle: JsonRecord): Record<string, { status: string; freshnessStatus: string; evidence: string }> {
  const summary = isRecord(bundle.summary) ? bundle.summary : {};
  const summarySignals = isRecord(summary.signals) ? summary.signals : {};
  const freshness = isRecord(bundle.freshness) ? bundle.freshness : {};
  const freshnessSignals = isRecord(freshness.signals) ? freshness.signals : {};
  const signals: Record<string, { status: string; freshnessStatus: string; evidence: string }> = {};
  for (const key of requiredSignalKeys) {
    const signal = isRecord(summarySignals[key]) ? summarySignals[key] : {};
    const signalFreshness = isRecord(freshnessSignals[key]) ? freshnessSignals[key] : {};
    signals[key] = {
      status: stringValue(signal.status, "missing"),
      freshnessStatus: stringValue(signalFreshness.status, "unknown"),
      evidence: stringValue(signal.evidence, ""),
    };
  }
  return signals;
}

function parseFieldsIfExists(filePath: string): Map<string, string> {
  const absolutePath = path.resolve(filePath);
  if (!existsSync(absolutePath)) return new Map<string, string>();
  return parseIndentedKeyValueRecord(readFileSync(absolutePath, "utf8"));
}

function parseIndentedKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentSection = "";
  for (const rawLine of record.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const key = match[2] ?? "";
    const value = match[3]?.trim() ?? "";
    if (indent === 0) {
      currentSection = value ? "" : key;
      fields.set(key, value);
    } else if (currentSection) {
      fields.set(`${currentSection}.${key}`, value);
    }
  }
  return fields;
}

function commandEvidenceHash(raw: string, paths: EvidencePath[], keys: string[]): string {
  const pathHashes = keys.map((key) => [key, evidencePathHash(paths, key)]).filter(([, value]) => value);
  return `sha256:${sha256(JSON.stringify({ raw: sanitizeOutput(raw), pathHashes }))}`;
}

function evidencePathHash(paths: EvidencePath[], key: string): string | null {
  return paths.find((item) => item.key === key)?.sha256 ?? null;
}

function envOrExisting(envKey: string, fallbackPath: string): string | undefined {
  const explicit = process.env[envKey]?.trim();
  if (explicit) return explicit;
  return existsSync(path.resolve(fallbackPath)) ? fallbackPath : undefined;
}

function parseJsonFromLog(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const jsonLine = [...raw.split(/\r?\n/)]
    .reverse()
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) throw new Error("output does not contain JSON");
  return JSON.parse(jsonLine);
}

function ageInDays(value: string): number {
  const reviewedAt = new Date(value);
  if (Number.isNaN(reviewedAt.getTime())) return Number.NaN;
  return Math.max(0, (now().getTime() - reviewedAt.getTime()) / 86_400_000);
}

function ageInHours(value: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return Math.max(0, (now().getTime() - date.getTime()) / 3_600_000);
}

function signedAgeInHours(value: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return (now().getTime() - date.getTime()) / 3_600_000;
}

function maxUxAgeDays(): number {
  const raw = process.env.AREAFORGE_LONG_TERM_UX_MAX_AGE_DAYS;
  if (!raw) return defaultMaxUxAgeDays;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxUxAgeDays;
}

function maxDataIntegrityAgeHours(): number {
  const raw = process.env.AREAFORGE_LONG_TERM_DATA_INTEGRITY_MAX_AGE_HOURS;
  if (!raw) return defaultMaxDataIntegrityAgeHours;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMaxDataIntegrityAgeHours;
}

function expectedVersion(): string {
  const raw = process.env.AREAFORGE_LONG_TERM_EXPECTED_VERSION?.trim();
  if (raw) return raw;
  const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : "0.1.7";
}

function now(): Date {
  const raw = process.env.AREAFORGE_LONG_TERM_SNAPSHOT_NOW?.trim();
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function pathLabel(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("docs/") || normalized.startsWith("scripts/") || normalized.startsWith("ops/")) {
    return normalized;
  }
  return path.basename(normalized) || "<record>";
}

function shouldFail(status: SnapshotStatus, failOn: string | undefined): boolean {
  if (!failOn) return false;
  const order: SnapshotStatus[] = ["ready_for_long_term_operability_review", "needs_live_evidence", "invalid"];
  const threshold = order.includes(failOn as SnapshotStatus) ? failOn as SnapshotStatus : "invalid";
  return order.indexOf(status) >= order.indexOf(threshold);
}

function hashSnapshot(snapshot: LongTermEvidenceSnapshot): string {
  return sha256(stableStringify({ ...snapshot, snapshotHash: "" }));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringArrayFromCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function hashFieldStatus(value: string | undefined, allowSha256Prefix = false): "valid_sha256" | "not_copied_root_only" | "missing_or_invalid" {
  const pattern = allowSha256Prefix ? /^(sha256:)?[a-f0-9]{64}$/i : /^[a-f0-9]{64}$/i;
  if (value && pattern.test(value)) return "valid_sha256";
  if (value && /root-only|not-copied/i.test(value)) return "not_copied_root_only";
  return "missing_or_invalid";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>")
    .replace(/\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/g, "<redacted-token>")
    .replace(/COSIGN_PASSWORD\s*=\s*\S+/gi, "COSIGN_PASSWORD=<redacted>")
    .replace(/\/[^\s:]+/g, "<redacted-path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
