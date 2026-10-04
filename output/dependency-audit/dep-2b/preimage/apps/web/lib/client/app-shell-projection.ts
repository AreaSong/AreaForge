import { selectMobileTopLight } from "@areaforge/core";
import { isLocalFocusSessionId, readFocusOfflineSnapshot } from "@/lib/client/focus-offline-store";
import { activityLabel, activitySourcePath } from "@/lib/navigation/activity-route";
import type { AppShellStatusDto } from "@/lib/contracts";
import type { QuickReviewActivityClaim } from "@/lib/client/quick-review-activity";

export type ShellSyncState = "current" | "pending" | "offline" | "blocked" | "deferred" | "unavailable";

export function projectLocalQuickReviewStatus(
  status: AppShellStatusDto,
  claim: QuickReviewActivityClaim | null,
): Pick<AppShellStatusDto, "lights" | "mobileTop"> {
  if (!claim) return status;
  const lights = status.lights.map((light) => light.kind === "review"
    ? {
        ...light,
        tone: "blue" as const,
        summary: "正在快速复习",
        action: { label: "继续复习", href: claim.href },
      }
    : light);
  return { lights, mobileTop: selectMobileTopLight(lights) };
}

export function projectLocalFocusStatus(
  status: Pick<AppShellStatusDto, "lights" | "mobileTop">,
  session: AppShellStatusDto["activeSession"],
): Pick<AppShellStatusDto, "lights" | "mobileTop"> {
  if (!session) return status;
  const lights = status.lights.map((light) => light.kind === "activity"
    ? {
        ...light,
        tone: session.status === "closing" ? "amber" as const : session.status === "paused" ? "blue" as const : "green" as const,
        summary: session.status === "closing" ? `${activityLabel(session)}已冻结，等待收口` : session.status === "paused" ? `${activityLabel(session)}已暂停，可继续` : `正在${activityLabel(session)}`,
        action: { label: session.status === "closing" ? "完成收口" : `继续${activityLabel(session)}`, href: activitySourcePath(session) },
      }
    : light);
  return { lights, mobileTop: selectMobileTopLight(lights) };
}

export function isRenderableFocusSession(
  session: AppShellStatusDto["activeSession"],
): session is NonNullable<AppShellStatusDto["activeSession"]> {
  return Boolean(session && ["running", "paused", "closing"].includes(session.status));
}

export async function readRenderableOfflineFocusSession(
  userId: string,
): Promise<AppShellStatusDto["activeSession"]> {
  const snapshot = await readFocusOfflineSnapshot(userId);
  const session = snapshot?.session ?? null;
  return isRenderableFocusSession(session) && (isLocalFocusSessionId(session.id) || !navigator.onLine) ? session : null;
}

export function toShellSyncState(value: string): ShellSyncState {
  if (value === "pending" || value === "offline" || value === "blocked" || value === "deferred") return value;
  return value === "unavailable" ? "unavailable" : "current";
}
