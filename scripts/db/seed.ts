import "dotenv/config";
import { getPrismaClient } from "../../packages/db/src/index";

const prisma = getPrismaClient();

async function main() {
  const adminEmail = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPasswordHash = process.env.AUTH_ADMIN_PASSWORD_HASH?.trim();

  if (adminEmail && adminPasswordHash) {
    await seedAdmin(adminEmail, adminPasswordHash);
  } else {
    await assertAdminExists();
  }
}

async function seedAdmin(adminEmail: string, adminPasswordHash: string): Promise<void> {
  const existingUsers = await prisma.user.findMany({
    select: { id: true, email: true },
    take: 2,
    orderBy: { createdAt: "asc" },
  });

  if (existingUsers.length > 1) {
    throw new Error("Multiple admin users already exist. Resolve this manually before running seed.");
  }

  if (existingUsers.length > 0 && existingUsers[0]?.email !== adminEmail) {
    throw new Error("Admin already exists with a different email. Use an explicit password reset or admin migration.");
  }

  const existingAdmin = existingUsers[0];

  if (!existingAdmin) {
    const admin = await createAdminIfMissing(adminEmail, adminPasswordHash);

    if (admin.created) {
      await prisma.auditEvent.create({
        data: {
          actorId: admin.id,
          action: "AUTH_ADMIN_SEEDED",
          entityType: "User",
          entityId: admin.id,
          metadata: { source: "db:seed" },
        },
      });
    }

    return;
  }

  await prisma.auditEvent.create({
    data: {
      actorId: existingAdmin.id,
      action: "AUTH_ADMIN_SEED_SKIPPED",
      entityType: "User",
      entityId: existingAdmin.id,
      metadata: { source: "db:seed", reason: "exists" },
    },
  });
}

async function assertAdminExists(): Promise<void> {
  const existingAdmin = await prisma.user.findFirst({
    select: { id: true },
  });

  if (!existingAdmin) {
    throw new Error("AUTH_ADMIN_EMAIL and AUTH_ADMIN_PASSWORD_HASH are required to seed the first admin.");
  }
}

async function createAdminIfMissing(email: string, passwordHash: string): Promise<{ id: string; created: boolean }> {
  try {
    const admin = await prisma.user.create({
      data: {
        email,
        passwordHash,
      },
      select: { id: true },
    });

    return { ...admin, created: true };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email },
        select: { id: true },
      });

      return { ...admin, created: false };
    }

    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
