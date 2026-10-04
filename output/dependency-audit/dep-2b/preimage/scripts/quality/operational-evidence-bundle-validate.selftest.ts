import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateBundle } from "./operational-evidence-bundle-validate";
import { buildOperationalEvidenceSourceSnapshot } from "./operational-evidence-source";

type JsonRecord = Record<string, unknown>;

function main(): void {
  const bundle = buildBundle();
  const options = { now: new Date("2026-07-10T00:00:00.000Z") };
  const validIssues = validateBundle(JSON.stringify(withHash(bundle), null, 2), options);
  assert(validIssues.length === 0, `expected valid bundle, got ${JSON.stringify(validIssues)}`);

  const tampered = { ...withHash(bundle), bundleHash: "0".repeat(64) };
  const tamperedIssues = validateBundle(JSON.stringify(tampered, null, 2), options);
  assert(tamperedIssues.some((issue) => issue.field === "bundleHash"), "expected tampered hash to fail");

  const readyWithUnknownFreshness = withHash({
    ...bundle,
    status: "ready",
  });
  const readyWithUnknownFreshnessIssues = validateBundle(JSON.stringify(readyWithUnknownFreshness, null, 2), options);
  assert(readyWithUnknownFreshnessIssues.some((issue) => issue.field === "status"), "expected ready bundle with unknown freshness to fail");

  const mismatchedFreshness = withHash({
    ...bundle,
    freshness: {
      ...(bundle.freshness as JsonRecord),
      latestEvidenceFreshnessStatus: "fresh",
    },
  });
  const mismatchedFreshnessIssues = validateBundle(JSON.stringify(mismatchedFreshness, null, 2), options);
  assert(mismatchedFreshnessIssues.some((issue) => issue.field === "freshness"), "expected mismatched freshness to fail");

  const missingFreshnessSignal = structuredClone(bundle);
  delete (((missingFreshnessSignal.summary as JsonRecord).freshness as JsonRecord).signals as JsonRecord).rollback;
  delete ((missingFreshnessSignal.freshness as JsonRecord).signals as JsonRecord).rollback;
  const missingFreshnessSignalIssues = validateBundle(JSON.stringify(withHash(missingFreshnessSignal), null, 2), options);
  assert(
    missingFreshnessSignalIssues.some((issue) => issue.field === "summary.freshness.signals" || issue.field === "freshness.signals"),
    "expected missing freshness signal to fail",
  );

  const invalidSource = structuredClone(bundle);
  const fileInputs = ((invalidSource.sourceSnapshot as JsonRecord).fileInputs as JsonRecord[]);
  fileInputs[0].envKey = "AREAFORGE_READINESS_SMOKE_RESULT_FILE";
  const invalidSourceIssues = validateBundle(JSON.stringify(withHash(invalidSource)), { ...options, shapeOnly: true });
  assert(invalidSourceIssues.some((issue) => issue.field.endsWith(".envKey")), "expected mismatched source key/env binding to fail");

  const leaked = JSON.stringify({
    ...withHash(bundle),
    items: [
      ...(withHash(bundle).items as unknown[]),
      {
        key: "signal:leak",
        category: "leak",
        status: "ready",
        source: "selftest",
        description: "leak",
        evidence: "DATABASE_URL=postgresql://user:pass@localhost/db",
        residualRiskIds: [],
        requiredEvidence: ["none"],
        metadata: {},
      },
    ],
  }, null, 2);
  const leakedIssues = validateBundle(leaked, options);
  assert(leakedIssues.some((issue) => issue.field === "record"), "expected secret-like value to fail");

  const expiredIssues = validateBundle(JSON.stringify(withHash(bundle)), { now: new Date("2026-07-25T00:00:01.000Z") });
  assert(expiredIssues.some((issue) => issue.field.startsWith("bindingStatus")), "expected an old bundle to fail current freshness binding");

  testCurrentSourceBinding(bundle, options.now);
  testHistoricalShapeOnly(bundle, options.now);

  console.log("PASS operational evidence bundle validator selftest");
}

function buildBundle(): JsonRecord {
  const summary = {
    checkedAt: "2026-07-10T00:00:00.000Z",
    environment: "production",
    scope: "daily",
    baseUrl: "https://forge.areasong.top",
    safetyFacts: {
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      smokePasswordReadFromFile: false,
      networkRequested: true,
    },
    expected: {
      version: "0.1.5",
      releaseTag: "v0.1.5",
      autoApply: "none",
    },
    signals: {},
    freshness: {
      maxAgeSeconds: 1209600,
      latestEvidenceFreshnessStatus: "unknown",
      signals: {
        health: { checkedAt: "2026-07-10T00:00:00.000Z", ageSeconds: 0, status: "fresh" },
        releaseIdentity: { checkedAt: null, ageSeconds: null, status: "unknown" },
        updateAgent: { checkedAt: null, ageSeconds: null, status: "unknown" },
        authenticatedSmoke: { checkedAt: null, ageSeconds: null, status: "unknown" },
        backup: { checkedAt: null, ageSeconds: null, status: "unknown" },
        rollback: { checkedAt: null, ageSeconds: null, status: "unknown" },
        infrastructure: { checkedAt: null, ageSeconds: null, status: "unknown" },
      },
    },
    residualRiskIds: ["AF-RISK-OPS-001"],
    overall: "warn",
  };
  return {
    schemaVersion: 2,
    status: "needs_attention",
    mode: "read_only_operational_evidence_bundle",
    bundleHash: "",
    generatedAt: "2026-07-10T00:00:00.000Z",
    sourceSnapshot: buildOperationalEvidenceSourceSnapshot(),
    summary,
    freshness: summary.freshness,
    items: requiredSignalItems(),
    capabilities: [
      "collect_read_only_operational_readiness_summary",
      "assemble_signal_evidence_index",
      "map_residual_risk_ids_to_required_evidence",
      "bind_current_source_inputs",
      "compute_bundle_hash",
    ],
    doesNotProve: [
      "current production health without all required live signals",
      "updater apply completion",
      "backup, restore, migration, or rollback execution",
      "GitHub Release creation",
      "residual risk closure",
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
    ],
    safetyFacts: {
      ...summary.safetyFacts,
      productionDeployAttempted: false,
      updaterApplyAttempted: false,
      rollbackAttempted: false,
      secretFileContentIncluded: false,
    },
  };
}

function testCurrentSourceBinding(bundle: JsonRecord, now: Date): void {
  const directory = mkdtempSync(path.join(tmpdir(), "areaforge-operational-bundle-"));
  const statusFile = path.join(directory, "status.json");
  const targetFile = path.join(directory, "target.json");
  const env = { ...process.env, AREAFORGE_READINESS_UPDATE_STATUS_FILE: statusFile };
  try {
    writeFileSync(statusFile, '{"currentVersion":"0.1.7"}\n');
    writeFileSync(targetFile, '{"currentVersion":"0.1.8"}\n');
    const current = withHash({
      ...bundle,
      sourceSnapshot: buildOperationalEvidenceSourceSnapshot({ env }),
    });
    assert(validateBundle(JSON.stringify(current), { env, now }).length === 0, "current source-bound bundle should validate");

    writeFileSync(statusFile, '{"currentVersion":"0.1.8"}\n');
    const changed = validateBundle(JSON.stringify(current), { env, now });
    assert(changed.some((issue) => issue.field === "bindingStatus"), "changed evidence input must make the bundle stale");
    assert(validateBundle(JSON.stringify(current), { env, now, shapeOnly: true }).length === 0, "shape-only must preserve a historical v2 bundle");

    rmSync(statusFile);
    const deleted = validateBundle(JSON.stringify(current), { env, now });
    assert(deleted.some((issue) => issue.field === "bindingStatus"), "deleted evidence input must make the bundle stale");

    symlinkSync(targetFile, statusFile);
    const linked = validateBundle(JSON.stringify(current), { env, now });
    assert(linked.some((issue) => issue.field === "bindingStatus"), "symlink replacement must make the bundle stale");
    const unsafe = withHash({ ...bundle, sourceSnapshot: buildOperationalEvidenceSourceSnapshot({ env }) });
    const unsafeIssues = validateBundle(JSON.stringify(unsafe), { env, now, shapeOnly: true });
    assert(unsafeIssues.some((issue) => issue.field.endsWith(".fileKind")), "a bundle generated from a symlink evidence input must fail shape validation");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function testHistoricalShapeOnly(bundle: JsonRecord, now: Date): void {
  const legacy = structuredClone(bundle);
  delete legacy.schemaVersion;
  delete legacy.sourceSnapshot;
  legacy.capabilities = (legacy.capabilities as string[]).filter((item) => item !== "bind_current_source_inputs");
  const record = withHash(legacy);
  const currentIssues = validateBundle(JSON.stringify(record), { now });
  assert(currentIssues.some((issue) => issue.field === "schemaVersion"), "legacy bundle must fail default current validation");
  assert(validateBundle(JSON.stringify(record), { now, shapeOnly: true }).length === 0, "legacy bundle should remain available for explicit shape-only validation");
}

function requiredSignalItems(): JsonRecord[] {
  return [
    "health",
    "releaseIdentity",
    "updateAgent",
    "authenticatedSmoke",
    "backup",
    "rollback",
    "infrastructure",
  ].map((key) => ({
    key: `signal:${key}`,
    category: key,
    status: key === "health" ? "ready" : "needs_attention",
    source: "selftest",
    description: `${key} evidence`,
    evidence: `${key} evidence is redacted`,
    residualRiskIds: key === "health" ? [] : ["AF-RISK-OPS-001"],
    requiredEvidence: [`${key} required evidence`],
    metadata: {},
  }));
}

function withHash(bundle: JsonRecord): JsonRecord {
  return {
    ...bundle,
    bundleHash: hashBundle(bundle),
  };
}

function hashBundle(bundle: JsonRecord): string {
  return createHash("sha256").update(stableStringify({ ...bundle, bundleHash: "" })).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

main();
