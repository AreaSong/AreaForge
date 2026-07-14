import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-alert-drill-record-"));

try {
  const preview = path.join(tempDir, "alert-preview.json");
  const generatedRecord = path.join(tempDir, "alert-drill-record.txt");
  writeFileSync(preview, JSON.stringify(createPreview(), null, 2));

  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-alert-drill-record.ts", preview], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_ALERT_DRILL_AT: "2026-07-10T22:35:00.000Z",
      AREAFORGE_ALERT_DRILL_OPERATOR: "areasong",
      AREAFORGE_ALERT_RECEIVER_TYPE: "manual-window",
      AREAFORGE_ALERT_RECEIVER_CONFIGURED: "yes",
      AREAFORGE_ALERT_RECEIVER_ACK: "yes",
      AREAFORGE_ALERT_DRILL_DETECTION_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_ACTION: "operator acknowledged backup freshness warning and recorded next backup check",
    },
  });
  if (generated.status !== 0) {
    console.error("FAIL generated alert drill record command");
    console.error(generated.stdout.trim());
    console.error(generated.stderr.trim());
    process.exit(1);
  }

  writeFileSync(generatedRecord, generated.stdout);
  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/alert-drill-validate.ts", generatedRecord], {
    cwd: root,
    encoding: "utf8",
  });
  if (validation.status !== 0) {
    console.error("FAIL generated alert drill record validation");
    console.error(validation.stdout.trim());
    console.error(validation.stderr.trim());
    process.exit(1);
  }
  if (!validation.stdout.includes("alertDrillEvidenceHash: sha256:")) {
    console.error("FAIL generated alert drill validation hash missing");
    console.error(validation.stdout.trim());
    process.exit(1);
  }
  if (!generated.stdout.includes("drilledAt: 2026-07-10T22:35:00.000Z")) {
    console.error("FAIL generated alert drill record should honor explicit drill time");
    console.error(generated.stdout.trim());
    process.exit(1);
  }

  const missingRequired = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-alert-drill-record.ts", preview], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_ALERT_DRILL_OPERATOR: "",
      AREAFORGE_ALERT_RECEIVER_TYPE: "",
      AREAFORGE_ALERT_RECEIVER_CONFIGURED: "",
      AREAFORGE_ALERT_RECEIVER_ACK: "",
      AREAFORGE_ALERT_DRILL_DETECTION_RESULT: "",
      AREAFORGE_ALERT_DRILL_RECOVERY_RESULT: "",
      AREAFORGE_ALERT_DRILL_RECOVERY_ACTION: "",
    },
  });
  if (missingRequired.status !== 1 || !missingRequired.stderr.includes("missing")) {
    console.error("FAIL missing required alert drill fields should fail");
    console.error(missingRequired.stdout.trim());
    console.error(missingRequired.stderr.trim());
    process.exit(1);
  }

  const unknownEnvironmentPreview = path.join(tempDir, "alert-preview-unknown-environment.json");
  writeFileSync(unknownEnvironmentPreview, JSON.stringify({ ...createPreview(), environment: "unknown" }, null, 2));
  const unknownEnvironment = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-alert-drill-record.ts", unknownEnvironmentPreview], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_ALERT_DRILL_OPERATOR: "areasong",
      AREAFORGE_ALERT_RECEIVER_TYPE: "manual-window",
      AREAFORGE_ALERT_RECEIVER_CONFIGURED: "yes",
      AREAFORGE_ALERT_RECEIVER_ACK: "yes",
      AREAFORGE_ALERT_DRILL_DETECTION_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_ACTION: "operator acknowledged backup freshness warning and recorded next backup check",
    },
  });
  if (unknownEnvironment.status !== 1 || !unknownEnvironment.stderr.includes("environment must be explicit")) {
    console.error("FAIL unknown preview environment should require explicit drill environment");
    console.error(unknownEnvironment.stdout.trim());
    console.error(unknownEnvironment.stderr.trim());
    process.exit(1);
  }

  const mixedPreview = path.join(tempDir, "alert-preview-mixed.json");
  writeFileSync(mixedPreview, JSON.stringify(createMixedPreview(), null, 2));
  const mixedGenerated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-alert-drill-record.ts", mixedPreview], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_ALERT_DRILL_OPERATOR: "areasong",
      AREAFORGE_ALERT_RECEIVER_TYPE: "manual-window",
      AREAFORGE_ALERT_RECEIVER_CONFIGURED: "yes",
      AREAFORGE_ALERT_RECEIVER_ACK: "yes",
      AREAFORGE_ALERT_DRILL_DETECTION_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_ACTION: "operator acknowledged backup freshness warning and recorded next backup check",
    },
  });
  if (mixedGenerated.status !== 0 || !mixedGenerated.stdout.includes("scenario: backup_stale")) {
    console.error("FAIL mixed alert preview should infer OPS-004 backup_stale scenario");
    console.error(mixedGenerated.stdout.trim());
    console.error(mixedGenerated.stderr.trim());
    process.exit(1);
  }

  console.log("alert drill record generator selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function createPreview(): unknown {
  return {
    status: "warning",
    mode: "read_only_alert_preview",
    generatedAt: "2026-07-10T22:30:00+08:00",
    environment: "production",
    scope: "daily",
    delivery: {
      enabled: false,
      receiverConfigured: true,
      receiverHint: "<redacted>",
    },
    alerts: [
      {
        key: "alert:backup",
        signal: "backup",
        severity: "warning",
        wouldNotify: true,
        owner: "areaforge-sre-ops",
        summary: "backup is unknown",
        evidence: "backup freshness evidence not supplied",
        residualRiskIds: ["AF-RISK-OPS-004"],
        recommendedAction: "attach current database/uploads/env/config backup hashes",
      },
    ],
    safetyFacts: {
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      notificationSent: false,
      externalAlertReceiverCalled: false,
    },
  };
}

function createMixedPreview(): unknown {
  const preview = createPreview() as {
    alerts: Array<Record<string, unknown>>;
  };
  return {
    ...preview,
    alerts: [
      {
        key: "alert:updateAgent",
        signal: "updateAgent",
        severity: "warning",
        wouldNotify: true,
        owner: "areaforge-sre-ops",
        summary: "updateAgent is unknown",
        evidence: "update status not collected",
        residualRiskIds: ["AF-RISK-OPS-001"],
        recommendedAction: "collect redacted update-agent status",
      },
      ...preview.alerts,
    ],
  };
}
