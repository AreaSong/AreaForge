import { redirect } from "next/navigation";
import { PageFrame, PageHeader } from "@/components/ui/page";
import { getCurrentUser } from "@/lib/auth/session";
import { getRouteMetadata } from "@/lib/navigation/app-navigation";
import { getAnalyticsSummaryShared } from "@/lib/study/analytics-service";
import { findActiveWorkspaceOrNull, listWorkspaceSubjects } from "@/lib/study/exam-workspace-service";
import { listPlanMilestones } from "@/lib/study/plan-milestone-service";
import { listStagePlans } from "@/lib/study/stage-service";
import { getSyllabusMapOverviewShared } from "@/lib/study/syllabus-service";
import { RoadmapBudgetConversionTable } from "@/components/roadmap/roadmap-budget-conversion";
import { RoadmapSyllabusMatrix } from "@/components/roadmap/roadmap-syllabus-matrix";
import { RoadmapTimelineGantt } from "@/components/roadmap/roadmap-timeline-gantt";
import { RoadmapWorkbenchLaunchers } from "@/components/roadmap/roadmap-workbench-launchers";

export const dynamic = "force-dynamic";
export const metadata = getRouteMetadata("/roadmap");

export default async function RoadmapOverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [activeWorkspace, stagePlans, milestones, syllabusOverview, analytics] = await Promise.all([
    findActiveWorkspaceOrNull(user.id),
    listStagePlans(user.id),
    listPlanMilestones(user.id),
    getSyllabusMapOverviewShared(user.id),
    getAnalyticsSummaryShared(user.id),
  ]);

  const subjects = activeWorkspace ? await listWorkspaceSubjects(user.id, activeWorkspace.id) : [];

  return (
    <PageFrame variant="dashboard-wide" className="space-y-4">
      <PageHeader
        eyebrow="路线"
        title="长期路线全景看板"
        description="从当前事实判断下一步，甘特阶段推进、考纲覆盖矩阵与投入转化全景可视。"
      />

      {/* 1. Dense Gantt-Style Stage & Milestone Timeline */}
      <section aria-labelledby="roadmap-gantt-section">
        <h2 id="roadmap-gantt-section" className="sr-only">阶段甘特轴与里程碑</h2>
        <RoadmapTimelineGantt
          stages={stagePlans}
          milestones={milestones}
          subjects={subjects}
        />
      </section>

      {/* 2. Syllabus Matrix & Budget Conversion Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 2. Syllabus Total Coverage & Mastery Stacked Progress Bar */}
        <section aria-labelledby="roadmap-syllabus-section">
          <h2 id="roadmap-syllabus-section" className="sr-only">考纲全景复习覆盖与掌握矩阵</h2>
          <RoadmapSyllabusMatrix
            overview={syllabusOverview}
            subjects={subjects}
          />
        </section>

        {/* 3. Subject Budget vs. Actual Study Time Conversion Table */}
        <section aria-labelledby="roadmap-budget-section">
          <h2 id="roadmap-budget-section" className="sr-only">科目预算与实际投入转化对比</h2>
          <RoadmapBudgetConversionTable
            analytics={analytics}
            syllabusOverview={syllabusOverview}
            subjects={subjects}
          />
        </section>
      </div>

      {/* 4. Compact Quick Launchers Grid */}
      <section aria-labelledby="roadmap-launchers-section">
        <h2 id="roadmap-launchers-section" className="sr-only">路线工作台入口</h2>
        <RoadmapWorkbenchLaunchers
          milestonesCount={milestones.length}
          stagesCount={stagePlans.length}
        />
      </section>
    </PageFrame>
  );
}
