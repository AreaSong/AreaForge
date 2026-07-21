import "dotenv/config";
import { getPrismaClient } from "../../packages/db/src/index";

const subjectSeeds = [
  { legacyCode: "MATH" as const, stableKey: "math", name: "数学", color: "#38bdf8", sortOrder: 10 },
  { legacyCode: "ENGLISH" as const, stableKey: "english", name: "英语", color: "#14b8a6", sortOrder: 20 },
  { legacyCode: "POLITICS" as const, stableKey: "politics", name: "政治", color: "#f43f5e", sortOrder: 30 },
  { legacyCode: "DATA_STRUCTURE" as const, stableKey: "data-structure", name: "408 数据结构", color: "#f59e0b", sortOrder: 40 },
  {
    legacyCode: "COMPUTER_ORGANIZATION" as const,
    stableKey: "computer-organization",
    name: "408 计算机组成原理",
    color: "#a78bfa",
    sortOrder: 50,
  },
  { legacyCode: "OPERATING_SYSTEM" as const, stableKey: "operating-system", name: "408 操作系统", color: "#22c55e", sortOrder: 60 },
  { legacyCode: "COMPUTER_NETWORK" as const, stableKey: "computer-network", name: "408 计算机网络", color: "#fb7185", sortOrder: 70 },
] as const;

const prisma = getPrismaClient();

async function main() {
  const adminEmail = process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPasswordHash = process.env.AUTH_ADMIN_PASSWORD_HASH?.trim();

  if (adminEmail && adminPasswordHash) {
    await seedAdmin(adminEmail, adminPasswordHash);
  } else {
    await assertAdminExists();
  }

  for (const subject of subjectSeeds) {
    const existing = await prisma.subject.findFirst({
      where: {
        OR: [{ legacyCode: subject.legacyCode }, { stableKey: subject.stableKey, workspaceId: null }],
      },
    });
    if (existing) {
      await prisma.subject.update({
        where: { id: existing.id },
        data: {
          legacyCode: subject.legacyCode,
          stableKey: subject.stableKey,
          name: subject.name,
          color: subject.color,
          sortOrder: subject.sortOrder,
        },
      });
    } else {
      await prisma.subject.create({
        data: {
          legacyCode: subject.legacyCode,
          stableKey: subject.stableKey,
          name: subject.name,
          color: subject.color,
          sortOrder: subject.sortOrder,
          workspaceId: null,
        },
      });
    }
  }

  await prisma.auditEvent.create({
    data: {
      action: "SUBJECTS_SEEDED",
      entityType: "Subject",
      metadata: {
        source: "db:seed",
        count: subjectSeeds.length,
      },
    },
  });
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
