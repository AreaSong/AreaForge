import type { AppShellStatusProjection } from "@areaforge/core";
import type { NotificationPreferenceDto } from "./notification";
import type { StudySessionDto } from "./study-session";

export interface AppShellStatusDto extends AppShellStatusProjection {
  serverTime: string;
  setupRequired: boolean;
  workspaceId: string | null;
  reviewExecutableCount: number;
  reviewBridgedCount: number;
  defaultSubjectId: string | null;
  notificationPreference: NotificationPreferenceDto;
  notificationCandidates: {
    reviewDue: boolean;
    planStart: boolean;
    eveningReview: boolean;
  };
  motivationReminderCandidate: {
    trigger: "RECOVERY" | "LOW_CONVERSION" | null;
    blockedByActiveActivity: boolean;
  };
  activeSession: StudySessionDto | null;
}
