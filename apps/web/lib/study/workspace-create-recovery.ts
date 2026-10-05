import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";
import { requireWorkspaceOwner } from "@/lib/workspace/access-service";
import { buildPersistentCreateFingerprint } from "./persistent-idempotency";

export interface WorkspaceCreateInput {
  stableKey: string;
  name: string;
  targetExamDate?: string | null;
  stageSummary?: string | null;
  activate?: boolean;
  subjects?: Array<{ stableKey: string; name: string; color: string; sortOrder?: number; groupStableKey?: string | null }>;
  groups?: Array<{ stableKey: string; name: string; sortOrder?: number }>;
  takeoverSubjectIds?: string[];
}

export function workspaceCreateFingerprint(input: WorkspaceCreateInput): string {
  return buildPersistentCreateFingerprint("exam-workspace-create-v1", {
    stableKey: input.stableKey.trim(), name: input.name.trim(),
    targetExamDate: input.targetExamDate ? new Date(input.targetExamDate).toISOString() : null,
    stageSummary: input.stageSummary ?? null, activate: input.activate !== false,
    subjects: (input.subjects ?? []).map((subject, index) => ({
      stableKey: subject.stableKey.trim(), name: subject.name.trim(), color: subject.color,
      sortOrder: subject.sortOrder ?? (index + 1) * 10,
      groupStableKey: subject.groupStableKey?.trim() || null,
    })),
    groups: (input.groups ?? []).map((group) => ({
      stableKey: group.stableKey.trim(), name: group.name.trim(), sortOrder: group.sortOrder ?? null,
    })),
    takeoverSubjectIds: [...new Set(input.takeoverSubjectIds ?? [])].sort(),
  });
}

/** 调用方持有 actor 事务锁；恢复必须先于接管预览和任何写入。 */
export async function recoverWorkspaceCreation(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: WorkspaceCreateInput,
  fingerprint: string,
) {
  const existing = await tx.examWorkspace.findFirst({ where: { userId: actorId, stableKey: input.stableKey.trim() } });
  if (!existing) return null;
  const workspace = await requireWorkspaceOwner(tx, actorId, existing.id);
  const receipt = await tx.auditEvent.findFirst({
    where: { actorId, action: "EXAM_WORKSPACE_CREATED", entityType: "ExamWorkspace", entityId: workspace.id },
    orderBy: { createdAt: "desc" }, select: { metadata: true },
  });
  const metadata = receipt?.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !metadata.requestFingerprint) {
    throw new ApiError("WORKSPACE_STABLE_KEY_ALREADY_EXISTS", 409);
  }
  if (metadata.requestFingerprint !== fingerprint) throw new ApiError("WORKSPACE_CREATE_IDEMPOTENCY_CONFLICT", 409);
  if (input.activate !== false) {
    const current = getAuthEnv().AUTH_MULTI_USER_ENABLED
      ? await tx.workspaceSelection.findUnique({ where: { userId: actorId }, select: { workspaceId: true } })
      : null;
    if (workspace.status !== "ACTIVE" || (getAuthEnv().AUTH_MULTI_USER_ENABLED && current?.workspaceId !== workspace.id)) {
      throw new ApiError("WORKSPACE_CREATE_SELECTION_CHANGED", 409);
    }
  }
  return workspace;
}
