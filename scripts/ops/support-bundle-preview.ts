import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type JsonRecord = Record<string, unknown>;

type ResidualItem = {
  id: string;
  type: string;
  reviewAt: string;
  executableNow: boolean;
  currentImpact: string;
  closeCondition: string;
  requiredEvidence: string;
  ownerSkills: string[];
};

type SupportBundlePreview = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "metadata_only_support_bundle_preview";
  supportBundlePreviewHash: string;
  app: {
    name: string;
    version: string;
    onlineUrl: string;
    releaseTag: string;
    autoApplyDefault: "none";
  };
  purpose: "public_support_or_operator_handoff";
  metadataOnly: true;
  exportOpen: false;
  sourceBaseline: {
    borrowedMechanisms: string[];
    notBorrowed: string[];
  };
  includedMetadata: string[];
  excludedSensitiveContent: string[];
  evidencePointers: {
    docs: string[];
    commands: string[];
    residualRiskIds: string[];
  };
  residuals: {
    source: string;
    total: number;
    countsByType: Record<string, number>;
    dueSoonOrExecutable: Array<Pick<ResidualItem, "id" | "type" | "reviewAt" | "executableNow" | "ownerSkills" | "closeCondition" | "requiredEvidence">>;
  };
  recommendedNextCommands: {
    support: string[];
    liveEvidence: string[];
    release: string[];
  };
  claimBoundary: {
    canClaim: string[];
    cannotClaim: string[];
  };
  doesNotProve: string[];
  forbiddenActions: string[];
  safetyFacts: {
    readOnly: true;
    metadataOnly: true;
    supportBundleExported: false;
    exportOpen: false;
    networkRequested: false;
    serverCommandAttempted: false;
    backupRestoreAttempted: false;
    migrationAttempted: false;
    productionWriteAttempted: false;
    secretValuePrinted: false;
    secretValueIncluded: false;
    privateEnvIncluded: false;
    databaseDumpIncluded: false;
    backupArchiveIncluded: false;
    uploadFileContentIncluded: false;
    attachmentContentIncluded: false;
    aiContextIncluded: false;
    rawLogIncluded: false;
    gitPushAttempted: false;
    tagPushed: false;
    releaseCreated: false;
  };
};

const residualSource = "docs/development/residual-risk-ledger.json";

function main(): void {
  const packageJson = readJson("package.json");
  const residuals = readResiduals();
  const version = stringValue(packageJson.version, "0.0.0");
  const previewWithoutHash = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "metadata_only_support_bundle_preview",
    supportBundlePreviewHash: "",
    app: {
      name: stringValue(packageJson.name, "@areasong/areaforge"),
      version,
      onlineUrl: "https://forge.areasong.top/",
      releaseTag: `v${version}`,
      autoApplyDefault: "none",
    },
    purpose: "public_support_or_operator_handoff",
    metadataOnly: true,
    exportOpen: false,
    sourceBaseline: {
      borrowedMechanisms: [
        "AreaFlow metadata-only support bundle preview",
        "AreaFlow backup manifest and restore dry-run evidence inventory",
        "AreaMatrix residual index discipline",
        "AreaForge read-only operational handoff and evidence bundle separation",
      ],
      notBorrowed: [
        "support bundle export",
        "backup or restore apply",
        "remote telemetry upload",
        "remote server control",
        "task-loop runner",
      ],
    },
    includedMetadata: [
      "app version and release tag",
      "public documentation pointers",
      "safe command names",
      "residual risk IDs and close conditions",
      "backup/restore preview command names",
      "support and release claim boundaries",
      "redaction and safety facts",
    ],
    excludedSensitiveContent: [
      "secret_values",
      "private_env",
      "database_dumps",
      "backup_archives",
      "upload_file_contents",
      "attachment_binary_or_text",
      "private_review_body",
      "motivation_or_emotion_records",
      "ai_context_text",
      "raw_logs",
      "session_tokens",
    ],
    evidencePointers: {
      docs: [
        "SUPPORT.md",
        "SECURITY.md",
        "docs/development/support-intake.md",
        "docs/development/operational-readiness.md",
        "docs/development/maintenance-cadence.md",
        "docs/development/residual-risk-ledger.md",
        "docs/deployment/operator-onboarding.md",
      ],
      commands: [
        "pnpm ops:support:bundle-preview",
        "pnpm ops:support:bundle-preview:validate <support-bundle-preview.json>",
        "pnpm ops:backup-restore:preview",
        "pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>",
        "pnpm ops:handoff",
        "pnpm ops:status",
        "pnpm ops:readiness:summary",
        "pnpm ops:evidence:bundle",
        "pnpm ops:alert:preview",
        "pnpm residuals:review-due",
      ],
      residualRiskIds: residuals.items.map((item) => item.id),
    },
    residuals: {
      source: residualSource,
      total: residuals.items.length,
      countsByType: countBy(residuals.items, "type"),
      dueSoonOrExecutable: residuals.items
        .filter((item) => item.executableNow || isDueSoon(item.reviewAt))
        .map((item) => ({
          id: item.id,
          type: item.type,
          reviewAt: item.reviewAt,
          executableNow: item.executableNow,
          ownerSkills: item.ownerSkills,
          closeCondition: item.closeCondition,
          requiredEvidence: item.requiredEvidence,
        })),
    },
    recommendedNextCommands: {
      support: [
        "pnpm ops:support:bundle-preview",
        "pnpm support:intake:preflight",
        "pnpm ops:handoff",
        "pnpm residuals:review-due",
      ],
      liveEvidence: [
        "pnpm ops:readiness:summary",
        "pnpm ops:evidence:bundle",
        "pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>",
        "pnpm ops:backup-restore:preview",
        "pnpm ops:backup-restore:preview:validate <backup-restore-preview.json>",
        "pnpm smoke:prod-readonly:config",
        "pnpm smoke:prod-readonly",
      ],
      release: [
        "pnpm release:train:preflight",
        "pnpm github-release-updater:preflight",
        "pnpm ci:supply-chain:selftest",
        "pnpm release:supply-chain:selftest",
      ],
    },
    claimBoundary: {
      canClaim: [
        "support bundle preview is metadata-only",
        "redaction and forbidden-action boundaries are explicitly listed",
        "residual risk IDs and next safe commands are indexed",
      ],
      cannotClaim: [
        "current production health",
        "updater apply completion",
        "backup or restore success",
        "backup archive exists",
        "restore apply execution",
        "GitHub Release creation",
        "residual risk closure",
        "support bundle export",
      ],
    },
    doesNotProve: [
      "current production health",
      "updater apply completion",
      "backup, restore, migration, or rollback execution",
      "backup archive existence or restore dry-run success",
      "GitHub Release creation",
      "residual risk closure",
      "support bundle export",
      "operator approval for high-risk actions",
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
      "read_or_print_secret_values",
      "export_support_bundle",
      "upload_remote_telemetry",
      "include_user_content",
      "create_github_release",
      "push_git_tag",
    ],
    safetyFacts: {
      readOnly: true,
      metadataOnly: true,
      supportBundleExported: false,
      exportOpen: false,
      networkRequested: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      secretValueIncluded: false,
      privateEnvIncluded: false,
      databaseDumpIncluded: false,
      backupArchiveIncluded: false,
      uploadFileContentIncluded: false,
      attachmentContentIncluded: false,
      aiContextIncluded: false,
      rawLogIncluded: false,
      gitPushAttempted: false,
      tagPushed: false,
      releaseCreated: false,
    },
  } satisfies SupportBundlePreview;

  const preview: SupportBundlePreview = {
    ...previewWithoutHash,
    supportBundlePreviewHash: hashPreview(previewWithoutHash),
  };

  console.log(JSON.stringify(preview, null, 2));
}

function readResiduals(): { items: ResidualItem[] } {
  const parsed = readJson(residualSource);
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  return {
    items: rawItems.filter(isResidualItem),
  };
}

function isResidualItem(value: unknown): value is ResidualItem {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    typeof value.type === "string" &&
    typeof value.reviewAt === "string" &&
    typeof value.executableNow === "boolean" &&
    typeof value.currentImpact === "string" &&
    typeof value.closeCondition === "string" &&
    typeof value.requiredEvidence === "string" &&
    Array.isArray(value.ownerSkills) &&
    value.ownerSkills.every((item) => typeof item === "string");
}

function isDueSoon(reviewAt: string): boolean {
  const timestamp = Date.parse(`${reviewAt}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.floor((timestamp - todayUtc) / 86_400_000);
  return days >= 0 && days <= 14;
}

function countBy(items: ResidualItem[], key: keyof ResidualItem): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key]);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function readJson(filePath: string): JsonRecord {
  if (!existsSync(filePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return parsed;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function hashPreview(preview: SupportBundlePreview): string {
  return createHash("sha256")
    .update(stableStringify({ ...preview, supportBundlePreviewHash: "" }))
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

try {
  main();
} catch (error) {
  console.error(`FAIL support bundle preview: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
}
