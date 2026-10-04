"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, History, RotateCcw, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { formatDateTime } from "@/lib/formatters";
import type {
  SubjectDuplicateSetDto,
  SubjectMergeOperationDto,
  SubjectReferenceCountDto,
} from "@/lib/contracts";

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

export function SubjectDuplicatePreview(props: {
  sets: SubjectDuplicateSetDto[];
  mergeOperations?: SubjectMergeOperationDto[];
  pending?: boolean;
  onConfirm?: (set: SubjectDuplicateSetDto) => Promise<boolean>;
  onUndo?: (operation: SubjectMergeOperationDto) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<SubjectDuplicateSetDto | null>(null);
  const [selectedUndo, setSelectedUndo] = useState<SubjectMergeOperationDto | null>(null);
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
          {props.sets.map((set) => (
            <DuplicateSetCard
              key={set.id}
              set={set}
              pending={props.pending}
              onRequestMerge={props.onConfirm ? () => setSelected(set) : undefined}
            />
          ))}
        </div>
      )}

      <RecentSubjectMergeOperations
        operations={props.mergeOperations ?? []}
        pending={props.pending}
        onRequestUndo={props.onUndo ? setSelectedUndo : undefined}
      />

      <Modal
        open={Boolean(selected)}
        title="确认合并重复科目"
        onClose={() => setSelected(null)}
        allowEscape={!props.pending}
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            保留“{selected ? subjectName(selected, selected.recommendedTargetId) : "目标科目"}”，并把
            {selected ? selected.subjects.length - 1 : 0} 个来源科目的全部引用迁移过去。
          </p>
          <p className="rounded-lg border border-amber-300/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100">
            服务端会重新核对当前快照、活动计时与唯一冲突。成功后来源科目只会软归档，不会物理删除记录或附件。
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={props.pending} onClick={() => setSelected(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={props.pending || !selected}
              loading={props.pending}
              onClick={() => {
                if (!selected || !props.onConfirm) return;
                void props.onConfirm(selected).then((merged) => {
                  if (merged) setSelected(null);
                });
              }}
            >
              确认迁移并软归档
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(selectedUndo)}
        title="确认撤销科目合并"
        onClose={() => setSelectedUndo(null)}
        allowEscape={!props.pending}
      >
        <div className="space-y-4 text-sm text-zinc-300">
          <p>
            将“{selectedUndo?.sourceSubjects.map((subject) => subject.name).join("、") || "来源科目"}”恢复为活动科目，
            并把本次合并迁移的引用精确恢复到原科目。
          </p>
          <p className="rounded-lg border border-amber-300/15 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100">
            撤销只恢复该次合并记录的引用，不覆盖其他字段。服务端会再次核对引用漂移、活动计时和唯一冲突；任一检查失败都不会写入部分结果。
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={props.pending} onClick={() => setSelectedUndo(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={props.pending || !selectedUndo}
              loading={props.pending}
              onClick={() => {
                if (!selectedUndo || !props.onUndo) return;
                void props.onUndo(selectedUndo).then((undone) => {
                  if (undone) setSelectedUndo(null);
                });
              }}
            >
              确认撤销合并
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function RecentSubjectMergeOperations(props: {
  operations: SubjectMergeOperationDto[];
  pending?: boolean;
  onRequestUndo?: (operation: SubjectMergeOperationDto) => void;
}) {
  if (props.operations.length === 0) return null;
  return (
    <div className="space-y-2 pt-2" aria-labelledby="subject-merge-history-title">
      <div className="flex items-center gap-2">
        <History className="size-4 text-zinc-500" aria-hidden="true" />
        <h4 id="subject-merge-history-title" className="text-sm font-semibold text-zinc-200">最近合并记录</h4>
      </div>
      <div className="space-y-2">
        {props.operations.map((operation) => (
          <SubjectMergeOperationCard
            key={operation.id}
            operation={operation}
            pending={props.pending}
            onRequestUndo={props.onRequestUndo}
          />
        ))}
      </div>
    </div>
  );
}

function SubjectMergeOperationCard(props: {
  operation: SubjectMergeOperationDto;
  pending?: boolean;
  onRequestUndo?: (operation: SubjectMergeOperationDto) => void;
}) {
  const { operation } = props;
  const status = mergeOperationStatus(operation);
  return (
    <Card variant="subtle" className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-zinc-200">
            {operation.sourceSubjects.map((subject) => subject.name).join("、")} → {operation.targetSubjectName}
          </p>
          <span className={status.className}>{status.label}</span>
        </div>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          合并于 {formatDateTime(operation.mergedAt)}；撤销截止 {formatDateTime(operation.undoUntil)}。
        </p>
        {status.reason ? <p className="mt-1 text-xs leading-5 text-zinc-400">{status.reason}</p> : null}
      </div>
      {operation.status === "AVAILABLE" && props.onRequestUndo ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={props.pending}
          onClick={() => props.onRequestUndo?.(operation)}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          撤销合并
        </Button>
      ) : null}
    </Card>
  );
}

function mergeOperationStatus(operation: SubjectMergeOperationDto): {
  label: string;
  reason: string | null;
  className: string;
} {
  const baseClass = "rounded-full border px-2 py-0.5 text-[11px] font-medium";
  if (operation.status === "AVAILABLE") return {
    label: "可撤销",
    reason: "撤销前仍会重新核对最新状态。",
    className: `${baseClass} border-teal-400/20 bg-teal-400/10 text-teal-200`,
  };
  if (operation.status === "EXPIRED") return {
    label: "已过期",
    reason: "已超过 24 小时安全撤销窗口。",
    className: `${baseClass} border-zinc-400/20 bg-zinc-400/10 text-zinc-300`,
  };
  if (operation.status === "UNDONE") return {
    label: "已撤销",
    reason: "原科目和该次迁移的引用已经恢复。",
    className: `${baseClass} border-emerald-400/20 bg-emerald-400/10 text-emerald-200`,
  };
  return {
    label: "不可自动撤销",
    reason: subjectMergeBlockingReason(operation.blockingFields),
    className: `${baseClass} border-amber-400/20 bg-amber-400/10 text-amber-200`,
  };
}

function subjectMergeBlockingReason(fields: string[]): string {
  if (fields.includes("mergeOperation")) return "合并审计记录不完整，无法安全自动撤销。";
  if (fields.includes("subjectLifecycle")) return "目标或来源科目的归档状态已经变化。";
  if (fields.includes("activeSessions")) return "相关科目存在进行中的学习活动。";
  if (fields.some((field) => field.includes("planInboxItems"))) return "模拟补救或计划收件箱关联已经变化。";
  if (fields.some((field) => field.includes("relatedKnowledgePointLinks"))) return "知识点关联已经变化。";
  if (fields.length > 0) return "本次合并涉及的业务引用已经变化。";
  return "合并记录无法通过完整性校验。";
}

function DuplicateSetCard(props: {
  set: SubjectDuplicateSetDto;
  pending?: boolean;
  onRequestMerge?: () => void;
}) {
  const { set } = props;
  const recommended = set.subjects.find((item) => item.subject.id === set.recommendedTargetId);
  const blockingConflictTotal = set.conflictCounts.syllabusStableKeys
    + set.conflictCounts.simulationExams
    + set.conflictCounts.simulationInboxOrigins
    + set.conflictCounts.invalidSimulationInboxOrigins;
  const hasActiveSession = set.subjects.some(({ references }) => references.activeSessions > 0);
  const hasArchivedSubject = set.subjects.some(({ subject }) => Boolean(subject.archivedAt));
  const mergeBlocked = blockingConflictTotal > 0 || hasActiveSession || hasArchivedSubject;

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
        <p>
          阻断冲突：考纲键 {set.conflictCounts.syllabusStableKeys} 处、同场模拟成绩 {set.conflictCounts.simulationExams} 处、
          模拟补救来源键 {set.conflictCounts.simulationInboxOrigins} 处、无效来源快照 {set.conflictCounts.invalidSimulationInboxOrigins} 项。
        </p>
        <p className="mt-1">可安全处理：知识点重复关联 {set.conflictCounts.relatedKnowledgePoints} 处会确定性去重。</p>
        <p className="mt-1">来源科目作为主科目的知识点 {set.requiredReassignments.primaryKnowledgePoints} 个，需要显式迁移到保留科目。</p>
        <p className="mt-1">模拟补救来源 {set.requiredReassignments.simulationOriginInboxItems} 项会同步重建来源键和快照。</p>
        {blockingConflictTotal === 0 && set.requiredReassignments.primaryKnowledgePoints === 0 ? (
          <p className="mt-1 text-emerald-300">未发现结构冲突，但引用迁移仍需确认并在单一事务中执行。</p>
        ) : null}
      </div>

      <div className="flex items-start gap-2 text-xs leading-5 text-zinc-500">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-teal-300" aria-hidden="true" />
        <p>自动应用已关闭。真实转换会迁移全部引用并软归档来源科目，不做物理删除。</p>
      </div>

      {props.onRequestMerge ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
          <p className="text-xs text-zinc-500">
            {mergeBlocked ? "请先处理上方阻断项，再刷新预览。" : "当前预览可进入显式确认。"}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={props.pending || mergeBlocked}
            onClick={props.onRequestMerge}
          >
            合并到“{recommended?.subject.name ?? "保留科目"}”
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function subjectName(set: SubjectDuplicateSetDto, subjectId: string): string {
  return set.subjects.find(({ subject }) => subject.id === subjectId)?.subject.name ?? "目标科目";
}

function formatReferenceSummary(references: SubjectReferenceCountDto): string {
  const parts = referenceLabels
    .filter(([key]) => references[key] > 0)
    .map(([key, label]) => label + " " + references[key]);
  return parts.length > 0 ? parts.join("、") : "暂无业务引用";
}
