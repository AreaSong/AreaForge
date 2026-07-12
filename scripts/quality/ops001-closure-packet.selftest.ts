import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ops001-closure-"));

try {
  const smokeRecord = path.join(tempDir, "prod-readonly-smoke-record.txt");
  const updateStatusRecord = path.join(tempDir, "redacted-update-status.json");
  const evidenceBundle = path.join(tempDir, "operational-evidence-bundle.json");
  const closurePacket = path.join(tempDir, "ops-001-closure-packet.txt");

  writeFileSync(smokeRecord, createSmokeRecord());
  writeFileSync(updateStatusRecord, JSON.stringify(createUpdateStatusRecord(), null, 2));
  writeFileSync(evidenceBundle, JSON.stringify(withBundleHash(createEvidenceBundle()), null, 2));

  const generate = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-ops001-closure-packet.ts", smokeRecord, updateStatusRecord, evidenceBundle], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("generate OPS-001 closure packet", generate, 0);
  writeFileSync(closurePacket, generate.stdout);

  const validate = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ops001-closure-packet-validate.ts", closurePacket], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate generated OPS-001 closure packet", validate, 0);
  if (!validate.stdout.includes("ops001ClosurePacketEvidenceHash: sha256:")) {
    fail("closure packet validation hash missing");
  }

  const invalidPacket = path.join(tempDir, "ops-001-closure-packet-invalid.txt");
  writeFileSync(invalidPacket, generate.stdout.replace("smokePasswordReadFromFile: yes", "smokePasswordReadFromFile: no"));
  const invalidValidate = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ops001-closure-packet-validate.ts", invalidPacket], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("invalid closure packet fails", invalidValidate, 1);

  const historicalPacket = path.join(tempDir, "ops-001-closure-packet-historical.txt");
  writeFileSync(
    historicalPacket,
    generate.stdout
      .replace("expectedVersion: 0.1.7", "expectedVersion: 0.1.5")
      .replace("releaseTag: v0.1.7", "releaseTag: v0.1.5")
      .replace("updateAgentCurrentVersion: 0.1.7", "updateAgentCurrentVersion: 0.1.5"),
  );
  const historicalDefaultValidate = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ops001-closure-packet-validate.ts", historicalPacket], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("historical closure packet fails by default", historicalDefaultValidate, 1);

  const historicalOverrideValidate = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/ops001-closure-packet-validate.ts", historicalPacket], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_OPS001_EXPECTED_VERSION: "0.1.5",
    },
  });
  expectStatus("historical closure packet passes with explicit version override", historicalOverrideValidate, 0);

  console.log("OPS-001 closure packet selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function createSmokeRecord(): string {
  return [
    "recordId: prod-readonly-smoke-20260710222000",
    "checkedAt: 2026-07-10T22:20:00+08:00",
    "environment: production",
    "baseUrl: https://forge.areasong.top",
    "expectedVersion: 0.1.7",
    "releaseTag: v0.1.7",
    "webImageDigest: ghcr.io/areasong/areaforge-web:v0.1.7@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "migrationImageDigest: ghcr.io/areasong/areaforge-migration:v0.1.7@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "smokeCommand: pnpm smoke:prod-readonly",
    "smokeStatus: pass",
    "smokeResultHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "checks: health,login,auth/me,dashboard,notes,syllabus,analytics,reports,long-term-risks,update-status",
    "smokePasswordSource: AREAFORGE_SMOKE_PASSWORD_FILE=<redacted path>",
    "smokePasswordReadFromFile: yes",
    "updateStatusIncluded: yes",
    "updaterEnvSummary: AREAFORGE_EXTRA_SMOKE_COMMAND configured, password file path redacted",
    "updateRecordSummary: update-record hash sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "residualRiskIds: AF-RISK-OPS-001",
    "followUpTasks: tasks/indexes/residuals.md",
    "safetyFacts:",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  productionWriteAttempted: no",
    "  secretValuePrinted: no",
    "  passwordValuePrinted: no",
    "  writeSmokeAttempted: no",
    "",
  ].join("\n");
}

function createUpdateStatusRecord(): JsonRecord {
  return {
    currentVersion: "0.1.7",
    currentImage: "ghcr.io/areasong/areaforge-web:v0.1.7@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    releaseUrl: "https://github.com/AreaSong/AreaForge/releases/tag/v0.1.7",
    latestVersion: "0.1.7",
    updateAvailable: false,
    autoApply: "none",
    signatureRequired: true,
    timerEnabled: true,
    timerActive: true,
    lastCheckedAt: "2026-07-10T22:20:00+08:00",
    blocker: null,
    rollback: {
      available: true,
      targetVersion: "0.1.4",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.4@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    },
    statusUpdatedAt: "2026-07-10T22:20:00+08:00",
    safetyFacts: {
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      updaterApplyAttempted: false,
    },
  };
}

function createEvidenceBundle(): JsonRecord {
  const summary = {
    checkedAt: "2026-07-10T14:20:00.000Z",
    environment: "production",
    scope: "daily",
    baseUrl: "https://forge.areasong.top",
    safetyFacts: {
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      smokePasswordReadFromFile: true,
      networkRequested: true,
    },
    expected: {
      version: "0.1.7",
      releaseTag: "v0.1.7",
      autoApply: "none",
    },
    signals: {},
    freshness: createFreshness(),
    residualRiskIds: ["AF-RISK-OPS-001"],
    overall: "warn",
  };
  return {
    status: "needs_attention",
    mode: "read_only_operational_evidence_bundle",
    bundleHash: "",
    generatedAt: "2026-07-10T14:20:00.000Z",
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
    status: key === "backup" || key === "infrastructure" ? "needs_attention" : "ready",
    source: "selftest",
    description: `${key} evidence`,
    evidence: `${key} evidence is redacted`,
    residualRiskIds: key === "backup" || key === "infrastructure" ? ["AF-RISK-OPS-004"] : [],
    requiredEvidence: [`${key} required evidence`],
    metadata: {},
  }));
}

function createFreshness(): JsonRecord {
  return {
    maxAgeSeconds: 1209600,
    latestEvidenceFreshnessStatus: "fresh",
    signals: {
      health: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
      releaseIdentity: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
      updateAgent: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
      authenticatedSmoke: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
      backup: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
      rollback: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
      infrastructure: { checkedAt: "2026-07-10T14:20:00.000Z", ageSeconds: 0, status: "fresh" },
    },
  };
}

function withBundleHash(bundle: JsonRecord): JsonRecord {
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

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected exit ${expected}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}
