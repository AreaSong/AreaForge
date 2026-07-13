import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type PreviewStatus = "ready" | "needs_evidence" | "blocked";
type EvidenceStatus = "present" | "root_only" | "missing" | "invalid" | "not_applicable";
type JsonRecord = Record<string, unknown>;

type EvidenceItem = {
  key: string;
  category: "backup_manifest" | "release_evidence_bundle" | "restore_dry_run" | "attachment_integrity" | "rollback";
  status: EvidenceStatus;
  evidence: string;
  requiredEvidence: string[];
  residualRiskIds: string[];
  metadata: Record<string, unknown>;
};

type GapType =
  | "release_evidence_backup_hash"
  | "release_evidence_bundle_hash"
  | "backup_config_reference"
  | "restore_dry_run_result"
  | "attachment_integrity_result"
  | "rollback_target";

type BlockingScope =
  | "release_evidence_validator"
  | "long_term_live_gate"
  | "backup_restore_preview_ready"
  | "restore_dry_run_claim"
  | "rollback_readiness"
  | "maintenance_handoff";

type BlockingGap = {
  key: string;
  category: EvidenceItem["category"];
  gapType: GapType;
  status: Exclude<EvidenceStatus, "present" | "not_applicable">;
  sourceInput: "release_record" | "restore_drill_record";
  sourceField: string;
  safeEvidence: string;
  requiredEvidence: string[];
  residualRiskIds: string[];
  blocks: BlockingScope[];
};

type BackupRestorePreview = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "metadata_only_backup_restore_preview";
  backupRestorePreviewHash: string;
  status: PreviewStatus;
  app: {
    name: string;
    version: string;
    releaseTag: string;
  };
  sourceInputs: {
    releaseRecordPath: string;
    releaseRecordHash: string;
    restoreDrillRecordPath: string | null;
    restoreDrillRecordHash: string | null;
  };
  capabilities: string[];
  evidenceInventory: EvidenceItem[];
  blockingGaps: BlockingGap[];
  restoreDryRun: {
    status: EvidenceStatus;
    evidence: string;
    doesNotApplyRestore: true;
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
    previewOnly: true;
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
    rawLogIncluded: false;
    residualLedgerUpdated: false;
  };
};

const defaultReleaseRecordPath = "docs/development/release-v0.1.7-record.md";
const projectRoot = realpathSync(process.cwd());
const tempRoot = path.resolve(tmpdir());
const maxRecordBytes = 2 * 1024 * 1024;
const allowedRecordExtensions = new Set([".md", ".txt", ".json"]);

function main(): void {
  const packageJson = readJson("package.json");
  const releaseRecordPath = process.env.AREAFORGE_BACKUP_PREVIEW_RELEASE_RECORD ?? defaultReleaseRecordPath;
  const restoreDrillRecordPath = process.env.AREAFORGE_BACKUP_PREVIEW_RESTORE_DRILL_RECORD ?? null;
  const releaseRecord = readAllowedRecord(releaseRecordPath, "release record");
  const releaseFields = parseFlatKeyValueRecord(releaseRecord.content);
  const restoreRecord = restoreDrillRecordPath
    ? readAllowedRecord(restoreDrillRecordPath, "restore drill record")
    : null;
  const restoreFields = restoreRecord ? parseFlatKeyValueRecord(restoreRecord.content) : new Map<string, string>();
  const version = stringValue(packageJson.version, "0.0.0");
  const inventory = buildInventory(releaseFields, restoreFields, Boolean(restoreRecord));
  const previewWithoutHash = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "metadata_only_backup_restore_preview",
    backupRestorePreviewHash: "",
    status: previewStatus(inventory),
    app: {
      name: stringValue(packageJson.name, "@areasong/areaforge"),
      version,
      releaseTag: stringValue(releaseFields.get("releaseTag"), `v${version}`),
    },
    sourceInputs: {
      releaseRecordPath: releaseRecord.displayPath,
      releaseRecordHash: `sha256:${sha256(releaseRecord.content)}`,
      restoreDrillRecordPath: restoreRecord?.displayPath ?? null,
      restoreDrillRecordHash: restoreRecord ? `sha256:${sha256(restoreRecord.content)}` : null,
    },
    capabilities: [
      "inspect_release_backup_metadata",
      "classify_root_only_backup_hash_gaps",
      "classify_release_evidence_bundle_hash_gap",
      "derive_machine_readable_blocking_gaps",
      "summarize_restore_dry_run_record_presence",
      "compute_preview_hash",
    ],
    evidenceInventory: inventory,
    blockingGaps: buildBlockingGaps(inventory),
    restoreDryRun: restoreDryRunSummary(inventory),
    claimBoundary: {
      canClaim: [
        "backup and restore evidence metadata has been inventoried",
        "root-only backup hash gaps are explicit",
        "restore dry-run record presence is classified",
      ],
      cannotClaim: [
        "backup archive exists",
        "release evidence bundle exists",
        "restore apply was executed",
        "production restore is authorized",
        "database dump or upload archive was read",
        "release evidence validator passes",
        "long-term live gate passes",
      ],
    },
    doesNotProve: [
      "backup archive exists",
      "database dump integrity beyond supplied metadata",
      "upload archive integrity beyond supplied metadata",
      "release evidence bundle integrity beyond supplied metadata",
      "production restore authorization",
      "restore apply execution",
      "migration execution",
      "rollback execution",
      "release evidence validator success",
      "residual risk closure",
    ],
    forbiddenActions: [
      "execute_server_command",
      "perform_backup",
      "perform_restore",
      "run_migration",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "read_or_print_secret_values",
      "copy_backup_archive",
      "read_database_dump",
      "read_upload_archive",
      "read_private_env",
      "update_residual_ledger",
    ],
    safetyFacts: {
      readOnly: true,
      metadataOnly: true,
      previewOnly: true,
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
      rawLogIncluded: false,
      residualLedgerUpdated: false,
    },
  } satisfies BackupRestorePreview;

  const preview: BackupRestorePreview = {
    ...previewWithoutHash,
    backupRestorePreviewHash: hashPreview(previewWithoutHash),
  };

  console.log(JSON.stringify(preview, null, 2));
}

function buildInventory(
  releaseFields: Map<string, string>,
  restoreFields: Map<string, string>,
  hasRestoreRecord: boolean,
): EvidenceItem[] {
  return [
    backupHashItem("databaseBackupSha256", "database backup sha256", releaseFields),
    backupHashItem("uploadsBackupSha256", "uploads backup sha256", releaseFields),
    backupHashItem("envBackupSha256", "production env backup sha256", releaseFields),
    releaseEvidenceBundleHashItem(releaseFields),
    configPathItem("composeConfigBackupPath", "compose config backup reference", releaseFields),
    configPathItem("nginxConfigBackupPath", "Nginx config backup reference", releaseFields),
    restoreResultItem("databaseRestoreResult", "database restore dry-run result", restoreFields, hasRestoreRecord),
    restoreResultItem("uploadsRestoreResult", "uploads restore dry-run result", restoreFields, hasRestoreRecord),
    restoreResultItem("attachmentHashMatched", "attachment metadata/file integrity result", restoreFields, hasRestoreRecord),
    rollbackItem(releaseFields),
  ];
}

function backupHashItem(field: string, label: string, fields: Map<string, string>): EvidenceItem {
  const value = fields.get(field) ?? "";
  const status = classifyHashEvidence(value);
  return {
    key: field,
    category: "backup_manifest",
    status,
    evidence: evidenceText(label, status),
    requiredEvidence: [`${label} as sha256:<64 hex> or documented redacted root-only source`],
    residualRiskIds: status === "present" ? [] : ["AF-RISK-OPS-001"],
    metadata: {
      hashPresent: status === "present",
      rootOnly: status === "root_only",
      valueClass: classifyValue(value),
    },
  };
}

function releaseEvidenceBundleHashItem(fields: Map<string, string>): EvidenceItem {
  const value = fields.get("releaseEvidenceBundleHash") ?? "";
  const status = classifyHashEvidence(value);
  return {
    key: "releaseEvidenceBundleHash",
    category: "release_evidence_bundle",
    status,
    evidence: evidenceText("release evidence bundle hash", status),
    requiredEvidence: ["release evidence bundle hash as sha256:<64 hex> or documented redacted root-only source"],
    residualRiskIds: status === "present" ? [] : ["AF-RISK-OPS-001"],
    metadata: {
      hashPresent: status === "present",
      rootOnly: status === "root_only",
      valueClass: classifyValue(value),
    },
  };
}

function configPathItem(field: string, label: string, fields: Map<string, string>): EvidenceItem {
  const value = fields.get(field) ?? "";
  const status = value ? (isRootOnlyMarker(value) ? "root_only" : "present") : "missing";
  return {
    key: field,
    category: "backup_manifest",
    status,
    evidence: evidenceText(label, status),
    requiredEvidence: [`${label} redacted path or root-only update-record pointer`],
    residualRiskIds: status === "missing" || status === "invalid" ? ["AF-RISK-OPS-001"] : [],
    metadata: {
      pathEvidenceClass: classifyValue(value),
      rawPathIncluded: false,
    },
  };
}

function restoreResultItem(
  field: string,
  label: string,
  fields: Map<string, string>,
  hasRestoreRecord: boolean,
): EvidenceItem {
  if (!hasRestoreRecord) {
    return {
      key: field,
      category: field === "attachmentHashMatched" ? "attachment_integrity" : "restore_dry_run",
      status: "missing",
      evidence: `${label} record not supplied`,
      requiredEvidence: [`redacted restore drill record with ${field}=pass or not-applicable`],
      residualRiskIds: ["AF-RISK-OPS-004"],
      metadata: { restoreDrillRecordSupplied: false },
    };
  }
  const value = fields.get(field)?.toLowerCase() ?? "";
  const status: EvidenceStatus = value === "pass" || value === "not-applicable" ? "present" : value ? "invalid" : "missing";
  return {
    key: field,
    category: field === "attachmentHashMatched" ? "attachment_integrity" : "restore_dry_run",
    status,
    evidence: status === "present" ? `${label} is ${value}` : `${label} is ${value || "missing"}`,
    requiredEvidence: [`redacted restore drill record with ${field}=pass or not-applicable`],
    residualRiskIds: status === "present" ? [] : ["AF-RISK-OPS-004"],
    metadata: { restoreDrillRecordSupplied: true, result: value || null },
  };
}

function rollbackItem(fields: Map<string, string>): EvidenceItem {
  const version = fields.get("rollbackTargetVersion") ?? "";
  const image = fields.get("rollbackTargetImage") ?? "";
  const hasTarget = Boolean(version && /@sha256:[a-f0-9]{64}$/i.test(image));
  return {
    key: "rollbackTarget",
    category: "rollback",
    status: hasTarget ? "present" : "missing",
    evidence: hasTarget ? "rollback target version and immutable image digest are recorded" : "rollback target version or immutable image digest is missing",
    requiredEvidence: ["rollbackTargetVersion", "rollbackTargetImage with image@sha256"],
    residualRiskIds: hasTarget ? [] : ["AF-RISK-REL-001"],
    metadata: {
      rollbackTargetVersionPresent: Boolean(version),
      rollbackTargetImageDigestPresent: /@sha256:[a-f0-9]{64}$/i.test(image),
      rollbackTargetImageIncluded: false,
    },
  };
}

function restoreDryRunSummary(inventory: EvidenceItem[]): BackupRestorePreview["restoreDryRun"] {
  const restoreItems = inventory.filter((item) => item.category === "restore_dry_run" || item.category === "attachment_integrity");
  const status = restoreItems.every((item) => item.status === "present") ? "present" : "missing";
  return {
    status,
    evidence: status === "present"
      ? "restore dry-run metadata is present in the supplied redacted record"
      : "restore dry-run metadata is not supplied; preview remains inventory-only",
    doesNotApplyRestore: true,
  };
}

function buildBlockingGaps(inventory: EvidenceItem[]): BlockingGap[] {
  return inventory
    .filter((item) => item.status !== "present" && item.status !== "not_applicable")
    .map((item) => ({
      key: item.key,
      category: item.category,
      gapType: gapType(item),
      status: item.status as BlockingGap["status"],
      sourceInput: sourceInput(item),
      sourceField: item.key,
      safeEvidence: item.evidence,
      requiredEvidence: item.requiredEvidence,
      residualRiskIds: item.residualRiskIds,
      blocks: blockedScopes(item),
    }));
}

function gapType(item: EvidenceItem): GapType {
  if (item.key === "releaseEvidenceBundleHash") {
    return "release_evidence_bundle_hash";
  }
  if (item.key === "databaseBackupSha256" || item.key === "uploadsBackupSha256" || item.key === "envBackupSha256") {
    return "release_evidence_backup_hash";
  }
  if (item.key === "composeConfigBackupPath" || item.key === "nginxConfigBackupPath") {
    return "backup_config_reference";
  }
  if (item.category === "attachment_integrity") {
    return "attachment_integrity_result";
  }
  if (item.category === "restore_dry_run") {
    return "restore_dry_run_result";
  }
  return "rollback_target";
}

function sourceInput(item: EvidenceItem): BlockingGap["sourceInput"] {
  return item.category === "restore_dry_run" || item.category === "attachment_integrity"
    ? "restore_drill_record"
    : "release_record";
}

function blockedScopes(item: EvidenceItem): BlockingScope[] {
  if (item.key === "releaseEvidenceBundleHash") {
    return [
      "release_evidence_validator",
      "long_term_live_gate",
      "maintenance_handoff",
    ];
  }
  if (item.key === "databaseBackupSha256" || item.key === "uploadsBackupSha256" || item.key === "envBackupSha256") {
    return [
      "release_evidence_validator",
      "long_term_live_gate",
      "maintenance_handoff",
    ];
  }
  if (item.category === "restore_dry_run" || item.category === "attachment_integrity") {
    return [
      "restore_dry_run_claim",
      "backup_restore_preview_ready",
      "maintenance_handoff",
    ];
  }
  if (item.category === "rollback") {
    return [
      "rollback_readiness",
      "backup_restore_preview_ready",
      "maintenance_handoff",
    ];
  }
  return [
    "backup_restore_preview_ready",
    "maintenance_handoff",
  ];
}

function previewStatus(items: EvidenceItem[]): PreviewStatus {
  if (items.some((item) => item.status === "invalid")) return "blocked";
  if (items.some((item) => item.status !== "present" && item.status !== "not_applicable")) return "needs_evidence";
  return "ready";
}

function classifyHashEvidence(value: string): EvidenceStatus {
  if (!value) return "missing";
  if (/^(sha256:)?[a-f0-9]{64}$/i.test(value)) return "present";
  if (isRootOnlyMarker(value)) return "root_only";
  if (value.toLowerCase() === "not-applicable") return "not_applicable";
  return "invalid";
}

function evidenceText(label: string, status: EvidenceStatus): string {
  if (status === "present") return `${label} is present as metadata`;
  if (status === "root_only") return `${label} is recorded as root-only and not copied into repository evidence`;
  if (status === "not_applicable") return `${label} is not applicable`;
  if (status === "missing") return `${label} is missing`;
  return `${label} is present but invalid`;
}

function classifyValue(value: string): string {
  if (!value) return "missing";
  if (/^(sha256:)?[a-f0-9]{64}$/i.test(value)) return "sha256";
  if (isRootOnlyMarker(value)) return "root_only_pointer";
  if (value.toLowerCase() === "not-applicable") return "not_applicable";
  return "redacted_or_literal_metadata";
}

function isRootOnlyMarker(value: string): boolean {
  return /root-only|not-copied|recorded-in-server-update-record/i.test(value);
}

function parseFlatKeyValueRecord(record: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of record.split(/\r?\n/)) {
    const match = rawLine.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    fields.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return fields;
}

function readJson(file: string): JsonRecord {
  return JSON.parse(readProjectText(file)) as JsonRecord;
}

function readProjectText(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`required file not found: ${file}`);
  }
  return readFileSync(file, "utf8");
}

function readAllowedRecord(file: string, purpose: string): { content: string; displayPath: string } {
  const resolved = path.resolve(file);
  const realPath = assertAllowedRecordPath(resolved, purpose);
  const content = readFileSync(realPath, "utf8");
  if (containsSensitiveRecordContent(content)) {
    throw new Error(`${purpose} contains sensitive-looking values; use a redacted record`);
  }
  return {
    content,
    displayPath: displayPath(realPath),
  };
}

function assertAllowedRecordPath(resolvedPath: string, purpose: string): string {
  if (!existsSync(resolvedPath)) {
    throw new Error(`${purpose} not found or not readable`);
  }
  const realPath = realpathSync(resolvedPath);
  const stats = statSync(realPath);
  if (!stats.isFile()) {
    throw new Error(`${purpose} must be a redacted record file`);
  }
  if (stats.size > maxRecordBytes) {
    throw new Error(`${purpose} is too large for a metadata-only redacted record`);
  }
  if (!isInsideOrEqual(projectRoot, realPath) && !isInsideOrEqual(tempRoot, realPath)) {
    throw new Error(`${purpose} must be under the workspace or system temp directory`);
  }
  const lowerPath = realPath.replaceAll(path.sep, "/").toLowerCase();
  const baseName = path.basename(realPath).toLowerCase();
  const extension = path.extname(baseName);
  const forbiddenPathTerms = [
    "/.git/",
    "/node_modules/",
    "/.next/",
    "/apps/web/public/",
    "/public/",
    "/uploads/",
    "/backups/",
  ];
  if (!allowedRecordExtensions.has(extension) || forbiddenPathTerms.some((term) => lowerPath.includes(term))) {
    throw new Error(`${purpose} path is not an allowed redacted record file`);
  }
  const forbiddenNamePatterns = [
    /^\.env(?:\.|$)/,
    /^updater\.env$/,
    /password/,
    /secret/,
    /token/,
    /^id_(?:rsa|ed25519)$/,
    /cosign.*\.(?:key|pem)$/,
  ];
  const forbiddenExtensions = [".dump", ".sql", ".sqlite", ".db", ".tar", ".gz", ".tgz", ".zip", ".7z", ".pem", ".key", ".p12", ".pfx", ".log"];
  if (forbiddenNamePatterns.some((pattern) => pattern.test(baseName)) || forbiddenExtensions.some((item) => lowerPath.endsWith(item))) {
    throw new Error(`${purpose} path is not an allowed redacted record file`);
  }
  return realPath;
}

function containsSensitiveRecordContent(content: string): boolean {
  return [
    /\bDATABASE_URL\s*=/i,
    /\bpostgres(?:ql)?:\/\/[^\s]+/i,
    /\b(?:AI_API_KEY|OPENAI_API_KEY|AUTH_SESSION_SECRET|POSTGRES_PASSWORD|GITHUB_TOKEN|COSIGN_PASSWORD|PRIVATE_KEY)\s*[:=]/i,
    /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/,
  ].some((pattern) => pattern.test(content));
}

function displayPath(realPath: string): string {
  if (isInsideOrEqual(projectRoot, realPath)) {
    return path.relative(projectRoot, realPath) || ".";
  }
  if (isInsideOrEqual(tempRoot, realPath)) {
    return path.join("<tmp>", path.relative(tempRoot, realPath));
  }
  return "<redacted-record>";
}

function isInsideOrEqual(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function hashPreview(preview: Omit<BackupRestorePreview, "backupRestorePreviewHash">): string {
  return sha256(stableStringify({ ...preview, backupRestorePreviewHash: "" }));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

main();
