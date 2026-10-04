import type { Prisma } from "@areaforge/db";

export type DbSyllabusNodeStatus =
  | "NOT_STARTED"
  | "LEARNING"
  | "COVERED"
  | "NEEDS_REVIEW"
  | "MASTERED"
  | "WEAK"
  | "DEFERRED";

export type DbMasteryLevel =
  | "SEEN"
  | "LEARNED"
  | "BASIC_EXERCISES"
  | "CAN_EXPLAIN"
  | "RETEST_PASSED"
  | "EXAM_STABLE";

export interface MemberSyllabusProgress {
  status: DbSyllabusNodeStatus;
  masteryLevel: DbMasteryLevel | null;
  targetMinutes: number;
  actualMinutes: number;
  revision: number;
}

export function memberSyllabusProgressInclude(ownerUserId: string) {
  return {
    progresses: {
      where: { ownerUserId },
      take: 1,
      select: {
        status: true,
        masteryLevel: true,
        targetMinutes: true,
        actualMinutes: true,
        revision: true,
      },
    },
  } satisfies Prisma.SyllabusNodeInclude;
}

export function resolveMemberSyllabusProgress(node: {
  status?: DbSyllabusNodeStatus;
  masteryLevel?: DbMasteryLevel | null;
  targetMinutes?: number;
  actualMinutes?: number;
  revision?: number;
  progresses?: MemberSyllabusProgress[];
}): MemberSyllabusProgress {
  return node.progresses?.[0] ?? {
    status: node.status ?? "NOT_STARTED",
    masteryLevel: node.masteryLevel ?? null,
    targetMinutes: node.targetMinutes ?? 0,
    actualMinutes: node.actualMinutes ?? 0,
    revision: node.revision ?? 0,
  };
}

export async function incrementMemberSyllabusActualMinutes(
  tx: Prisma.TransactionClient,
  input: {
    syllabusNodeId: string;
    ownerUserId: string;
    workspaceOwnerUserId: string;
    minutes: number;
  },
): Promise<void> {
  if (input.minutes <= 0) return;

  await tx.syllabusNodeProgress.upsert({
    where: {
      syllabusNodeId_ownerUserId: {
        syllabusNodeId: input.syllabusNodeId,
        ownerUserId: input.ownerUserId,
      },
    },
    create: {
      syllabusNodeId: input.syllabusNodeId,
      ownerUserId: input.ownerUserId,
      actualMinutes: input.minutes,
    },
    update: {
      actualMinutes: { increment: input.minutes },
      revision: { increment: 1 },
    },
  });

  // Legacy progress columns remain owner-mirrored during the additive rollback window.
  if (input.ownerUserId === input.workspaceOwnerUserId) {
    await tx.syllabusNode.update({
      where: { id: input.syllabusNodeId },
      data: { actualMinutes: { increment: input.minutes } },
    });
  }
}
