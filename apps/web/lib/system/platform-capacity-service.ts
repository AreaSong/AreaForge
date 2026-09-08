import { prisma } from "@areaforge/db";
import { getAuthEnv } from "@/lib/auth/env";
import type { CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/responses";
import { requireWorkspaceOwner } from "@/lib/workspace/access-service";
import { isPlatformOperatorEmail } from "./operator-policy";

const ACTIVE_JOB_STATUSES = ["QUEUED", "RUNNING", "PAUSED", "CANCEL_REQUESTED"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlatformCapacitySnapshotDto {
  contractVersion: "platform-capacity-v1";
  workspaceId: string;
  generatedAt: string;
  usage: {
    activeMemberCount: number;
    activeJobCount: number;
    exportJobCount24h: number;
    failedJobCount24h: number;
    attachmentCount: number;
    storageBytes: number;
  };
  queue: {
    oldestActiveJobAt: string | null;
    activeStatuses: readonly string[];
  };
  limitsConfigured: false;
  enforcementEnabled: false;
  capacityState: "OBSERVED_ONLY";
}

/**
 * Read-only capacity snapshot. No quota is invented here: policy limits and
 * write rejection remain behind a separate high-risk confirmation.
 */
export async function getPlatformCapacitySnapshot(
  actor: CurrentUser,
  workspaceId: string,
  now = new Date(),
): Promise<PlatformCapacitySnapshotDto> {
  if (!Number.isFinite(now.getTime())) throw new ApiError("PLATFORM_CAPACITY_TIME_INVALID", 400);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  await requireCapacityViewer(actor, normalizedWorkspaceId);
  const since = new Date(now.getTime() - DAY_MS);
  const attachmentWhere = {
    OR: [
      { note: { subject: { workspaceId: normalizedWorkspaceId } } },
      { studyResource: { workspaceId: normalizedWorkspaceId } },
    ],
  };
  const [
    activeMemberCount,
    activeJobCount,
    exportJobCount24h,
    failedJobCount24h,
    attachmentCount,
    attachmentAggregate,
    oldestActiveJob,
  ] = await Promise.all([
    prisma.workspaceMembership.count({ where: { workspaceId: normalizedWorkspaceId, status: "ACTIVE", user: { status: "ACTIVE" } } }),
    prisma.dataJob.count({ where: { workspaceId: normalizedWorkspaceId, status: { in: [...ACTIVE_JOB_STATUSES] } } }),
    prisma.dataJob.count({ where: { workspaceId: normalizedWorkspaceId, kind: "EXPORT", createdAt: { gte: since, lte: now } } }),
    prisma.dataJob.count({ where: { workspaceId: normalizedWorkspaceId, status: "FAILED", updatedAt: { gte: since, lte: now } } }),
    prisma.attachment.count({ where: attachmentWhere }),
    prisma.attachment.aggregate({ where: attachmentWhere, _sum: { sizeBytes: true } }),
    prisma.dataJob.findFirst({
      where: { workspaceId: normalizedWorkspaceId, status: { in: [...ACTIVE_JOB_STATUSES] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { createdAt: true },
    }),
  ]);
  return {
    contractVersion: "platform-capacity-v1",
    workspaceId: normalizedWorkspaceId,
    generatedAt: now.toISOString(),
    usage: {
      activeMemberCount,
      activeJobCount,
      exportJobCount24h,
      failedJobCount24h,
      attachmentCount,
      storageBytes: attachmentAggregate._sum.sizeBytes ?? 0,
    },
    queue: {
      oldestActiveJobAt: oldestActiveJob?.createdAt.toISOString() ?? null,
      activeStatuses: ACTIVE_JOB_STATUSES,
    },
    limitsConfigured: false,
    enforcementEnabled: false,
    capacityState: "OBSERVED_ONLY",
  };
}

async function requireCapacityViewer(actor: CurrentUser, workspaceId: string): Promise<void> {
  if (isPlatformOperatorEmail(actor.email, getAuthEnv().AUTH_ADMIN_EMAIL)) {
    const workspace = await prisma.examWorkspace.findFirst({
      where: { id: workspaceId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!workspace) throw new ApiError("PLATFORM_CAPACITY_NOT_FOUND", 404);
    return;
  }
  try {
    await requireWorkspaceOwner(prisma, actor.id, workspaceId, { active: true });
  } catch {
    throw new ApiError("PLATFORM_CAPACITY_NOT_FOUND", 404);
  }
}

function normalizeWorkspaceId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 191 || normalized === "." || normalized === ".."
    || normalized.includes("/") || normalized.includes("\\")) {
    throw new ApiError("PLATFORM_CAPACITY_QUERY_INVALID", 400);
  }
  return normalized;
}
