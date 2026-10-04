import type { Prisma } from "@areaforge/db";
import { ApiError } from "@/lib/api/responses";
import { getAuthEnv } from "@/lib/auth/env";

export function workspaceOwnerWhere(actorId: string) {
  return {
    userId: actorId,
    ...(getAuthEnv().AUTH_MULTI_USER_ENABLED
      ? {
          memberships: {
            some: {
              userId: actorId,
              role: "OWNER" as const,
              status: "ACTIVE" as const,
            },
          },
        }
      : {}),
  };
}

export async function requireWorkspaceOwner<T extends Pick<Prisma.TransactionClient, "examWorkspace">>(
  client: T,
  actorId: string,
  workspaceId: string,
  options?: { active?: boolean },
) {
  const workspace = await client.examWorkspace.findFirst({
    where: {
      id: workspaceId,
      ...workspaceOwnerWhere(actorId),
      ...(options?.active === undefined ? {} : { status: options.active ? "ACTIVE" : "ARCHIVED" }),
    },
  });
  if (!workspace) throw new ApiError("WORKSPACE_NOT_FOUND", 404);
  return workspace;
}
