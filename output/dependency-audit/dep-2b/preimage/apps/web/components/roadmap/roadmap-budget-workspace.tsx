"use client";

import { useState } from "react";
import { WeeklyBudgetPlanner } from "@/components/weekly-budget-planner";
import { RoadmapBudgetConversionTable } from "@/components/roadmap/roadmap-budget-conversion";
import type { WeeklyBudgetDto } from "@/lib/contracts";

export function RoadmapBudgetWorkspace(props: {
  initialBudget: WeeklyBudgetDto;
}) {
  const [budget, setBudget] = useState(props.initialBudget);
  return (
    <div className="space-y-3">
      <WeeklyBudgetPlanner
        key={budgetIdentity(budget)}
        budget={budget}
        onBudgetChange={setBudget}
      />
      <RoadmapBudgetConversionTable
        weeklyBudget={budget}
      />
    </div>
  );
}

function budgetIdentity(budget: WeeklyBudgetDto): string {
  return [
    budget.workspaceId,
    budget.weekStart,
    ...budget.subjects.map((subject) => `${subject.subjectId}:${subject.revision}`),
  ].join(":");
}
