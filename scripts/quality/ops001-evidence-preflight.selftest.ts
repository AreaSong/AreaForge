import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ops001-preflight-"));

try {
  const noEvidence = runPreflight({}, 0);
  assertJsonStatus(noEvidence.stdout, "needs_evidence");

  const smokeRecord = path.join(tempDir, "prod-readonly-smoke-record.txt");
  const updateStatusRecord = path.join(tempDir, "redacted-update-status.json");
  const evidenceBundle = path.join(tempDir, "operational-evidence-bundle.json");
  const closurePacket = path.join(tempDir, "ops-001-closure-packet.txt");
  const blockedRecord = path.join(tempDir, "ops001-blocked-record.txt");

  writeFileSync(smokeRecord, createSmokeRecord());
  writeFileSync(updateStatusRecord, JSON.stringify(createUpdateStatusRecord(), null, 2));
  writeFileSync(evidenceBundle, JSON.stringify(withBundleHash(createEvidenceBundle()), null, 2));
  writeFileSync(blockedRecord, createBlockedRecord());

  const readyToGenerate = runPreflight({
    AREAFORGE_OPS001_SMOKE_RECORD: smokeRecord,
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: updateStatusRecord,
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: evidenceBundle,
  }, 0);
  assertJsonStatus(readyToGenerate.stdout, "ready_to_generate_packet");
  assertSmokeFreshness(readyToGenerate.stdout, "fresh");

  const generate = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-ops001-closure-packet.ts", smokeRecord, updateStatusRecord, evidenceBundle], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_SMOKE_PROOF_NOW: "2026-07-10T14:30:00.000Z",
    },
  });
  expectStatus("generate OPS-001 closure packet", generate, 0);
  writeFileSync(closurePacket, generate.stdout);

  const readyForClose = runPreflight({
    AREAFORGE_OPS001_SMOKE_RECORD: smokeRecord,
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: updateStatusRecord,
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: evidenceBundle,
    AREAFORGE_OPS001_CLOSURE_PACKET: closurePacket,
  }, 0);
  assertJsonStatus(readyForClose.stdout, "ready_for_human_close");

  const closureWithoutBaseEvidence = runPreflight({
    AREAFORGE_OPS001_CLOSURE_PACKET: closurePacket,
  }, 1);
  assertJsonStatus(closureWithoutBaseEvidence.stdout, "invalid");

  const blocked = runPreflight({
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: updateStatusRecord,
    AREAFORGE_OPS001_BLOCKED_RECORD: blockedRecord,
  }, 0);
  assertJsonStatus(blocked.stdout, "blocked_on_prerequisite");

  const invalidSmoke = path.join(tempDir, "invalid-smoke-record.txt");
  const staleSmoke = path.join(tempDir, "stale-smoke-record.txt");
  writeFileSync(invalidSmoke, createSmokeRecord().replace("smokeStatus: pass", "smokeStatus: fail"));
  writeFileSync(staleSmoke, createSmokeRecord());
  const invalid = runPreflight({
    AREAFORGE_OPS001_SMOKE_RECORD: invalidSmoke,
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: updateStatusRecord,
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: evidenceBundle,
  }, 1);
  assertJsonStatus(invalid.stdout, "invalid");

  const stale = runPreflight({
    AREAFORGE_OPS001_SMOKE_RECORD: staleSmoke,
    AREAFORGE_OPS001_UPDATE_STATUS_RECORD: updateStatusRecord,
    AREAFORGE_OPS001_EVIDENCE_BUNDLE: evidenceBundle,
    AREAFORGE_SMOKE_PROOF_NOW: "2026-07-12T14:20:01.000Z",
  }, 1);
  assertJsonStatus(stale.stdout, "invalid");

  console.log("OPS-001 evidence preflight selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function assertSmokeFreshness(raw: string, expected: string): void {
  const parsed = JSON.parse(raw) as JsonRecord;
  const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  const smoke = evidence.find((item) => isRecord(item) && item.key === "productionReadonlySmokeRecord") as JsonRecord | undefined;
  const freshness = isRecord(smoke?.freshness) ? smoke.freshness : {};
  if (freshness.status !== expected) {
    fail(`expected smoke freshness ${expected}, got ${String(freshness.status)}`);
  }
}

function runPreflight(env: Record<string, string>, expectedStatus: number): ReturnType<typeof spawnSync> {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/ops001-evidence-preflight.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_OPS001_SMOKE_RECORD: "",
      AREAFORGE_OPS001_UPDATE_STATUS_RECORD: "",
      AREAFORGE_OPS001_EVIDENCE_BUNDLE: "",
      AREAFORGE_OPS001_CLOSURE_PACKET: "",
      AREAFORGE_OPS001_BLOCKED_RECORD: "",
      AREAFORGE_SMOKE_PROOF_NOW: "2026-07-10T14:30:00.000Z",
      ...env,
    },
  });
  expectStatus("OPS-001 evidence preflight", result, expectedStatus);
  return result;
}

function assertJsonStatus(raw: string, expected: string): void {
  const parsed = JSON.parse(raw) as JsonRecord;
  if (parsed.mode !== "read_only_ops001_evidence_preflight") {
    fail("preflight mode missing");
  }
  if (parsed.status !== expected) {
    fail(`expected preflight status ${expected}, got ${String(parsed.status)}`);
  }
  const requiredPreflight = Array.isArray(parsed.requiredPreflight) ? parsed.requiredPreflight.join("\n") : "";
  if (!requiredPreflight.includes("AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh")) {
    fail("preflight requiredPreflight should include fallback smoke record generation command");
  }
  const safety = parsed.safetyFacts as JsonRecord | undefined;
  if (!safety || safety.serverCommandAttempted !== false || safety.productionWriteAttempted !== false || safety.secretValuePrinted !== false) {
    fail("preflight safety facts should prove no server command, production write, or secret printing");
  }
}

function createBlockedRecord(): string {
  return [
    "recordId: ops-001-blocked-20260711083436",
    "generatedAt: 2026-07-11T08:34:36Z",
    "mode: ops001-readonly-evidence-blocked",
    "residualRiskId: AF-RISK-OPS-001",
    "environment: production",
    "baseUrl: https://forge.areasong.top",
    "releaseTag: v0.1.7",
    "redactedUpdateStatusRecordHash: sha256:82e94e332b015089061c7944984fff9857b92e1833d4bfef8d8ddf791f5b6a09",
    "extraSmokeCommandConfigured: yes",
    "smokeEmailConfigured: no",
    "smokePasswordFileConfigured: no",
    "hostPnpmAvailable: no",
    "preflightStatus: blocked_on_prerequisite",
    "blockers: host pnpm missing, smoke email missing, smoke password file missing",
    "doesNotProve: authenticated smoke passed; operational evidence bundle ready; OPS-001 closure packet ready; AF-RISK-OPS-001 closure; long-term operability",
    "residualLedgerAction: remains-open",
    "forbiddenActions: updater apply, migration, backup, restore, rollback, production writes, secret export, residual ledger closure",
    "safetyFacts:",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  productionWriteAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  secretValuePrinted: no",
    "  residualLedgerUpdated: no",
    "",
  ].join("\n");
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
      targetVersion: "0.1.5",
      targetImage: "ghcr.io/areasong/areaforge-web:v0.1.5@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}
