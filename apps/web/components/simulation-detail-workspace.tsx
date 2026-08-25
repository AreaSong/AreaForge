import { ArrowRight, Check } from "lucide-react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { SimulationRemediationSection } from "@/components/simulation-detail-remediation";
import {
  SimulationAnalysisFields,
  SimulationSubjectEditor,
  type SubjectNumericField,
} from "@/components/simulation-detail-subject-editor";
import type {
  LossItemAction,
  LossItemConflict,
  SimulationLossItemDraft,
  SubjectDraft,
} from "@/components/simulation-detail-drafts";
import { StudyActivityTimer } from "@/components/study-activity-timer";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Checkbox } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import type {
  SimulationExamDto,
  SimulationRemediationDto,
  SyllabusOptionNodeDto,
} from "@/lib/contracts";

export interface SimulationConflict {
  latest: SimulationExamDto;
  conflictFields: string[];
}

interface SimulationDetailWorkspaceProps {
  userId: string;
  examId: string;
  initialNow: string;
  returnTo: string;
  embeddedInWorkbench?: boolean;
  subjects: Array<{ id: string; name: string }>;
  remediations: SimulationRemediationDto[];
  examStatus: SimulationExamDto["status"];
  examRevision: number;
  timerSessionId: string | null;
  currentStep: number;
  readyForConfirmation: boolean;
  hasStructuredResults: boolean;
  hasPendingEditorChanges: boolean;
  selectedOriginKeys: string[];
  remediationReceipt: { created: number; reused: number } | null;
  configuredSubjectDrafts: SubjectDraft[];
  selectedSubjectIds: string[];
  active: SubjectDraft;
  activeLossItems: SimulationLossItemDraft[];
  archivedLossItems: SimulationLossItemDraft[];
  nodes: SyllabusOptionNodeDto[];
  subjectTabsId: string;
  busy: boolean;
  mindset: string;
  summary: string;
  reviewText: string;
  subjectDrafts: SubjectDraft[];
  error: string | null;
  notice: string | null;
  conflict: SimulationConflict | null;
  conflictOpen: boolean;
  lossConflict: LossItemConflict | null;
  lossConflictOpen: boolean;
  conflictedLossItem?: SimulationLossItemDraft;
  onOriginSelectionChange: (update: (keys: string[]) => string[]) => void;
  onAddRemediations: () => void;
  onTimerFinished: () => void;
  onToggleSubject: (subjectId: string, checked: boolean) => void;
  onSelectSubject: (subjectId: string) => void;
  onSubjectTabKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onUpdateField: (field: SubjectNumericField, value: number) => void;
  onUpdateSubjectSummary: (value: string) => void;
  onAddLossItem: () => void;
  onUpdateLossItem: (clientKey: string, patch: Partial<SimulationLossItemDraft>) => void;
  onRemoveUnsavedLossItem: (clientKey: string) => void;
  onMutateLossItem: (item: SimulationLossItemDraft, action: LossItemAction) => void;
  onMindsetChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onReviewTextChange: (value: string) => void;
  onSave: () => void;
  onStartExam: () => void;
  onOpenConflict: () => void;
  onCloseConflict: () => void;
  onAdoptLatest: () => void;
  onMergeLatest: () => void;
  onCloseLossConflict: () => void;
  onAdoptLossServer: () => void;
  onKeepLossIntent: () => void;
}

export function SimulationDetailWorkspace(props: SimulationDetailWorkspaceProps) {
  return (
    <div className="space-y-5">
      <SimulationProgress currentStep={props.currentStep} />
      <SimulationRemediationSection
        examStatus={props.examStatus}
        remediations={props.remediations}
        selectedOriginKeys={props.selectedOriginKeys}
        receipt={props.remediationReceipt}
        busy={props.busy}
        returnTo={props.returnTo}
        embeddedInWorkbench={props.embeddedInWorkbench}
        readyForConfirmation={props.readyForConfirmation}
        hasStructuredResults={props.hasStructuredResults}
        onSelectionChange={props.onOriginSelectionChange}
        onAdd={props.onAddRemediations}
      />
      {props.timerSessionId ? (
        <StudyActivityTimer
          userId={props.userId}
          sessionId={props.timerSessionId}
          theme="test"
          label="模拟考试计时"
          initialNow={props.initialNow}
          onFinished={props.onTimerFinished}
        />
      ) : null}
      <SectionHeader
        title={props.examStatus === "CONFIRMED" ? "考试事实" : "录分与失分分析"}
        description={props.examStatus === "CONFIRMED" ? "以下内容已确认，只读保留。" : "按科目切换并记录成绩、用时和结构化失分。"}
      />
      <SubjectSelection {...props} />
      <SubjectTabs {...props} />
      <fieldset disabled={props.examStatus === "CONFIRMED" || props.busy || Boolean(props.timerSessionId)} className="contents disabled:opacity-70">
        <div id={`${props.subjectTabsId}-panel-${props.active.subjectId}`} role="tabpanel" aria-labelledby={`${props.subjectTabsId}-tab-${props.active.subjectId}`} className="space-y-5">
          <SimulationSubjectEditor
            examId={props.examId}
            active={props.active}
            subjectName={props.subjects.find((item) => item.id === props.active.subjectId)?.name ?? "当前科目"}
            nodes={props.nodes}
            busy={props.busy}
            activeLossItems={props.activeLossItems}
            archivedLossItems={props.archivedLossItems}
            onUpdateField={props.onUpdateField}
            onUpdateSummary={props.onUpdateSubjectSummary}
            onAddLossItem={props.onAddLossItem}
            onUpdateLossItem={props.onUpdateLossItem}
            onRemoveUnsavedLossItem={props.onRemoveUnsavedLossItem}
            onMutateLossItem={props.onMutateLossItem}
          />
        </div>
        <SimulationAnalysisFields
          disabled={Boolean(props.timerSessionId)}
          mindset={props.mindset}
          summary={props.summary}
          reviewText={props.reviewText}
          onMindsetChange={props.onMindsetChange}
          onSummaryChange={props.onSummaryChange}
          onReviewTextChange={props.onReviewTextChange}
        />
      </fieldset>
      <SimulationActions {...props} />
      {props.error ? <Alert tone="danger">{props.error}</Alert> : null}
      {props.notice && !props.remediationReceipt ? <Alert tone="success">{props.notice}</Alert> : null}
      {props.conflict && !props.conflictOpen ? (
        <Button type="button" variant="ghost" size="sm" className="text-amber-200 underline" onClick={props.onOpenConflict}>处理模拟版本冲突</Button>
      ) : null}
      <SimulationConflictModals {...props} />
    </div>
  );
}

function SimulationProgress({ currentStep }: { currentStep: number }) {
  return (
    <ol className="af-divided-grid-three grid border-y border-white/10" aria-label="模拟考试处理进度">
      {[
        [1, "录入成绩", "记录分科事实"],
        [2, "分析失分", "核对并确认考试"],
        [3, "安排补救", "送入投入草稿"],
      ].map(([step, title, description]) => {
        const stepNumber = Number(step);
        const completed = stepNumber < currentStep;
        const activeStep = stepNumber === currentStep;
        return (
          <li key={stepNumber} aria-current={activeStep ? "step" : undefined} className={`flex min-h-20 items-center gap-3 px-4 py-3 ${activeStep ? "bg-white/[0.04]" : ""}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs ${completed ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : activeStep ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-600"}`}>{completed ? <Check size={14} /> : stepNumber}</span>
            <span className="min-w-0"><span className={`block text-sm font-medium ${activeStep || completed ? "text-white" : "text-zinc-500"}`}>{title}</span><span className="block text-xs text-zinc-500">{description}</span></span>
          </li>
        );
      })}
    </ol>
  );
}

function SubjectSelection(props: SimulationDetailWorkspaceProps) {
  if (props.examStatus === "CONFIRMED") return null;
  return (
    <fieldset disabled={props.busy || Boolean(props.timerSessionId)} className="space-y-3 border-y border-white/10 py-4 disabled:opacity-70">
      <legend className="text-sm font-medium text-white">本场科目</legend>
      <p className="text-xs text-zinc-500">选择本次实际参加的科目，至少 1 个，最多 8 个；未选择的科目不会写入本场模拟。</p>
      <div className="af-subject-choice-grid grid gap-2" role="group" aria-label="本场科目选择">
        {props.subjects.map((subject) => (
          <label key={subject.id} className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:border-white/20">
            <Checkbox aria-label={`本场科目 ${subject.name}`} checked={props.selectedSubjectIds.includes(subject.id)} onChange={(event) => props.onToggleSubject(subject.id, event.target.checked)} />
            <span className="truncate">{subject.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SubjectTabs(props: SimulationDetailWorkspaceProps) {
  return (
    <div className="af-horizontal-scroll flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="模拟科目，可横向滚动" tabIndex={0}>
      {props.configuredSubjectDrafts.map((draft) => {
        const subject = props.subjects.find((item) => item.id === draft.subjectId);
        if (!subject) return null;
        return (
          <Button key={subject.id} id={`${props.subjectTabsId}-tab-${subject.id}`} type="button" role="tab" aria-selected={props.active.subjectId === subject.id} aria-controls={`${props.subjectTabsId}-panel-${subject.id}`} tabIndex={props.active.subjectId === subject.id ? 0 : -1} onClick={() => props.onSelectSubject(subject.id)} onKeyDown={props.onSubjectTabKeyDown} className={`shrink-0 rounded-md border px-3 py-2 text-sm ${props.active.subjectId === subject.id ? "border-teal-400 text-teal-200" : "border-white/10 text-zinc-400"}`}>
            {subject.name}
          </Button>
        );
      })}
    </div>
  );
}

function SimulationActions(props: SimulationDetailWorkspaceProps) {
  if (props.examStatus === "CONFIRMED") return null;
  return (
    <section className="af-action-grid grid gap-3 border-t border-white/10 pt-5">
      <div><p className="text-sm font-medium text-white">先配置，再计时</p><p className="mt-1 text-xs text-zinc-500">保存分科配置后开始模拟；计时结束再填写成绩、失分和完整复盘。</p></div>
      <div className="af-action-cluster">
        <Button type="button" variant="primary" size="lg" loading={props.busy} loadingLabel="保存中..." onClick={props.onSave}>{props.hasStructuredResults ? "保存模拟结果" : "补齐并升级分科记录"}</Button>
        {props.examStatus === "DRAFT" && !props.timerSessionId && props.hasStructuredResults && !props.hasPendingEditorChanges ? <Button type="button" variant="secondary" size="lg" loading={props.busy} onClick={props.onStartExam}>开始模拟考试</Button> : null}
        {props.readyForConfirmation && !props.embeddedInWorkbench ? <ButtonLink href="/confirmations" variant="secondary" size="lg"><ArrowRight size={16} aria-hidden="true" />进入确认中心</ButtonLink> : null}
      </div>
    </section>
  );
}

function SimulationConflictModals(props: SimulationDetailWorkspaceProps) {
  return (
    <>
      <ConflictResolutionModal
        open={props.conflictOpen && Boolean(props.conflict)}
        title="合并模拟结果冲突"
        description="这场模拟已在其他页面或设备更新。当前分科成绩、失分和总结仍保留，系统不会强制覆盖或自动重放。"
        conflictFields={props.conflict?.conflictFields ?? []}
        comparisons={[
          { field: "revision", label: "考试 revision", local: props.examRevision, server: props.conflict?.latest.revision },
          { field: "summary", label: "整场总结", local: props.summary, server: props.conflict?.latest.summary },
          { field: "mindset", label: "心态", local: props.mindset, server: props.conflict?.latest.mindset },
          { field: "subjectResults", label: "分科成绩与失分", local: props.subjectDrafts, server: props.conflict?.latest.subjectResults },
          { field: "status", label: "考试状态", local: props.examStatus, server: props.conflict?.latest.status },
        ]}
        onClose={props.onCloseConflict}
        onAdoptServer={props.onAdoptLatest}
        onManualMerge={props.onMergeLatest}
        adoptLabel="采用服务端最新结果"
        mergeLabel="基于最新版本人工合并"
      />
      <ConflictResolutionModal
        open={props.lossConflictOpen && Boolean(props.lossConflict)}
        title="处理失分条目冲突"
        description="该失分条目已在其他页面更新，原操作不会自动重放。"
        conflictFields={props.lossConflict?.conflictFields ?? []}
        comparisons={props.lossConflict ? [
          { field: "revision", label: "条目 revision", local: props.conflictedLossItem?.revision, server: props.lossConflict.latest.revision },
          { field: "reason", label: "失分原因", local: props.conflictedLossItem?.reason, server: props.lossConflict.latest.reason },
          { field: "lostScore", label: "失分值", local: props.conflictedLossItem?.lostScore, server: props.lossConflict.latest.lostScore },
          { field: "archivedAt", label: "归档状态", local: props.conflictedLossItem?.archivedAt, server: props.lossConflict.latest.archivedAt },
        ] : []}
        onClose={props.onCloseLossConflict}
        onAdoptServer={props.onAdoptLossServer}
        onManualMerge={props.onKeepLossIntent}
        adoptLabel="采用服务端条目"
        mergeLabel="基于最新 revision 保留意图"
      />
    </>
  );
}
