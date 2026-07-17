import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-maintenance-window-record-"));
const freshReadinessAt = new Date(Date.now() - 180_000).toISOString();
const freshEvidenceAt = new Date(Date.now() - 120_000).toISOString();
const freshAlertAt = new Date(Date.now() - 60_000).toISOString();
const staleReadinessAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

try {
  const readinessFile = path.join(tempDir, "readiness.json");
  const evidenceBundleFile = path.join(tempDir, "evidence-bundle.json");
  const alertPreviewFile = path.join(tempDir, "alert-preview.json");
  const residualReviewFile = path.join(tempDir, "residual-review.log");
  const recordFile = path.join(tempDir, "maintenance-window.txt");
  const passReadinessFile = path.join(tempDir, "pass-readiness.json");
  const passEvidenceBundleFile = path.join(tempDir, "pass-evidence-bundle.json");
  const passAlertPreviewFile = path.join(tempDir, "pass-alert-preview.json");
  const passResidualReviewFile = path.join(tempDir, "pass-residual-review.log");
  const passRecordFile = path.join(tempDir, "maintenance-window-pass.txt");
  const staleReadinessFile = path.join(tempDir, "stale-readiness.json");

  writeFileSync(readinessFile, JSON.stringify(createReadiness(), null, 2));
  writeFileSync(evidenceBundleFile, JSON.stringify(createEvidenceBundle(), null, 2));
  writeFileSync(alertPreviewFile, JSON.stringify(createAlertPreview(), null, 2));
  writeFileSync(residualReviewFile, createResidualReviewOutput());
  writeFileSync(passReadinessFile, JSON.stringify(createPassingReadiness(), null, 2));
  writeFileSync(passEvidenceBundleFile, JSON.stringify(createPassingEvidenceBundle(), null, 2));
  writeFileSync(passAlertPreviewFile, JSON.stringify(createPassingAlertPreview(), null, 2));
  writeFileSync(passResidualReviewFile, createNoDueResidualReviewOutput());
  writeFileSync(staleReadinessFile, JSON.stringify(createStaleReadiness(), null, 2));

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-maintenance-window-record.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_MAINTENANCE_OPERATOR: "areasong",
      AREAFORGE_MAINTENANCE_CADENCE: "weekly",
      AREAFORGE_MAINTENANCE_ENVIRONMENT: "production",
      AREAFORGE_MAINTENANCE_STARTED_AT: "2026-07-10T23:45:00+08:00",
      AREAFORGE_MAINTENANCE_READINESS_FILE: readinessFile,
      AREAFORGE_MAINTENANCE_EVIDENCE_BUNDLE_FILE: evidenceBundleFile,
      AREAFORGE_MAINTENANCE_ALERT_PREVIEW_FILE: alertPreviewFile,
      AREAFORGE_MAINTENANCE_RESIDUAL_REVIEW_FILE: residualReviewFile,
    },
  });
  expectStatus("generate maintenance window record", generated, 0);
  writeFileSync(recordFile, generated.stdout);

  assertIncludes(generated.stdout, "windowId: maintenance-window-20260710234500");
  assertIncludes(generated.stdout, "readinessSummaryHash: sha256:");
  assertIncludes(generated.stdout, "readinessOverall: warn");
  assertIncludes(generated.stdout, "evidenceBundleStatus: needs_attention");
  assertIncludes(generated.stdout, "alertPreviewStatus: warning");
  assertIncludes(generated.stdout, "healthStatus: pass");
  assertIncludes(generated.stdout, "updateAgentStatus: unknown");
  assertIncludes(generated.stdout, "authenticatedSmokeStatus: warn");
  assertIncludes(generated.stdout, "backupStatus: unknown");
  assertIncludes(generated.stdout, "infrastructureStatus: pass");
  assertIncludes(generated.stdout, "evidenceBundleHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assertIncludes(generated.stdout, "alertPreviewHash: sha256:");
  assertIncludes(generated.stdout, "residualReviewHash: sha256:");
  assertIncludes(generated.stdout, "evidenceFreshnessStatus: fresh");
  assertIncludes(generated.stdout, "evidenceFreshnessMaxAgeSeconds: 1209600");
  assertIncludes(generated.stdout, `latestEvidenceCheckedAt: ${new Date(freshAlertAt).toISOString()}`);
  assertIncludes(generated.stdout, "dueResidualRiskIds: AF-RISK-OPS-001,AF-RISK-SC-002");
  assertIncludes(generated.stdout, "claimBoundary:");
  assertIncludes(generated.stdout, "doesNotProve: production health without live evidence, updater apply completion, backup/restore execution, migration execution, rollback execution, residual risk closure");
  assertIncludes(generated.stdout, "result: warn");
  assertIncludes(generated.stdout, "productionWriteAttempted: no");

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/maintenance-window-record-validate.ts", recordFile], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate generated maintenance window record", validation, 0);

  const passGenerated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-maintenance-window-record.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_MAINTENANCE_OPERATOR: "areasong",
      AREAFORGE_MAINTENANCE_CADENCE: "weekly",
      AREAFORGE_MAINTENANCE_ENVIRONMENT: "production",
      AREAFORGE_MAINTENANCE_STARTED_AT: "2026-07-10T23:45:00+08:00",
      AREAFORGE_MAINTENANCE_READINESS_FILE: passReadinessFile,
      AREAFORGE_MAINTENANCE_EVIDENCE_BUNDLE_FILE: passEvidenceBundleFile,
      AREAFORGE_MAINTENANCE_ALERT_PREVIEW_FILE: passAlertPreviewFile,
      AREAFORGE_MAINTENANCE_RESIDUAL_REVIEW_FILE: passResidualReviewFile,
    },
  });
  expectStatus("fresh passing maintenance window record", passGenerated, 0);
  writeFileSync(passRecordFile, passGenerated.stdout);
  assertIncludes(passGenerated.stdout, "evidenceFreshnessStatus: fresh");
  assertIncludes(passGenerated.stdout, "dueResidualRiskIds: none");
  assertIncludes(passGenerated.stdout, "result: pass");
  const passValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/maintenance-window-record-validate.ts", passRecordFile], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate fresh passing maintenance window record", passValidation, 0);

  const crossFieldCases = [
    ["readinessOverall", "blocked"],
    ["evidenceBundleStatus", "blocked"],
    ["alertPreviewStatus", "critical"],
    ["healthStatus", "fail"],
    ["evidenceFreshnessStatus", "stale"],
    ["residualReviewStatus", "fail"],
  ] as const;
  for (const [field, value] of crossFieldCases) {
    const invalidFile = path.join(tempDir, `invalid-${field}.txt`);
    const invalidRecord = passGenerated.stdout.replace(new RegExp(`^${field}: .*\\n`, "m"), `${field}: ${value}\n`);
    writeFileSync(invalidFile, invalidRecord);
    const invalidValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/maintenance-window-record-validate.ts", invalidFile], {
      cwd: root,
      encoding: "utf8",
    });
    expectStatus(`reject inconsistent ${field}`, invalidValidation, 1);
  }

  const unknownDowngrade = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-maintenance-window-record.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_MAINTENANCE_OPERATOR: "areasong",
      AREAFORGE_MAINTENANCE_CADENCE: "weekly",
      AREAFORGE_MAINTENANCE_ENVIRONMENT: "production",
      AREAFORGE_MAINTENANCE_RESULT: "pass",
    },
  });
  expectStatus("unknown freshness pass request downgrades", unknownDowngrade, 0);
  assertIncludes(unknownDowngrade.stdout, "evidenceFreshnessStatus: unknown");
  assertIncludes(unknownDowngrade.stdout, "result: warn");

  const staleDowngrade = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-maintenance-window-record.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_MAINTENANCE_OPERATOR: "areasong",
      AREAFORGE_MAINTENANCE_CADENCE: "weekly",
      AREAFORGE_MAINTENANCE_ENVIRONMENT: "production",
      AREAFORGE_MAINTENANCE_RESULT: "pass",
      AREAFORGE_MAINTENANCE_READINESS_FILE: staleReadinessFile,
    },
  });
  expectStatus("stale freshness pass request downgrades", staleDowngrade, 0);
  assertIncludes(staleDowngrade.stdout, "evidenceFreshnessStatus: stale");
  assertIncludes(staleDowngrade.stdout, "result: warn");

  const missingEnv = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-maintenance-window-record.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_MAINTENANCE_OPERATOR: "",
      AREAFORGE_MAINTENANCE_CADENCE: "",
      AREAFORGE_MAINTENANCE_ENVIRONMENT: "",
    },
  });
  expectStatus("missing maintenance env fails", missingEnv, 1);

  console.log("maintenance window record generator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function createReadiness(): unknown {
  return {
    checkedAt: freshReadinessAt,
    overall: "warn",
    residualRiskIds: ["AF-RISK-OPS-001"],
    signals: {
      health: { status: "pass" },
      updateAgent: { status: "unknown" },
      authenticatedSmoke: { status: "warn" },
      backup: { status: "unknown" },
      infrastructure: { status: "pass" },
    },
    safetyFacts: {
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
    },
  };
}

function createEvidenceBundle(): unknown {
  return {
    mode: "read_only_operational_evidence_bundle",
    status: "needs_attention",
    bundleHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    generatedAt: freshEvidenceAt,
    items: [
      {
        key: "signal:updateAgent",
        residualRiskIds: ["AF-RISK-OPS-001"],
      },
    ],
  };
}

function createAlertPreview(): unknown {
  return {
    mode: "read_only_alert_preview",
    status: "warning",
    generatedAt: freshAlertAt,
    alerts: [
      {
        signal: "updateAgent",
        residualRiskIds: ["AF-RISK-OPS-001"],
      },
      {
        signal: "releaseIdentity",
        residualRiskIds: ["AF-RISK-SC-002"],
      },
    ],
  };
}

function createPassingReadiness(): unknown {
  return {
    checkedAt: freshReadinessAt,
    overall: "pass",
    residualRiskIds: [],
    signals: {
      health: { status: "pass" },
      updateAgent: { status: "pass" },
      authenticatedSmoke: { status: "pass" },
      backup: { status: "pass" },
      infrastructure: { status: "pass" },
    },
    safetyFacts: {
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
    },
  };
}

function createPassingEvidenceBundle(): unknown {
  return {
    mode: "read_only_operational_evidence_bundle",
    status: "ready",
    bundleHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    generatedAt: freshEvidenceAt,
    items: [],
  };
}

function createPassingAlertPreview(): unknown {
  return {
    mode: "read_only_alert_preview",
    status: "ok",
    generatedAt: freshAlertAt,
    alerts: [],
  };
}

function createStaleReadiness(): unknown {
  return {
    checkedAt: staleReadinessAt,
    overall: "pass",
    residualRiskIds: [],
    signals: {
      health: { status: "pass" },
      updateAgent: { status: "pass" },
      authenticatedSmoke: { status: "pass" },
      backup: { status: "pass" },
      infrastructure: { status: "pass" },
    },
  };
}

function createResidualReviewOutput(): string {
  return [
    "SOON AF-RISK-OPS-001: reviewAt=2026-07-17",
    "SOON AF-RISK-SC-002: reviewAt=2026-07-24",
    JSON.stringify({
      ok: true,
      counts: {
        total: 2,
        overdue: 0,
        dueToday: 0,
        dueSoon: 2,
        future: 0,
      },
      dueItems: [
        { id: "AF-RISK-OPS-001" },
        { id: "AF-RISK-SC-002" },
      ],
    }, null, 2),
  ].join("\n");
}

function createNoDueResidualReviewOutput(): string {
  return JSON.stringify({
    ok: true,
    counts: {
      total: 2,
      overdue: 0,
      dueToday: 0,
      dueSoon: 0,
      future: 2,
    },
    dueItems: [],
  }, null, 2);
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expectedStatus: number): void {
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    console.error(`FAIL expected generated record to include ${expected}`);
    console.error(value);
    process.exit(1);
  }
}
