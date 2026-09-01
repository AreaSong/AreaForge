"use client";

import { useActionCenterTodayController } from "@/components/action-center-today-controller";
import { ActionCenterTodayView } from "@/components/action-center-today-view";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import type { ActionCenterTodayDto } from "@/lib/contracts";

export function ActionCenterToday({ initial }: { initial: ActionCenterTodayDto }) {
  const { withActivityBarrier } = useQuickReviewActivityGuard();
  const controller = useActionCenterTodayController(initial, withActivityBarrier);
  return <ActionCenterTodayView today={initial} controller={controller} />;
}
