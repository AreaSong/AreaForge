import type { StudySessionStatusDto } from "@/lib/contracts";

export type FocusSnapshotDecision = "redirect-active" | "keep-local" | "keep-offline" | "clear-stale";

export function shouldUseOfflineFocusSnapshot(input: {
  online: boolean;
  snapshotSessionId: string;
  snapshotStatus: StudySessionStatusDto;
  activeSessionId: string | null;
}): FocusSnapshotDecision {
  if (input.snapshotSessionId.startsWith("local-focus-")) return "keep-local";
  if (input.online) return input.activeSessionId ? "redirect-active" : "clear-stale";
  return input.snapshotStatus === "running" || input.snapshotStatus === "paused" || input.snapshotStatus === "closing"
    ? "keep-offline"
    : "clear-stale";
}
