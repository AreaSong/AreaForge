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

/** 审计保留曾经关联的事实；页面只展示当前仍属于本人工作区的有效来源。 */
export async function filterCurrentSessionEvidence(
  client: Pick<Prisma.TransactionClient, "note" | "mistake" | "masteryRetest">,
  actorId: string,
  workspaceId: string,
  receipts: StudySessionEvidenceReceiptDto[],
): Promise<StudySessionEvidenceReceiptDto[]> {
  const ids = (type: StudySessionEvidenceReceiptDto["evidenceType"]) => receipts.filter((row) => row.evidenceType === type).map((row) => row.evidenceId);
  const [notes, mistakes, retests] = await Promise.all([
    client.note.findMany({ where: { id: { in: ids("note") }, ownerUserId: actorId, archivedAt: null, subject: { workspaceId } }, select: { id: true, title: true } }),
    client.mistake.findMany({ where: { id: { in: ids("mistake") }, ownerUserId: actorId, archivedAt: null, subject: { workspaceId } }, select: { id: true, title: true } }),
    client.masteryRetest.findMany({ where: { id: { in: ids("retest") }, ownerUserId: actorId, syllabusNode: { subject: { workspaceId } } }, select: { id: true } }),
  ]);
  const labels = new Map<string, string>([
    ...notes.map((row) => [`note:${row.id}`, row.title] as const),
    ...mistakes.map((row) => [`mistake:${row.id}`, row.title] as const),
  ]);
  const visible = new Set([...labels.keys(), ...retests.map((row) => `retest:${row.id}`)]);
  return receipts.filter((row) => visible.has(`${row.evidenceType}:${row.evidenceId}`))
    .map((row) => ({ ...row, label: labels.get(`${row.evidenceType}:${row.evidenceId}`) ?? row.label }));
}
