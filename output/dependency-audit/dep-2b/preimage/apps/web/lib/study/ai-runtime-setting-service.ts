import { prisma } from "@areaforge/db";
import { getAuthEnv } from "@/lib/auth/env";
import { ApiError } from "@/lib/api/responses";
import type { AiRuntimeSettingStatus } from "@/lib/contracts/ai";

export type { AiRuntimeSettingStatus } from "@/lib/contracts/ai";

export const aiRuntimeSettingId = "global";

export interface AiRuntimeSettingInput {
  enabled: boolean;
  expectedRevision?: number;
}

export async function getAiRuntimeSettingStatus(): Promise<AiRuntimeSettingStatus> {
  const [setting, env] = await Promise.all([
    prisma.aiRuntimeSetting.findUnique({
      where: { id: aiRuntimeSettingId },
      select: { enabled: true, revision: true, updatedAt: true },
    }),
    Promise.resolve(getAuthEnv()),
  ]);
  const serverEnabled = env.AI_ENABLED;
  const webEnabled = setting?.enabled ?? false;

  return {
    webEnabled,
    serverEnabled,
    effectiveEnabled: serverEnabled && webEnabled,
    revision: setting?.revision ?? 0,
    updatedAt: setting?.updatedAt?.toISOString() ?? null,
  };
}

export async function updateAiRuntimeSetting(
  actorId: string,
  input: AiRuntimeSettingInput,
): Promise<AiRuntimeSettingStatus> {
  const env = getAuthEnv();
  if (input.enabled && !env.AI_ENABLED) {
    throw new ApiError("AI_RUNTIME_SERVER_DISABLED", 503);
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.aiRuntimeSetting.findUnique({
      where: { id: aiRuntimeSettingId },
      select: { id: true, revision: true },
    });
    const currentRevision = existing?.revision ?? 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new ApiError("AI_RUNTIME_SETTING_CONFLICT", 409);
    }

    const next = existing
      ? await tx.aiRuntimeSetting.update({
        where: { id: existing.id },
        data: { enabled: input.enabled, revision: { increment: 1 } },
      })
      : await tx.aiRuntimeSetting.create({
        data: { id: aiRuntimeSettingId, enabled: input.enabled, revision: 1 },
      });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: input.enabled ? "AI_RUNTIME_ENABLED" : "AI_RUNTIME_DISABLED",
        entityType: "AiRuntimeSetting",
        entityId: next.id,
        metadata: { status: "success", revision: next.revision },
      },
    });
  });

  return getAiRuntimeSettingStatus();
}
