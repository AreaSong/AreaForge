"use client";

import { WorkbenchNavigation } from "@/components/ui/workbench-navigation";
import { REVIEW_TAB_ITEMS } from "@/lib/navigation/batch7";

export function ReviewNavigation() {
  return <WorkbenchNavigation label="复盘工作台" items={REVIEW_TAB_ITEMS} />;
}
