import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  effectiveExceptionStatus,
  effectiveExecutableNow,
  isAcceptedExceptionEffective,
  readResidualLedgerV2,
  type EffectiveExceptionStatus,
  type ResidualItemV2,
} from "../quality/residual-ledger-common";

type JsonRecord = Record<string, unknown>;

type ProjectedResidualItem = Omit<ResidualItemV2, "executableNow"> & {
  executableNow: boolean;
  effectiveExceptionStatus: EffectiveExceptionStatus;
  acceptedExceptionEffective: boolean;
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
  dataLifecycle: {
    categories: Array<{
      category: string;
      storageClass: string;
      backupCoverage: "documented" | "not_applicable";
      retentionSource: "configured" | "not_configured" | "not_applicable";
      exportSupport: "metadata_only" | "not_supported";
      deletionSupport: "not_supported";
      migrationSupport: "not_supported";
    }>;
    doesNotInspect: string[];
  };
  evidencePointers: {
    docs: string[];
    commands: string[];
    residualRiskIds: string[];
  };
  residuals: {
    source: string;
    total: number;
    countsByType: Record<string, number>;
    dueSoonOrExecutable: Array<Pick<ProjectedResidualItem, "id" | "type" | "reviewAt" | "executableNow" | "ownerSkills" | "closeCondition" | "requiredEvidence">>;
    nonEffectiveAcceptedExceptionItems: Array<Pick<ProjectedResidualItem, "id" | "reviewAt" | "effectiveExceptionStatus" | "ownerSkills" | "closeCondition" | "requiredEvidence">>;
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

type BuildOptions = {
  root?: string;
  now?: Date;
  generatedAt?: string;
};

function main(): void {
  console.log(JSON.stringify(buildSupportBundlePreview(), null, 2));
}

export function buildSupportBundlePreview(options: BuildOptions = {}): SupportBundlePreview {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const packageJson = readJson(root, "package.json");
  const ledger = readResidualLedgerV2({ root, file: residualSource, now });
  const residuals = ledger.items.map((item) => projectResidual(item, root, now));
  const version = stringValue(packageJson.version, "0.0.0");
  const previewWithoutHash = {
    schemaVersion: 1,
    generatedAt: options.generatedAt ?? now.toISOString(),
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
      "data lifecycle capability status",
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
    dataLifecycle: {
      categories: [
        {
          category: "relational_study_records",
          storageClass: "postgresql",
          backupCoverage: "documented",
          retentionSource: "not_configured",
          exportSupport: "not_supported",
          deletionSupport: "not_supported",
          migrationSupport: "not_supported",
        },
        {
          category: "attachment_binaries",
          storageClass: "private_upload_directory",
          backupCoverage: "documented",
          retentionSource: "not_configured",
          exportSupport: "not_supported",
          deletionSupport: "not_supported",
          migrationSupport: "not_supported",
        },
        {
          category: "auth_session_state",
          storageClass: "postgresql_and_http_only_cookie",
          backupCoverage: "documented",
          retentionSource: "configured",
          exportSupport: "not_supported",
          deletionSupport: "not_supported",
          migrationSupport: "not_supported",
        },
        {
          category: "ai_provider_transient_context",
          storageClass: "request_memory_only",
          backupCoverage: "not_applicable",
          retentionSource: "not_applicable",
          exportSupport: "metadata_only",
          deletionSupport: "not_supported",
          migrationSupport: "not_supported",
        },
        {
          category: "operational_evidence_and_backups",
          storageClass: "operator_managed_files",
          backupCoverage: "documented",
          retentionSource: "configured",
          exportSupport: "metadata_only",
          deletionSupport: "not_supported",
          migrationSupport: "not_supported",
        }
      ],
      doesNotInspect: [
        "database rows",
        "attachment contents",
        "backup archives",
        "private environment values",
        "session values",
        "AI transient context text"
      ]
    },
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
      residualRiskIds: residuals.map((item) => item.id),
    },
    residuals: {
      source: residualSource,
      total: residuals.length,
      countsByType: countBy(residuals, "type"),
      dueSoonOrExecutable: residuals
        .filter((item) => item.executableNow || isDueSoon(item.reviewAt, now) || isNonEffectiveAcceptedException(item))
        .map((item) => ({
          id: item.id,
          type: item.type,
          reviewAt: item.reviewAt,
          executableNow: item.executableNow,
          ownerSkills: item.ownerSkills,
          closeCondition: item.closeCondition,
          requiredEvidence: item.requiredEvidence,
        })),
      nonEffectiveAcceptedExceptionItems: residuals
        .filter(isNonEffectiveAcceptedException)
        .map((item) => ({
          id: item.id,
          reviewAt: item.reviewAt,
          effectiveExceptionStatus: item.effectiveExceptionStatus,
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

  return preview;
}

function projectResidual(item: ResidualItemV2, root: string, now: Date): ProjectedResidualItem {
  return {
    ...item,
    executableNow: effectiveExecutableNow(item, { root, now }),
    effectiveExceptionStatus: effectiveExceptionStatus(item, now),
    acceptedExceptionEffective: isAcceptedExceptionEffective(item, now),
  };
}

function isNonEffectiveAcceptedException(item: ProjectedResidualItem): boolean {
  return item.type === "accepted-exception" && !item.acceptedExceptionEffective;
}

function isDueSoon(reviewAt: string, now: Date): boolean {
  const timestamp = Date.parse(`${reviewAt}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return false;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.floor((timestamp - todayUtc) / 86_400_000);
  return days >= 0 && days <= 14;
}

function countBy(items: ProjectedResidualItem[], key: keyof ProjectedResidualItem): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key]);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function readJson(root: string, filePath: string): JsonRecord {
  const absolutePath = path.resolve(root, filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`file not found: ${filePath}`);
  }
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8")) as unknown;
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL support bundle preview: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
}
