export interface ReportHistorySnapshotView {
  format: "current" | "legacy";
  metrics: {
    totalMinutes: number | null;
    effectiveMinutes: number | null;
    taskCompletionRate: number | null;
    reviewCompletionRate: number | null;
    debtCount: number | null;
    lowConversionCount: number | null;
  };
  weakness: {
    title: string;
    detail: string;
    reasons: string[];
  } | null;
  mustPressIssue: string | null;
  stageAdjustment: string | null;
}

export function readReportHistorySnapshot(value: unknown): ReportHistorySnapshotView {
  const snapshot = asRecord(value);
  const metrics = asRecord(snapshot?.metrics);
  const weakness = asRecord(snapshot?.weakness);
  const strategy = asRecord(snapshot?.strategy);
  const nextCycleDraft = asRecord(snapshot?.nextCycleDraft);

  return {
    format: metrics ? "current" : "legacy",
    metrics: {
      totalMinutes: numberValue(metrics?.totalMinutes ?? snapshot?.totalMinutes),
      effectiveMinutes: numberValue(metrics?.effectiveMinutes ?? snapshot?.effectiveMinutes),
      taskCompletionRate: numberValue(metrics?.taskCompletionRate ?? snapshot?.completionRate),
      reviewCompletionRate: numberValue(metrics?.reviewCompletionRate),
      debtCount: numberValue(metrics?.debtCount),
      lowConversionCount: numberValue(metrics?.lowConversionCount ?? snapshot?.lowConversionCount),
    },
    weakness: weaknessView(weakness),
    mustPressIssue: stringValue(strategy?.mustPressIssue),
    stageAdjustment: stringValue(nextCycleDraft?.stageAdjustment),
  };
}

export function readReportDecisionFocus(value: unknown): string | null {
  const focus = asRecord(value)?.focus;
  if (typeof focus === "string") return focus.trim() || null;
  if (!Array.isArray(focus)) return null;
  const labels = focus.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  return labels.length > 0 ? labels.join("、") : null;
}

function weaknessView(value: Record<string, unknown> | null): ReportHistorySnapshotView["weakness"] {
  const title = stringValue(value?.title);
  const detail = stringValue(value?.detail);
  const reasons = Array.isArray(value?.reasons)
    ? value.reasons.filter((reason): reason is string => typeof reason === "string" && Boolean(reason.trim())).map((reason) => reason.trim())
    : [];
  return title && detail ? { title, detail, reasons } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
