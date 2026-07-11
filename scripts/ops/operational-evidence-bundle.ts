import { createHash } from "node:crypto";
import {
  collectOperationalReadinessSummary,
  type OperationalReadinessSummary,
  type Signal,
  type Status,
} from "./operational-readiness-summary";

type BundleStatus = "ready" | "needs_attention" | "blocked";

type EvidenceBundleItem = {
  key: string;
  category: string;
  status: BundleStatus;
  source: string;
  description: string;
  evidence: string;
  residualRiskIds: string[];
  requiredEvidence: string[];
  metadata: Record<string, unknown>;
};

type OperationalEvidenceBundle = {
  status: BundleStatus;
  mode: "read_only_operational_evidence_bundle";
  bundleHash: string;
  generatedAt: string;
  summary: OperationalReadinessSummary;
  freshness: OperationalReadinessSummary["freshness"];
  items: EvidenceBundleItem[];
  capabilities: string[];
  doesNotProve: string[];
  forbiddenActions: string[];
  safetyFacts: OperationalReadinessSummary["safetyFacts"] & {
    productionDeployAttempted: false;
    updaterApplyAttempted: false;
    rollbackAttempted: false;
    secretFileContentIncluded: false;
  };
};

const signalDefinitions: Array<{
  key: keyof OperationalReadinessSummary["signals"];
  category: string;
  source: string;
  description: string;
  requiredEvidence: string[];
}> = [
  {
    key: "health",
    category: "app_health",
    source: "GET /api/health or explicit missing base URL",
    description: "public health and version signal",
    requiredEvidence: ["AreaForge health JSON", "expected version when release or update scoped"],
  },
  {
    key: "releaseIdentity",
    category: "release_identity",
    source: "release tag, health, update status, and immutable image digests",
    description: "release tag and image digest agreement",
    requiredEvidence: [
      "release tag",
      "web image@sha256",
      "migration image@sha256",
      "manifest and checksum/signature evidence for release/update scope",
    ],
  },
  {
    key: "updateAgent",
    category: "update_agent",
    source: "redacted update status file or authenticated /api/system/update-status",
    description: "server update-agent state without executing updater actions",
    requiredEvidence: ["blocker=null", "signatureRequired=true", "timer enabled/active or documented limitation"],
  },
  {
    key: "authenticatedSmoke",
    category: "authenticated_smoke",
    source: "pnpm smoke:prod-readonly output or human redacted record",
    description: "authenticated user journey smoke evidence",
    requiredEvidence: ["recent smoke result", "ok=true", "checkedAt within freshness window"],
  },
  {
    key: "backup",
    category: "backup",
    source: "redacted backup freshness evidence",
    description: "database, uploads, env, compose, and Nginx backup evidence",
    requiredEvidence: ["database backup sha256", "uploads backup sha256", "env/config backup reference"],
  },
  {
    key: "rollback",
    category: "rollback",
    source: "update-agent rollback target or release record",
    description: "rollback target availability",
    requiredEvidence: ["previous version", "previous image@sha256", "rollback decision or plan"],
  },
  {
    key: "infrastructure",
    category: "infrastructure",
    source: "redacted disk evidence and automatic HTTPS certificate freshness evidence",
    description: "disk and TLS certificate readiness",
    requiredEvidence: ["disk status", "certificate days remaining", "alert receiver or manual review window"],
  },
];

async function main(): Promise<void> {
  const summary = await collectOperationalReadinessSummary();
  const items = signalDefinitions.map((definition) =>
    signalToBundleItem(definition, summary.signals[definition.key]),
  );
  const bundleWithoutHash = {
    status: bundleStatus(items),
    mode: "read_only_operational_evidence_bundle" as const,
    bundleHash: "",
    generatedAt: new Date().toISOString(),
    summary,
    freshness: summary.freshness,
    items,
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
  } satisfies OperationalEvidenceBundle;

  const bundle: OperationalEvidenceBundle = {
    ...bundleWithoutHash,
    bundleHash: hashBundle(bundleWithoutHash),
  };

  console.log(JSON.stringify(bundle, null, 2));

  const failOn = process.env.AREAFORGE_EVIDENCE_BUNDLE_FAIL_ON;
  if (failOn && shouldFail(bundle.status, failOn)) {
    process.exit(1);
  }
}

function signalToBundleItem(
  definition: (typeof signalDefinitions)[number],
  signal: Signal,
): EvidenceBundleItem {
  return {
    key: `signal:${definition.key}`,
    category: definition.category,
    status: itemStatus(signal.status),
    source: definition.source,
    description: definition.description,
    evidence: signal.evidence,
    residualRiskIds: signal.residualRiskIds ?? [],
    requiredEvidence: definition.requiredEvidence,
    metadata: signal.data ?? {},
  };
}

function itemStatus(status: Status): BundleStatus {
  if (status === "fail" || status === "blocked") return "blocked";
  if (status === "warn" || status === "unknown") return "needs_attention";
  return "ready";
}

function bundleStatus(items: EvidenceBundleItem[]): BundleStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "needs_attention")) return "needs_attention";
  return "ready";
}

function hashBundle(bundle: OperationalEvidenceBundle): string {
  return createHash("sha256").update(stableStringify({ ...bundle, bundleHash: "" })).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shouldFail(status: BundleStatus, failOn: string): boolean {
  const order: BundleStatus[] = ["ready", "needs_attention", "blocked"];
  const threshold = order.includes(failOn as BundleStatus) ? failOn as BundleStatus : "blocked";
  return order.indexOf(status) >= order.indexOf(threshold);
}

main().catch((error) => {
  console.error(`FAIL operational evidence bundle: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
