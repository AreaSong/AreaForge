import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import type { CurrentUser } from "../../apps/web/lib/auth/session";

export interface RbacActor {
  userId: string;
  email: string;
  actor: CurrentUser;
  sessionId: string;
}

export interface RbacRuntimeFixture {
  users: {
    operator: RbacActor;
    owner: RbacActor;
    admin: RbacActor;
    coach: RbacActor;
    member: RbacActor;
    viewer: RbacActor;
  };
  workspaceIds: {
    primary: string;
    secondary: string;
  };
  memberships: {
    owner: string;
    admin: string;
    coach: string;
    member: string;
    viewer: string;
  };
  subjects: {
    primary: string;
    secondary: string;
  };
  notes: {
    userGrant: string;
    roleGrant: string;
    workspaceGrant: string;
    secondary: string;
  };
  mistakeId: string;
  attachmentId: string;
  privateMarker: string;
}

/** Only the isolated PostgreSQL database is reset; callers must enforce the DB guard first. */
export async function resetRbacRuntimeFixture(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" RESTART IDENTITY CASCADE');
}

export async function seedRbacRuntimeFixture(label = "default"): Promise<RbacRuntimeFixture> {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const makeUser = async (role: string, email: string): Promise<RbacActor> => {
    const user = await prisma.user.create({
      data: {
        email: `${email.replace("@", `-${suffix}@`)}`,
        passwordHash: "v15-fixture-password-hash",
        emailVerifiedAt: new Date(),
      },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: `v15-${role}-${suffix}-${randomUUID()}`,
        authRevision: user.authRevision,
        expiresAt: new Date(Date.now() + 86_400_000),
        reauthenticatedAt: new Date(),
      },
    });
    return {
      userId: user.id,
      email: user.email,
      sessionId: session.id,
      actor: {
        id: user.id,
        email: user.email,
        sessionId: session.id,
        status: "ACTIVE",
        emailVerifiedAt: user.emailVerifiedAt,
        reauthenticatedAt: session.reauthenticatedAt,
      },
    };
  };

  const [operator, owner, admin, coach, member, viewer] = await Promise.all([
    makeUser("operator", `operator-${label}@example.invalid`),
    makeUser("owner", `owner-${label}@example.invalid`),
    makeUser("admin", `admin-${label}@example.invalid`),
    makeUser("coach", `coach-${label}@example.invalid`),
    makeUser("member", `member-${label}@example.invalid`),
    makeUser("viewer", `viewer-${label}@example.invalid`),
  ]);

  const [primary, secondary] = await Promise.all([
    prisma.examWorkspace.create({
      data: {
        userId: owner.userId,
        stableKey: `v15-primary-${suffix}`,
        name: "v1.5 RBAC 主工作区",
        status: "ACTIVE",
      },
    }),
    prisma.examWorkspace.create({
      data: {
        userId: owner.userId,
        stableKey: `v15-secondary-${suffix}`,
        name: "v1.5 RBAC 第二工作区",
        status: "ACTIVE",
      },
    }),
  ]);

  const memberships = await Promise.all([
    prisma.workspaceMembership.create({ data: { workspaceId: primary.id, userId: owner.userId, role: "OWNER" } }),
    prisma.workspaceMembership.create({ data: { workspaceId: primary.id, userId: admin.userId, role: "ADMIN" } }),
    prisma.workspaceMembership.create({ data: { workspaceId: primary.id, userId: coach.userId, role: "COACH" } }),
    prisma.workspaceMembership.create({ data: { workspaceId: primary.id, userId: member.userId, role: "MEMBER" } }),
    prisma.workspaceMembership.create({ data: { workspaceId: primary.id, userId: viewer.userId, role: "VIEWER" } }),
    prisma.workspaceMembership.create({ data: { workspaceId: secondary.id, userId: owner.userId, role: "OWNER" } }),
  ]);

  const [primarySubject, secondarySubject] = await Promise.all([
    prisma.subject.create({
      data: {
        workspaceId: primary.id,
        stableKey: `v15-primary-subject-${suffix}`,
        name: "RBAC 数学",
        color: "#14b8a6",
      },
    }),
    prisma.subject.create({
      data: {
        workspaceId: secondary.id,
        stableKey: `v15-secondary-subject-${suffix}`,
        name: "隔离英语",
        color: "#64748b",
      },
    }),
  ]);

  const privateMarker = `V15_PRIVATE_${suffix}_${randomUUID()}`;
  const [userGrant, roleGrant, workspaceGrant, secondaryNote] = await Promise.all([
    prisma.note.create({
      data: {
        ownerUserId: owner.userId,
        subjectId: primarySubject.id,
        title: "USER grant fixture",
        content: privateMarker,
      },
    }),
    prisma.note.create({
      data: {
        ownerUserId: owner.userId,
        subjectId: primarySubject.id,
        title: "ROLE grant fixture",
        content: `${privateMarker}:coach`,
      },
    }),
    prisma.note.create({
      data: {
        ownerUserId: owner.userId,
        subjectId: primarySubject.id,
        title: "WORKSPACE grant fixture",
        content: `${privateMarker}:workspace`,
      },
    }),
    prisma.note.create({
      data: {
        ownerUserId: owner.userId,
        subjectId: secondarySubject.id,
        title: "跨工作区隔离 fixture",
        content: `${privateMarker}:secondary`,
      },
    }),
  ]);
  const mistake = await prisma.mistake.create({
    data: {
      ownerUserId: owner.userId,
      subjectId: primarySubject.id,
      title: "RBAC 错题 fixture",
      questionText: privateMarker,
    },
  });
  const attachment = await prisma.attachment.create({
    data: {
      ownerUserId: owner.userId,
      noteId: userGrant.id,
      originalName: "v15-rbac.txt",
      storedName: `v15-${suffix}.txt`,
      mimeType: "text/plain",
      sizeBytes: 16,
      hash: `v15-hash-${suffix}`,
      uri: `upload://v15/${suffix}`,
      status: "READY",
      protocolVersion: 1,
    },
  });

  return {
    users: { operator, owner, admin, coach, member, viewer },
    workspaceIds: { primary: primary.id, secondary: secondary.id },
    memberships: {
      owner: memberships[0].id,
      admin: memberships[1].id,
      coach: memberships[2].id,
      member: memberships[3].id,
      viewer: memberships[4].id,
    },
    subjects: { primary: primarySubject.id, secondary: secondarySubject.id },
    notes: {
      userGrant: userGrant.id,
      roleGrant: roleGrant.id,
      workspaceGrant: workspaceGrant.id,
      secondary: secondaryNote.id,
    },
    mistakeId: mistake.id,
    attachmentId: attachment.id,
    privateMarker,
  };
}
