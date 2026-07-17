import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  effectiveExceptionStatus,
  effectiveExecutableNow,
  isAcceptedExceptionEffective,
  readResidualLedgerV2,
  ResidualLedgerValidationError,
  type EffectiveExceptionStatus,
  type ResidualItemV2,
  type ResidualLedgerIssue,
} from "../quality/residual-ledger-common";

type PreviewStatus = "no_promotion_candidate" | "ready_for_human_review" | "needs_attention" | "blocked";
type PromotionState =
  | "active_task_bound"
  | "waiver_backed"
  | "backlog_bound_not_executable"
  | "done_task_historical"
  | "not_executable"
  | "accepted_exception_effective"
  | "accepted_exception_non_effective";

export type ResidualPromotionPreviewRecord = {
  residualId: string;
  type: ResidualItemV2["type"];
  rawExecutableNow: boolean;
  effectiveExecutableNow: boolean;
  taskRefs: string[];
  activeTaskRefs: string[];
  waiverStatus: "none" | "current";
  acceptedExceptionStatus: EffectiveExceptionStatus;
  promotionState: PromotionState;
  eligibleForHumanPromotionReview: boolean;
  blockedBy: string[];
  writesTask: false;
  writesLedger: false;
};

export type ResidualPromotionPreview = {
  schemaVersion: 1;
  generatedAt: string;
  mode: "read_only_residual_task_promotion_preview";
  status: PreviewStatus;
  source: {
    path: "docs/development/residual-risk-ledger.json";
    schemaVersion: 2 | null;
    sha256: string | null;
    validationStatus: "valid" | "invalid" | "missing";
  };
  sourceOfTruth: false;
  records: ResidualPromotionPreviewRecord[];
  blockedBy: ResidualLedgerIssue[];
  doesNotProve: string[];
  forbiddenActions: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    taskWriteAttempted: false;
    residualLedgerWriteAttempted: false;
    productionWriteAttempted: false;
    secretValuePrinted: false;
  };
  previewHash: string;
};

type BuildOptions = {
  root?: string;
  now?: Date;
  generatedAt?: string;
};

const ledgerPath = "docs/development/residual-risk-ledger.json" as const;

export function buildResidualPromotionPreview(options: BuildOptions = {}): ResidualPromotionPreview {
  const root = options.root ?? process.cwd();
  const now = options.now ?? new Date();
  const generatedAt = options.generatedAt ?? now.toISOString();
  const raw = readOptional(root, ledgerPath);
  if (raw === null) {
    return finalizePreview(basePreview(generatedAt, "blocked", "missing", null, null, [], [{
      field: ledgerPath,
      message: "missing residual ledger",
    }]));
  }

  try {
    const ledger = readResidualLedgerV2({ root, file: ledgerPath, now });
    const records = ledger.items.map((item) => buildRecord(item, root, now));
    const status: PreviewStatus = records.some((item) => item.promotionState === "accepted_exception_non_effective")
      ? "needs_attention"
      : records.some((item) => item.eligibleForHumanPromotionReview)
        ? "ready_for_human_review"
        : "no_promotion_candidate";
    return finalizePreview(basePreview(
      generatedAt,
      status,
      "valid",
      ledger.schemaVersion,
      sourceHash(raw),
      records,
      [],
    ));
  } catch (error) {
    const issues = error instanceof ResidualLedgerValidationError
      ? error.issues
      : [{ field: ledgerPath, message: error instanceof Error ? error.message : String(error) }];
    return finalizePreview(basePreview(generatedAt, "blocked", "invalid", null, sourceHash(raw), [], issues));
  }
}

export function verifyResidualPromotionPreviewHash(preview: ResidualPromotionPreview): boolean {
  const { previewHash: _previewHash, ...withoutHash } = preview;
  return preview.previewHash === hashCanonical(withoutHash);
}

function buildRecord(item: ResidualItemV2, root: string, now: Date): ResidualPromotionPreviewRecord {
  const activeTaskRefs = item.taskRefs.filter((taskRef) => taskRef.startsWith("tasks/active/"));
  const executable = effectiveExecutableNow(item, { root, now });
  const exceptionStatus = effectiveExceptionStatus(item, now);
  const exceptionEffective = isAcceptedExceptionEffective(item, now);
  const promotionState = classifyPromotionState(item, activeTaskRefs, executable, exceptionEffective);
  const eligible = promotionState === "waiver_backed";
  return {
    residualId: item.id,
    type: item.type,
    rawExecutableNow: item.executableNow,
    effectiveExecutableNow: executable,
    taskRefs: item.taskRefs,
    activeTaskRefs,
    waiverStatus: item.taskPromotionWaiver ? "current" : "none",
    acceptedExceptionStatus: exceptionStatus,
    promotionState,
    eligibleForHumanPromotionReview: eligible,
    blockedBy: recordBlockers(promotionState, exceptionStatus),
    writesTask: false,
    writesLedger: false,
  };
}

function classifyPromotionState(
  item: ResidualItemV2,
  activeTaskRefs: string[],
  executable: boolean,
  exceptionEffective: boolean,
): PromotionState {
  if (item.type === "accepted-exception") {
    return exceptionEffective ? "accepted_exception_effective" : "accepted_exception_non_effective";
  }
  if (activeTaskRefs.length > 0) return "active_task_bound";
  if (executable && item.taskPromotionWaiver) return "waiver_backed";
  if (item.taskRefs.some((taskRef) => taskRef.startsWith("tasks/backlog/"))) return "backlog_bound_not_executable";
  if (item.taskRefs.some((taskRef) => taskRef.startsWith("tasks/done/"))) return "done_task_historical";
  return "not_executable";
}

function recordBlockers(state: PromotionState, exceptionStatus: EffectiveExceptionStatus): string[] {
  switch (state) {
    case "active_task_bound":
    case "waiver_backed":
      return [];
    case "accepted_exception_effective":
      return ["accepted_exception_is_not_task_work"];
    case "accepted_exception_non_effective":
      return [`accepted_exception_${exceptionStatus ?? "invalid"}`];
    case "backlog_bound_not_executable":
      return ["residual_not_executable", "backlog_task_is_not_active"];
    case "done_task_historical":
      return ["residual_not_executable", "done_task_is_historical"];
    case "not_executable":
      return ["residual_not_executable"];
  }
}

function basePreview(
  generatedAt: string,
  status: PreviewStatus,
  validationStatus: ResidualPromotionPreview["source"]["validationStatus"],
  schemaVersion: 2 | null,
  sha256: string | null,
  records: ResidualPromotionPreviewRecord[],
  blockedBy: ResidualLedgerIssue[],
): Omit<ResidualPromotionPreview, "previewHash"> {
  return {
    schemaVersion: 1,
    generatedAt,
    mode: "read_only_residual_task_promotion_preview",
    status,
    source: { path: ledgerPath, schemaVersion, sha256, validationStatus },
    sourceOfTruth: false,
    records,
    blockedBy,
    doesNotProve: [
      "permission to promote a residual",
      "task creation or task movement",
      "residual ledger mutation",
      "residual risk closure",
      "production readiness or health",
    ],
    forbiddenActions: [
      "create_or_move_task",
      "write_residual_ledger",
      "apply_task_promotion",
      "close_residual_risk",
      "execute_server_command",
      "read_or_print_secrets",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      serverCommandAttempted: false,
      taskWriteAttempted: false,
      residualLedgerWriteAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
    },
  };
}

function finalizePreview(value: Omit<ResidualPromotionPreview, "previewHash">): ResidualPromotionPreview {
  return { ...value, previewHash: hashCanonical(value) };
}

function readOptional(root: string, file: string): string | null {
  const target = path.join(root, file);
  return existsSync(target) ? readFileSync(target, "utf8") : null;
}

function sourceHash(raw: string): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isMain(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

if (isMain()) {
  const preview = buildResidualPromotionPreview();
  console.log(JSON.stringify(preview, null, 2));
  if (preview.status === "blocked") process.exit(1);
}
