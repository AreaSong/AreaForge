import { collectOperationalReadinessSummary, type OperationalReadinessSummary, type Signal } from "./operational-readiness-summary";

type AlertSeverity = "info" | "watch" | "warning" | "critical";

type AlertPreviewItem = {
  key: string;
  signal: keyof OperationalReadinessSummary["signals"];
  severity: AlertSeverity;
  wouldNotify: boolean;
  owner: string;
  summary: string;
  evidence: string;
  residualRiskIds: string[];
  recommendedAction: string;
};

type AlertPreview = {
  status: "ok" | "watch" | "warning" | "critical";
  mode: "read_only_alert_preview";
  generatedAt: string;
  environment: string;
  scope: OperationalReadinessSummary["scope"];
  delivery: {
    enabled: false;
    receiverConfigured: boolean;
    receiverHint: string | null;
  };
  alerts: AlertPreviewItem[];
  safetyFacts: OperationalReadinessSummary["safetyFacts"] & {
    notificationSent: false;
    externalAlertReceiverCalled: false;
    serverCommandAttempted: false;
    productionWriteAttempted: false;
  };
  forbiddenActions: string[];
};

const signalOwners: Record<keyof OperationalReadinessSummary["signals"], string> = {
  health: "areaforge-sre-ops",
  releaseIdentity: "areaforge-release-operator / areaforge-supply-chain",
  updateAgent: "areaforge-sre-ops",
  authenticatedSmoke: "areaforge-qa-smoke",
  backup: "areaforge-sre-ops",
  rollback: "areaforge-release-operator / areaforge-sre-ops",
  infrastructure: "areaforge-observability / areaforge-sre-ops",
};

const recommendedActions: Record<keyof OperationalReadinessSummary["signals"], string> = {
  health: "collect public health again within the freshness window and compare expected version",
  releaseIdentity: "record release tag, immutable image digests, manifest, checksum, and signature evidence",
  updateAgent: "collect redacted update-agent status or authenticated update status without running updater actions",
  authenticatedSmoke: "run or attach a recent read-only authenticated smoke result",
  backup: "attach current database/uploads/env/config backup hashes before release, update, migration, or rollback",
  rollback: "record previous version, previous image digest, and rollback decision or plan",
  infrastructure: "record disk status, certificate days remaining, and alert receiver or manual review window",
};

async function main(): Promise<void> {
  const summary = await collectOperationalReadinessSummary();
  const alerts = Object.entries(summary.signals).map(([key, signal]) =>
    toAlertItem(key as keyof OperationalReadinessSummary["signals"], signal),
  );
  const preview: AlertPreview = {
    status: overallAlertStatus(alerts),
    mode: "read_only_alert_preview",
    generatedAt: new Date().toISOString(),
    environment: summary.environment,
    scope: summary.scope,
    delivery: {
      enabled: false,
      receiverConfigured: Boolean(process.env.AREAFORGE_ALERT_RECEIVER),
      receiverHint: process.env.AREAFORGE_ALERT_RECEIVER ? "<redacted>" : null,
    },
    alerts,
    safetyFacts: {
      ...summary.safetyFacts,
      notificationSent: false,
      externalAlertReceiverCalled: false,
      serverCommandAttempted: false,
      productionWriteAttempted: false,
    },
    forbiddenActions: [
      "send_notification",
      "call_external_alert_receiver",
      "execute_server_command",
      "apply_update",
      "run_migration",
      "perform_backup",
      "perform_restore",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "read_or_print_secret_values",
    ],
  };

  console.log(JSON.stringify(preview, null, 2));

  const failOn = process.env.AREAFORGE_ALERT_PREVIEW_FAIL_ON;
  if (failOn && shouldFail(preview.status, failOn)) {
    process.exit(1);
  }
}

function toAlertItem(
  key: keyof OperationalReadinessSummary["signals"],
  signal: Signal,
): AlertPreviewItem {
  const severity = severityFor(key, signal);
  return {
    key: `alert:${key}`,
    signal: key,
    severity,
    wouldNotify: severity === "warning" || severity === "critical",
    owner: signalOwners[key],
    summary: `${key} is ${signal.status}`,
    evidence: signal.evidence,
    residualRiskIds: signal.residualRiskIds ?? [],
    recommendedAction: recommendedActions[key],
  };
}

function severityFor(
  key: keyof OperationalReadinessSummary["signals"],
  signal: Signal,
): AlertSeverity {
  if (signal.status === "fail" || signal.status === "blocked") return "critical";
  if (signal.status === "warn") return "warning";
  if (signal.status === "unknown") {
    return key === "health" || key === "rollback" ? "watch" : "warning";
  }
  return "info";
}

function overallAlertStatus(alerts: AlertPreviewItem[]): AlertPreview["status"] {
  const order: AlertSeverity[] = ["info", "watch", "warning", "critical"];
  const worst = alerts.reduce<AlertSeverity>((current, alert) =>
    order.indexOf(alert.severity) > order.indexOf(current) ? alert.severity : current, "info");
  return worst === "info" ? "ok" : worst;
}

function shouldFail(status: AlertPreview["status"], failOn: string): boolean {
  const order: AlertPreview["status"][] = ["ok", "watch", "warning", "critical"];
  const threshold = order.includes(failOn as AlertPreview["status"]) ? failOn as AlertPreview["status"] : "critical";
  return order.indexOf(status) >= order.indexOf(threshold);
}

main().catch((error) => {
  console.error(`FAIL operational alert preview: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
