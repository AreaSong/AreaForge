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
  const [userCount, existingAdmin] = await Promise.all([
    prisma.user.count(),
    prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } }),
  ]);

  if (userCount === 0) {
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

  if (!existingAdmin) {
    throw new Error("Users already exist and the configured bootstrap admin is absent. Use the invitation or recovery flow.");
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
        emailVerifiedAt: new Date(),
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
