import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { SubjectDuplicateSetDto, SubjectReferenceCountDto } from "@/lib/contracts";

const reasonLabels: Record<SubjectDuplicateSetDto["reasons"][number]["code"], string> = {
  NORMALIZED_NAME: "规范化名称相同",
  NORMALIZED_STABLE_KEY: "内部标识大小写等价",
  LEGACY_CODE: "旧版科目编码相同",
};

const referenceLabels: Array<[keyof SubjectReferenceCountDto, string]> = [
  ["tasks", "任务"],
  ["sessions", "学习记录"],
  ["syllabusNodes", "考纲节点"],
  ["notes", "笔记"],
  ["mistakes", "错题"],
  ["simulationSubjectResults", "模拟成绩"],
  ["planMilestones", "计划里程碑"],
  ["planInboxItems", "计划收件箱"],
  ["studyResources", "学习资料"],
  ["primaryKnowledgePoints", "主知识点"],
  ["relatedKnowledgePoints", "关联知识点"],
  ["knowledgeGroups", "知识分组"],
  ["learningArrangements", "学习安排"],
];

export function SubjectDuplicatePreview(props: { sets: SubjectDuplicateSetDto[] }) {
  return (
    <section className="space-y-3" aria-labelledby="subject-duplicate-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="subject-duplicate-title" className="text-sm font-semibold text-zinc-100">重复科目检查</h3>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            只按相同名称、等价内部标识或旧版编码识别；这里只做影响预览，不会自动迁移或删除记录。
          </p>
        </div>
        <span className={props.sets.length > 0
          ? "rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-xs font-medium text-amber-200"
          : "rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-medium text-emerald-200"}
        >
          {props.sets.length > 0 ? props.sets.length + " 组待检查" : "未发现重复"}
        </span>
      </div>

      {props.sets.length === 0 ? (
        <Card variant="subtle" className="flex items-start gap-3 p-3.5">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />
          <p className="text-sm leading-6 text-zinc-400">当前科目名称、内部标识和旧版编码没有形成重复集合。</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {props.sets.map((set) => <DuplicateSetCard key={set.id} set={set} />)}
        </div>
      )}
    </section>
  );
}

function DuplicateSetCard({ set }: { set: SubjectDuplicateSetDto }) {
  const recommended = set.subjects.find((item) => item.subject.id === set.recommendedTargetId);
  const conflictTotal = set.conflictCounts.syllabusStableKeys
    + set.conflictCounts.simulationExams
    + set.conflictCounts.relatedKnowledgePoints;

  return (
    <Card variant="subtle" className="space-y-3 border-amber-300/15 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">
            {set.subjects.map((item) => item.subject.name).join(" / ")}
          </p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            {set.reasons.map((reason) => reasonLabels[reason.code]).join("；")}。建议保留“{recommended?.subject.name ?? "现有主科目"}”。
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {set.subjects.map(({ subject, references }) => (
          <div key={subject.id} className="rounded-lg border border-white/10 bg-black/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-zinc-200">{subject.name}</span>
              <span className="text-xs text-zinc-500">{references.total} 条引用</span>
            </div>
            <p className="mt-1 break-all text-[11px] text-zinc-600">{subject.stableKey}</p>
            <p className="mt-2 text-xs leading-5 text-zinc-500">{formatReferenceSummary(references)}</p>
            {references.activeSessions > 0 ? (
              <p className="mt-2 text-xs font-medium text-amber-200">有 {references.activeSessions} 个进行中活动，当前不可转换。</p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs leading-5 text-zinc-400">
        <p>合并前必须处理：考纲键冲突 {set.conflictCounts.syllabusStableKeys} 处、模拟成绩冲突 {set.conflictCounts.simulationExams} 处、知识点关联冲突 {set.conflictCounts.relatedKnowledgePoints} 处。</p>
        <p className="mt-1">来源科目作为主科目的知识点 {set.requiredReassignments.primaryKnowledgePoints} 个，需要显式迁移到保留科目。</p>
        {conflictTotal === 0 && set.requiredReassignments.primaryKnowledgePoints === 0 ? (
          <p className="mt-1 text-emerald-300">未发现结构冲突，但引用迁移仍需确认并在单一事务中执行。</p>
        ) : null}
      </div>

      <div className="flex items-start gap-2 text-xs leading-5 text-zinc-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-300" aria-hidden="true" />
        <p>自动应用已关闭。真实转换会迁移全部引用并软归档来源科目，不做物理删除。</p>
      </div>
    </Card>
  );
}

function formatReferenceSummary(references: SubjectReferenceCountDto): string {
  const parts = referenceLabels
    .filter(([key]) => references[key] > 0)
    .map(([key, label]) => label + " " + references[key]);
  return parts.length > 0 ? parts.join("、") : "暂无业务引用";
}
