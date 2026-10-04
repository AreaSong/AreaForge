import type { Prisma } from "@areaforge/db";
import type { StudySessionEvidenceReceiptDto } from "@/lib/contracts";

export function parseSessionEvidenceReceipt(
  value: Prisma.JsonValue | undefined | null,
): StudySessionEvidenceReceiptDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (
    (value.evidenceType !== "note" && value.evidenceType !== "mistake" && value.evidenceType !== "retest") ||
    typeof value.evidenceId !== "string" ||
    typeof value.label !== "string"
  ) return null;
  return {
    evidenceType: value.evidenceType,
    evidenceId: value.evidenceId,
    label: value.label,
  };
}
