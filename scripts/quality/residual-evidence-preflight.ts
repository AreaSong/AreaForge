import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ValidationIssue } from "./record-validator-common";

type ResidualItem = {
  id: string;
  type: string;
  currentImpact: string;
  closeCondition: string;
  requiredEvidence: string;
  ownerSkills: string[];
};

type ResidualLedger = {
  schemaVersion?: number;
  source?: string;
  items?: ResidualItem[];
};

type EvidencePathStatus = "present" | "missing" | "unsafe" | "not_file" | "empty";

type EvidencePathCheck = {
  path: string;
  status: EvidencePathStatus;
  sizeBytes: number | null;
  reason: string | null;
};

type ResidualEvidenceRecord = {
  id: string;
  type: string;
  reviewStatus: "ready_for_human_review" | "needs_attention";
  pathsPresent: EvidencePathCheck[];
  pathsMissing: EvidencePathCheck[];
  pathsUnsafe: EvidencePathCheck[];
  nonPathRequirements: string[];
  unresolvedPlaceholders: string[];
};

export type ResidualEvidencePreflight = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "residual_evidence_preflight";
  status: "ready_for_human_review" | "needs_attention" | "blocked";
  source: "docs/development/residual-risk-ledger.json";
  closesResidual: false;
  residualCount: number;
  records: ResidualEvidenceRecord[];
  blockedBy: ValidationIssue[];
  doesNotProve: string[];
  forbiddenActions: string[];
  sideEffects: {
    networkRequested: false;
    serverCommandAttempted: false;
    productionReadAttempted: false;
    productionWriteAttempted: false;
    evidenceFileContentRead: false;
    secretValuePrinted: false;
    residualLedgerUpdated: false;
    residualClosed: false;
    validatorExecuted: false;
  };
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    productionReadAttempted: false;
    productionWriteAttempted: false;
    evidenceFileContentRead: false;
    secretValuePrinted: false;
    residualLedgerUpdated: false;
    residualClosed: false;
    validatorExecuted: false;
  };
  preflightHash: string;
};

type BuildOptions = {
  root?: string;
  generatedAt?: string;
};

const ledgerPath = "docs/development/residual-risk-ledger.json";
const pathPattern = /\b(?:docs|tasks|workflow|ops|scripts)\/[A-Za-z0-9._~@+%/-]+/g;
const commandPattern = /\bpnpm\s+[a-z0-9][a-z0-9:.-]*/gi;
const allowedExtensions = new Set([".json", ".md", ".txt"]);
const allowedRoots = [
  "docs/development/",
  "docs/deployment/",
  "tasks/",
  "workflow/",
  "ops/",
  "scripts/",
];
const forbiddenPathTokens = [
  ".env",
  "updater.env",
  "id_rsa",
  "id_ed25519",
  "private-key",
  "secret",
  "token",
  "password",
];
const unresolvedPlaceholderPatterns = [
  /后续[^、，。;\n]*/g,
  /post-v[0-9][^、，。;\n]*/gi,
  /<[^>]+>/g,
  /待[^、，。;\n]*/g,
  /缺[^、，。;\n]*/g,
];

export function buildResidualEvidencePreflight(options: BuildOptions = {}): ResidualEvidencePreflight {
  const root = options.root ?? process.cwd();
  const blockedBy: ValidationIssue[] = [];
  const ledger = readLedger(root, blockedBy);
  const records = (ledger.items ?? []).map((item) => buildRecord(root, item));
  const hasNeedsAttention = records.some((record) =>
    record.pathsMissing.length > 0 ||
    record.pathsUnsafe.length > 0 ||
    record.unresolvedPlaceholders.length > 0 ||
    record.nonPathRequirements.length > 0
  );
  const resultWithoutHash = {
    schemaVersion: 1 as const,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    mode: "residual_evidence_preflight" as const,
    status: blockedBy.length > 0
      ? "blocked" as const
      : hasNeedsAttention ? "needs_attention" as const : "ready_for_human_review" as const,
    source: ledgerPath as const,
    closesResidual: false as const,
    residualCount: ledger.items?.length ?? 0,
    records,
    blockedBy,
    doesNotProve: [
      "residual risk closure",
      "current production health",
      "latest release state",
      "referenced validator success",
      "evidence content correctness",
      "maintenance owner approval",
    ],
    forbiddenActions: [
      "execute_server_command",
      "read_or_print_secret_values",
      "read_evidence_file_content",
      "copy_secret_files",
      "perform_backup",
      "perform_restore",
      "run_migration",
      "apply_update",
      "rollback_release",
      "write_database",
      "write_upload_directory",
      "execute_validators",
      "update_residual_ledger",
      "close_residual_risk",
    ],
    sideEffects: {
      networkRequested: false as const,
      serverCommandAttempted: false as const,
      productionReadAttempted: false as const,
      productionWriteAttempted: false as const,
      evidenceFileContentRead: false as const,
      secretValuePrinted: false as const,
      residualLedgerUpdated: false as const,
      residualClosed: false as const,
      validatorExecuted: false as const,
    },
    safetyFacts: {
      readOnly: true as const,
      networkRequested: false as const,
      serverCommandAttempted: false as const,
      productionReadAttempted: false as const,
      productionWriteAttempted: false as const,
      evidenceFileContentRead: false as const,
      secretValuePrinted: false as const,
      residualLedgerUpdated: false as const,
      residualClosed: false as const,
      validatorExecuted: false as const,
    },
  };

  return {
    ...resultWithoutHash,
    preflightHash: hashPreflight(resultWithoutHash),
  };
}

function buildRecord(root: string, item: ResidualItem): ResidualEvidenceRecord {
  const allPaths = extractEvidencePaths(item.requiredEvidence).map((evidencePath) => checkEvidencePath(root, evidencePath));
  const pathsPresent = allPaths.filter((item): item is EvidencePathCheck & { status: "present" } => item.status === "present");
  const pathsMissing = allPaths.filter((item) => item.status === "missing" || item.status === "not_file" || item.status === "empty");
  const pathsUnsafe = allPaths.filter((item) => item.status === "unsafe");
  const unresolvedPlaceholders = extractUnresolvedPlaceholders(item.requiredEvidence);
  const nonPathRequirements = extractNonPathRequirements(item.requiredEvidence);

  return {
    id: item.id,
    type: item.type,
    reviewStatus: pathsMissing.length > 0 || pathsUnsafe.length > 0 || unresolvedPlaceholders.length > 0 || nonPathRequirements.length > 0
      ? "needs_attention"
      : "ready_for_human_review",
    pathsPresent,
    pathsMissing,
    pathsUnsafe,
    nonPathRequirements,
    unresolvedPlaceholders,
  };
}

function checkEvidencePath(root: string, evidencePath: string): EvidencePathCheck {
  const unsafeReason = unsafeEvidencePathReason(evidencePath);
  if (unsafeReason) {
    return { path: evidencePath, status: "unsafe", sizeBytes: null, reason: unsafeReason };
  }

  const fullPath = path.join(root, evidencePath);
  if (!existsSync(fullPath)) {
    return { path: evidencePath, status: "missing", sizeBytes: null, reason: "missing" };
  }

  const stat = statSync(fullPath);
  if (!stat.isFile()) {
    return { path: evidencePath, status: "not_file", sizeBytes: null, reason: "not a file" };
  }
  if (stat.size === 0) {
    return { path: evidencePath, status: "empty", sizeBytes: 0, reason: "empty file" };
  }

  return {
    path: evidencePath,
    status: "present",
    sizeBytes: stat.size,
    reason: null,
  };
}

function unsafeEvidencePathReason(evidencePath: string): string | null {
  if (path.isAbsolute(evidencePath)) return "must be repository-relative";
  if (evidencePath.split("/").includes("..")) return "must not contain path traversal";
  if (!allowedRoots.some((root) => evidencePath.startsWith(root))) {
    return `must start with one of ${allowedRoots.join(", ")}`;
  }
  const extension = path.extname(evidencePath);
  if (!allowedExtensions.has(extension)) {
    return `must use one of ${[...allowedExtensions].join(", ")} evidence extensions`;
  }
  const lower = evidencePath.toLowerCase();
  const forbidden = forbiddenPathTokens.find((token) => lower.includes(token));
  if (forbidden) return `must not reference secret-like path token ${forbidden}`;
  return null;
}

function extractEvidencePaths(value: string): string[] {
  return [...new Set((value.match(pathPattern) ?? [])
    .map((item) => item.replace(/[.,;:，。；：、)）\]]+$/g, ""))
    .filter(Boolean))];
}

function extractNonPathRequirements(value: string): string[] {
  const withoutPaths = value
    .replace(pathPattern, "")
    .split(/[、,，；;。\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !/^(通过|记录|证据|成功|摘要|说明)$/.test(item));
  return [...new Set(withoutPaths)];
}

function extractUnresolvedPlaceholders(value: string): string[] {
  const placeholders = unresolvedPlaceholderPatterns.flatMap((pattern) =>
    [...value.matchAll(pattern)].map((match) => (match[0] ?? "").trim()).filter(Boolean)
  );
  return [...new Set(placeholders)];
}

function readLedger(root: string, blockedBy: ValidationIssue[]): ResidualLedger {
  const fullPath = path.join(root, ledgerPath);
  if (!existsSync(fullPath)) {
    blockedBy.push({ field: ledgerPath, message: "missing residual ledger" });
    return { items: [] };
  }
  try {
    return JSON.parse(readFileSync(fullPath, "utf8")) as ResidualLedger;
  } catch (error) {
    blockedBy.push({ field: ledgerPath, message: error instanceof Error ? error.message : "invalid JSON" });
    return { items: [] };
  }
}

function hashPreflight(value: Omit<ResidualEvidencePreflight, "preflightHash">): string {
  return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isMain(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMain()) {
  const result = buildResidualEvidencePreflight();
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") {
    process.exit(1);
  }
}
