import { createHash } from "node:crypto";
import { validateBundle } from "./operational-evidence-bundle-validate";

type JsonRecord = Record<string, unknown>;

function main(): void {
  const bundle = buildBundle();
  const validIssues = validateBundle(JSON.stringify(withHash(bundle), null, 2));
  assert(validIssues.length === 0, `expected valid bundle, got ${JSON.stringify(validIssues)}`);

  const tampered = { ...withHash(bundle), bundleHash: "0".repeat(64) };
  const tamperedIssues = validateBundle(JSON.stringify(tampered, null, 2));
  assert(tamperedIssues.some((issue) => issue.field === "bundleHash"), "expected tampered hash to fail");

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
  const leakedIssues = validateBundle(leaked);
  assert(leakedIssues.some((issue) => issue.field === "record"), "expected secret-like value to fail");

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
    status: "needs_attention",
    mode: "read_only_operational_evidence_bundle",
    bundleHash: "",
    generatedAt: "2026-07-10T00:00:00.000Z",
    summary,
    freshness: summary.freshness,
    items: requiredSignalItems(),
    capabilities: [
      "collect_read_only_operational_readiness_summary",
      "assemble_signal_evidence_index",
      "map_residual_risk_ids_to_required_evidence",
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
