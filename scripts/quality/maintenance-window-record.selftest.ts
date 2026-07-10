import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-maintenance-window-record-"));

try {
  const readinessFile = path.join(tempDir, "readiness.json");
  const evidenceBundleFile = path.join(tempDir, "evidence-bundle.json");
  const alertPreviewFile = path.join(tempDir, "alert-preview.json");
  const recordFile = path.join(tempDir, "maintenance-window.txt");

  writeFileSync(readinessFile, JSON.stringify(createReadiness(), null, 2));
  writeFileSync(evidenceBundleFile, JSON.stringify(createEvidenceBundle(), null, 2));
  writeFileSync(alertPreviewFile, JSON.stringify(createAlertPreview(), null, 2));

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-maintenance-window-record.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_MAINTENANCE_OPERATOR: "areasong",
      AREAFORGE_MAINTENANCE_CADENCE: "weekly",
      AREAFORGE_MAINTENANCE_ENVIRONMENT: "production",
      AREAFORGE_MAINTENANCE_READINESS_FILE: readinessFile,
      AREAFORGE_MAINTENANCE_EVIDENCE_BUNDLE_FILE: evidenceBundleFile,
      AREAFORGE_MAINTENANCE_ALERT_PREVIEW_FILE: alertPreviewFile,
    },
  });
  expectStatus("generate maintenance window record", generated, 0);
  writeFileSync(recordFile, generated.stdout);

  assertIncludes(generated.stdout, "windowId: maintenance-window-20260710234500");
  assertIncludes(generated.stdout, "readinessSummaryHash: sha256:");
  assertIncludes(generated.stdout, "evidenceBundleHash: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assertIncludes(generated.stdout, "alertPreviewHash: sha256:");
  assertIncludes(generated.stdout, "dueResidualRiskIds: AF-RISK-OPS-001,AF-RISK-SC-002");
  assertIncludes(generated.stdout, "result: warn");
  assertIncludes(generated.stdout, "productionWriteAttempted: no");

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/maintenance-window-record-validate.ts", recordFile], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate generated maintenance window record", validation, 0);

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
    checkedAt: "2026-07-10T23:45:00+08:00",
    overall: "warn",
    residualRiskIds: ["AF-RISK-OPS-001"],
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
    generatedAt: "2026-07-10T23:46:00+08:00",
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
    generatedAt: "2026-07-10T23:47:00+08:00",
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
