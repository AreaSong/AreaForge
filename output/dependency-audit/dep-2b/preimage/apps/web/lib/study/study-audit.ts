import { prisma, type Prisma, type PrismaClient } from "@areaforge/db";

export type StudyDbClient = PrismaClient | Prisma.TransactionClient;

export async function audit(
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  client: StudyDbClient = prisma,
): Promise<void> {
  await client.auditEvent.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
    },
  });
}
