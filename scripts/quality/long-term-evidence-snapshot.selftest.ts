import { createHash } from "node:crypto";
import { protectedPathFiles } from "../ops/operability-status";
import { validateLongTermEvidenceSnapshot } from "./long-term-evidence-snapshot-validate";

type JsonRecord = Record<string, unknown>;

function main(): void {
  const readySnapshot = withHash(buildSnapshot("ready_for_long_term_operability_review"));
  const readyIssues = validateLongTermEvidenceSnapshot(JSON.stringify(readySnapshot, null, 2));
  assert(readyIssues.length === 0, `expected ready snapshot to pass, got ${JSON.stringify(readyIssues)}`);

  const needsEvidenceSnapshot = withHash({
    ...buildSnapshot("needs_live_evidence"),
    checks: buildChecks({ ops001Status: "missing", ops001Actual: "needs_evidence" }),
  });
  const needsEvidenceIssues = validateLongTermEvidenceSnapshot(JSON.stringify(needsEvidenceSnapshot, null, 2));
  assert(needsEvidenceIssues.length === 0, `expected needs-evidence snapshot to validate, got ${JSON.stringify(needsEvidenceIssues)}`);

  const tampered = { ...readySnapshot, snapshotHash: "0".repeat(64) };
  const tamperedIssues = validateLongTermEvidenceSnapshot(JSON.stringify(tampered, null, 2));
  assert(tamperedIssues.some((issue) => issue.field === "snapshotHash"), "expected tampered hash to fail");

  const badProtectedHash = withHash(withPatch(readySnapshot, (body) => {
    protectedFingerprint(body).hash = "not-a-hash";
  }));
  const badProtectedHashIssues = validateLongTermEvidenceSnapshot(JSON.stringify(badProtectedHash, null, 2));
  assert(
    badProtectedHashIssues.some((issue) => issue.field === "sourceSnapshot.protectedPathFingerprint.hash"),
    "expected bad protected path fingerprint hash to fail",
  );

  const missingProtectedPath = withHash(withPatch(readySnapshot, (body) => {
    protectedFingerprint(body).paths = ["README.md"];
  }));
  const missingProtectedPathIssues = validateLongTermEvidenceSnapshot(JSON.stringify(missingProtectedPath, null, 2));
  assert(
    missingProtectedPathIssues.some((issue) => issue.field === "sourceSnapshot.protectedPathFingerprint.paths"),
    "expected missing protected path to fail",
  );

  const greenwashed = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({ ops001Status: "pass", ops001Actual: "needs_evidence" }),
  });
  const greenwashIssues = validateLongTermEvidenceSnapshot(JSON.stringify(greenwashed, null, 2));
  assert(greenwashIssues.some((issue) => issue.field === "checks.ops001.status"), "expected OPS-001 greenwash to fail");

  const missingSignal = withHash({
    ...buildSnapshot("ready_for_long_term_operability_review"),
    checks: buildChecks({ omitSignal: "backup" }),
  });
  const missingSignalIssues = validateLongTermEvidenceSnapshot(JSON.stringify(missingSignal, null, 2));
  assert(
    missingSignalIssues.some((issue) => issue.field === "checks.operationalEvidenceBundle.metadata.signals"),
    "expected missing operational signal to fail",
  );

  const leaked = JSON.stringify({
    ...readySnapshot,
    metadata: "DATABASE_URL=postgresql://user:pass@example.invalid/db",
  }, null, 2);
  const leakedIssues = validateLongTermEvidenceSnapshot(leaked);
  assert(leakedIssues.some((issue) => issue.field === "record"), "expected secret-like value to fail");

  console.log("PASS long-term evidence snapshot validator selftest");
}

function buildSnapshot(status: "ready_for_long_term_operability_review" | "needs_live_evidence"): JsonRecord {
  return {
    schemaVersion: 1,
    mode: "read_only_long_term_evidence_snapshot",
    generatedAt: "2026-07-12T12:30:00.000Z",
    snapshotHash: "",
    expectedVersion: "0.1.7",
    releaseTag: "v0.1.7",
    packageVersion: "0.1.7",
    scope: "long_term_operability_current_checkout",
    status,
    sourceSnapshot: {
      controlPlaneSourceHash: "1".repeat(64),
      protectedPathFingerprint: protectedPathFingerprint(),
      files: [
        "docs/development/long-term-operability-control-plane.md",
        "scripts/ops/long-term-evidence-snapshot.ts",
      ],
      missingFiles: [],
      evidencePaths: [
        evidencePath("releaseEvidenceRecord"),
        evidencePath("releaseSupplyChainRecord"),
        evidencePath("uxReviewRecord"),
        evidencePath("operationalEvidenceBundle"),
        evidencePath("ops004AlertPreview"),
      ],
      inputHashes: [
        inputHash("releaseEvidenceRecord"),
        inputHash("releaseSupplyChainRecord"),
        inputHash("uxReviewRecord"),
        inputHash("operationalEvidenceBundle"),
        inputHash("ops004AlertPreview"),
      ],
    },
    checks: buildChecks({}),
    doesNotProve: [
      "current production health without post-version live smoke and update-agent evidence",
      "OPS-001 closure or residual ledger closure",
      "OPS-004 alert recovery drill completion or residual ledger closure",
      "release evidence record validation when backup hashes are root-only or missing",
      "backup freshness, restore execution, migration execution, or rollback execution",
      "server updater apply completion for a future release",
      "GitHub Release creation or release asset download",
      "production write smoke safety",
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
  };
}

function protectedPathFingerprint(): JsonRecord {
  return {
    algorithm: "sha256",
    scope: "read_only_side_effect_guard_inputs",
    paths: [...protectedPathFiles],
    hash: "9".repeat(64),
    doesNotProve: [
      "production health",
      "absence of changes outside protected paths",
      "git worktree cleanliness",
    ],
  };
}

function withPatch(snapshot: JsonRecord, patch: (body: JsonRecord) => void): JsonRecord {
  const cloned = JSON.parse(JSON.stringify(snapshot)) as JsonRecord;
  patch(cloned);
  return cloned;
}

function protectedFingerprint(snapshot: JsonRecord): JsonRecord {
  const sourceSnapshot = snapshot.sourceSnapshot as JsonRecord;
  return sourceSnapshot.protectedPathFingerprint as JsonRecord;
}

function buildChecks(options: {
  ops001Status?: string;
  ops001Actual?: string;
  omitSignal?: string;
}): JsonRecord[] {
  const ops001Status = options.ops001Status ?? "pass";
  const ops001Actual = options.ops001Actual ?? "ready_for_human_close";
  return [
    check("controlPlane", "enterprise operability control plane", "pass", "pass", "pass", [], "sha256:1010101010101010101010101010101010101010101010101010101010101010"),
    check("ops001", "OPS-001 production read-only smoke and update-agent evidence", ops001Status, ops001Actual, "ready_for_human_close", ["AF-RISK-OPS-001"], "sha256:2020202020202020202020202020202020202020202020202020202020202020"),
    check("ops004", "OPS-004 alert and recovery drill evidence", "pass", "ready_for_human_close", "ready_for_human_close", ["AF-RISK-OPS-004"], "sha256:3030303030303030303030303030303030303030303030303030303030303030"),
    {
      ...check(
        "releaseEvidenceRecord",
        "production release evidence record",
        "pass",
        "pass",
        "pass",
        ["AF-RISK-OPS-001", "AF-RISK-OPS-004", "AF-RISK-REL-001"],
        "sha256:7070707070707070707070707070707070707070707070707070707070707070",
      ),
      versionMatch: true,
      metadata: {
        releaseTag: "v0.1.7",
        releaseEvidenceBundleHashStatus: "valid_sha256",
        databaseBackupSha256Status: "valid_sha256",
        uploadsBackupSha256Status: "valid_sha256",
        envBackupSha256Status: "valid_sha256",
      },
    },
    check("supplyChain", "signed Release supply-chain evidence", "pass", "ready_for_sc001_sc002_review", "ready_for_sc001_sc002_review", ["AF-RISK-SC-001", "AF-RISK-SC-002"], "sha256:4040404040404040404040404040404040404040404040404040404040404040"),
    {
      ...check("uxReview", "fresh desktop/mobile product experience review", "pass", "pass", "pass", ["AF-RISK-UX-001"], "sha256:5050505050505050505050505050505050505050505050505050505050505050"),
      freshness: { reviewedAt: "2026-07-12T12:00:00Z", ageDays: 0, maxAgeDays: 14, status: "fresh" },
      versionMatch: true,
    },
    {
      ...check(
        "operationalEvidenceBundle",
        "operational evidence bundle",
        "pass",
        "bundle.status=ready; summary.overall=pass; freshness=fresh",
        "bundle.status=ready; summary.overall=pass; freshness=fresh",
        ["AF-RISK-OPS-001", "AF-RISK-OPS-004"],
        "sha256:6060606060606060606060606060606060606060606060606060606060606060",
      ),
      freshness: {
        latestEvidenceFreshnessStatus: "fresh",
        signals: {},
      },
      versionMatch: true,
      metadata: {
        bundleHash: "7".repeat(64),
        bundleStatus: "ready",
        summaryOverall: "pass",
        latestEvidenceFreshnessStatus: "fresh",
        signals: bundleSignals(options.omitSignal),
      },
    },
  ];
}

function check(
  key: string,
  label: string,
  status: string,
  actualStatus: string,
  expectedStatus: string,
  residualRiskIds: string[],
  evidenceHash: string,
): JsonRecord {
  return {
    key,
    label,
    status,
    actualStatus,
    expectedStatus,
    validatorCommand: `pnpm exec tsx validator-for-${key}.ts`,
    evidenceHash,
    residualRiskIds,
    freshness: { source: "selftest" },
    versionMatch: "not_applicable",
    doesNotProve: ["production health", "residual ledger closure"],
    metadata: {},
  };
}

function bundleSignals(omitSignal?: string): JsonRecord {
  const signals: JsonRecord = {};
  for (const key of [
    "health",
    "releaseIdentity",
    "updateAgent",
    "authenticatedSmoke",
    "backup",
    "rollback",
    "infrastructure",
  ]) {
    if (key === omitSignal) continue;
    signals[key] = {
      status: "pass",
      freshnessStatus: "fresh",
      evidence: `${key} selftest evidence`,
    };
  }
  return signals;
}

function evidencePath(key: string): JsonRecord {
  return {
    key,
    pathLabel: `docs/development/${key}.json`,
    configured: true,
    exists: true,
    sha256: `sha256:${"8".repeat(64)}`,
  };
}

function inputHash(key: string): JsonRecord {
  return {
    key,
    pathLabel: `docs/development/${key}.json`,
    sha256: `sha256:${"8".repeat(64)}`,
  };
}

function withHash(snapshot: JsonRecord): JsonRecord {
  return {
    ...snapshot,
    snapshotHash: hashSnapshot(snapshot),
  };
}

function hashSnapshot(snapshot: JsonRecord): string {
  return createHash("sha256").update(stableStringify({ ...snapshot, snapshotHash: "" })).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main();
