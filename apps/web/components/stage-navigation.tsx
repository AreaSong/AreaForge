"use client";

import { WorkbenchNavigation } from "@/components/ui/workbench-navigation";
import { STAGE_TAB_ITEMS } from "@/lib/navigation/batch7";

export function StageNavigation() {
  return <WorkbenchNavigation label="阶段工作台" items={STAGE_TAB_ITEMS} />;
}
