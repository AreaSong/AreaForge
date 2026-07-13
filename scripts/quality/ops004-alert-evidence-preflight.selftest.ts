import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-ops004-preflight-"));

try {
  const noEvidence = runPreflight({}, 0);
  assertJsonStatus(noEvidence.stdout, "needs_evidence");

  const previewPath = path.join(tempDir, "ops-alert-preview.json");
  writeFileSync(previewPath, JSON.stringify(createAlertPreview(), null, 2));

  const readyToGenerate = runPreflight({
    AREAFORGE_OPS004_ALERT_PREVIEW: previewPath,
  }, 0);
  assertJsonStatus(readyToGenerate.stdout, "ready_to_generate_record");
  assertPreviewAckBoundary(readyToGenerate.stdout);

  const drillPath = path.join(tempDir, "alert-drill-record.txt");
  const generate = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/generate-alert-drill-record.ts", previewPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_ALERT_DRILL_OPERATOR: "AreaForge Maintainer",
      AREAFORGE_ALERT_RECEIVER_TYPE: "manual-window",
      AREAFORGE_ALERT_RECEIVER_CONFIGURED: "yes",
      AREAFORGE_ALERT_RECEIVER_ACK: "yes",
      AREAFORGE_ALERT_DRILL_DETECTION_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_RESULT: "PASS",
      AREAFORGE_ALERT_DRILL_RECOVERY_ACTION: "manual operator reviewed alert preview and confirmed recovery checklist",
    },
  });
  expectStatus("generate OPS-004 alert drill record", generate, 0);
  writeFileSync(drillPath, generate.stdout);

  const readyForClose = runPreflight({
    AREAFORGE_OPS004_ALERT_PREVIEW: previewPath,
    AREAFORGE_OPS004_ALERT_DRILL_RECORD: drillPath,
  }, 0);
  assertJsonStatus(readyForClose.stdout, "ready_for_human_close");

  const staleDrillPath = path.join(tempDir, "stale-alert-drill-record.txt");
  writeFileSync(staleDrillPath, generate.stdout.replace(/alertPreviewEvidenceHash: sha256:[a-f0-9]{64}/i, `alertPreviewEvidenceHash: sha256:${"f".repeat(64)}`));
  const stale = runPreflight({
    AREAFORGE_OPS004_ALERT_PREVIEW: previewPath,
    AREAFORGE_OPS004_ALERT_DRILL_RECORD: staleDrillPath,
  }, 1);
  assertJsonStatus(stale.stdout, "invalid");

  const invalidPreviewPath = path.join(tempDir, "invalid-alert-preview.json");
  const invalidPreview = createAlertPreview();
  invalidPreview.safetyFacts = {
    ...(invalidPreview.safetyFacts as JsonRecord),
    productionWriteAttempted: true,
  };
  writeFileSync(invalidPreviewPath, JSON.stringify(invalidPreview, null, 2));
  const invalidPreviewRun = runPreflight({
    AREAFORGE_OPS004_ALERT_PREVIEW: invalidPreviewPath,
  }, 1);
  assertJsonStatus(invalidPreviewRun.stdout, "invalid");

  console.log("OPS-004 alert evidence preflight selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function runPreflight(env: Record<string, string>, expectedStatus: number): ReturnType<typeof spawnSync> {
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/ops004-alert-evidence-preflight.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      AREAFORGE_OPS004_ALERT_PREVIEW: "",
      AREAFORGE_OPS004_ALERT_DRILL_RECORD: "",
      ...env,
    },
  });
  expectStatus("OPS-004 alert evidence preflight", result, expectedStatus);
  return result;
}

function assertJsonStatus(raw: string, expected: string): void {
  const parsed = JSON.parse(raw) as JsonRecord;
  if (parsed.mode !== "read_only_ops004_alert_evidence_preflight") {
    fail("preflight mode missing");
  }
  if (parsed.status !== expected) {
    fail(`expected preflight status ${expected}, got ${String(parsed.status)}`);
  }
  const safety = parsed.safetyFacts as JsonRecord | undefined;
  if (!safety || safety.serverCommandAttempted !== false || safety.productionWriteAttempted !== false || safety.secretValuePrinted !== false) {
    fail("preflight safety facts should prove no server command, production write, or secret printing");
  }
}

function assertPreviewAckBoundary(raw: string): void {
  const parsed = JSON.parse(raw) as JsonRecord;
  const evidence = parsed.evidence;
  if (!Array.isArray(evidence)) {
    fail("preflight evidence array missing");
  }
  const preview = evidence.find((item) =>
    typeof item === "object" &&
    item !== null &&
    (item as JsonRecord).key === "alertPreview"
  ) as JsonRecord | undefined;
  const detail = typeof preview?.detail === "string" ? preview.detail : "";
  if (!detail.includes("does not prove drill receiver ACK")) {
    fail("preview detail must not imply receiver ACK from preview delivery settings");
  }
}

function createAlertPreview(): JsonRecord {
  return {
    status: "warning",
    mode: "read_only_alert_preview",
    generatedAt: "2026-07-10T14:20:00.000Z",
    environment: "production",
    scope: "daily",
    delivery: {
      enabled: false,
      receiverConfigured: true,
      receiverHint: "<redacted>",
    },
    alerts: [
      {
        key: "alert:infrastructure",
        signal: "infrastructure",
        severity: "warning",
        wouldNotify: true,
        owner: "areaforge-observability / areaforge-sre-ops",
        summary: "infrastructure is unknown",
        evidence: "disk/certificate evidence not supplied",
        residualRiskIds: ["AF-RISK-OPS-004"],
        recommendedAction: "record disk status, certificate days remaining, and alert receiver or manual review window",
      },
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      notificationSent: false,
      externalAlertReceiverCalled: false,
    },
    forbiddenActions: [
      "send_notification",
      "call_external_alert_receiver",
      "execute_server_command",
      "write_database",
      "read_or_print_secret_values",
    ],
  };
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`${label} expected exit ${expected}, got ${String(result.status)}`);
  }
}

function fail(message: string): never {
  throw new Error(message);
}
