import { BrainCircuit, CheckCircle2, Plus, Save, XCircle } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/field";
import { SectionSurface, Surface } from "@/components/ui/surface";
import type { EntityOperationState } from "@/lib/client/use-entity-operation-map";
import type { StageAdjustmentDraftRecordDto, StagePlanDto } from "@/lib/contracts";
import { formatDate, formatDateTime } from "@/lib/formatters";
import {
  labelStageDraftSource,
  labelStageDraftStatus,
  labelStageMode,
  labelStagePlanStatus,
  labelTaskIntensity,
} from "@/components/simulation-workbench-model";

interface SimulationStageSectionProps {
  plans: StagePlanDto[];
  drafts: StageAdjustmentDraftRecordDto[];
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  mode: StagePlanDto["mode"];
  status: StagePlanDto["status"];
  selectedPlanId: string;
  stagePlanPending: boolean;
  stagePlanError: string | null;
  draftGenerationPending: boolean;
  draftGenerationError: string | null;
  getDraftOperation: (id: string) => EntityOperationState;
  onNameChange: (value: string) => void;
  onGoalChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onModeChange: (value: StagePlanDto["mode"]) => void;
  onStatusChange: (value: StagePlanDto["status"]) => void;
  onSelectedPlanChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGenerateDraft: () => void;
  onGenerateAiDraft: () => void;
  onDecideDraft: (id: string, revision: number, action: "confirm" | "reject") => void;
}

export function SimulationStageSection(props: SimulationStageSectionProps) {
  return (
    <SectionSurface>
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-white">阶段计划与持久草稿</h2>
      </div>
      <StagePlanForm {...props} />
      <StagePlanList {...props} />
      <StageDraftList {...props} />
    </SectionSurface>
  );
}

function StagePlanForm(props: SimulationStageSectionProps) {
  return (
    <form className="mt-5 grid gap-3" onSubmit={props.onSubmit}>
      <Input className="h-11" value={props.name} onChange={(event) => props.onNameChange(event.target.value)} placeholder="阶段计划名称" disabled={props.stagePlanPending} required />
      <Textarea controlHeight="md" value={props.goal} onChange={(event) => props.onGoalChange(event.target.value)} placeholder="阶段目标" disabled={props.stagePlanPending} required />
      <div className="af-content-grid-two grid gap-3">
        <Input className="h-11" type="datetime-local" value={props.startDate} onChange={(event) => props.onStartDateChange(event.target.value)} disabled={props.stagePlanPending} required />
        <Input className="h-11" type="datetime-local" value={props.endDate} onChange={(event) => props.onEndDateChange(event.target.value)} disabled={props.stagePlanPending} required />
      </div>
      <div className="af-content-grid-two grid gap-3">
        <Select className="h-11" value={props.mode} onChange={(event) => props.onModeChange(event.target.value as StagePlanDto["mode"])} disabled={props.stagePlanPending}>
          <option value="maintain">维持</option><option value="recovery">恢复</option><option value="strengthen">强化</option><option value="sprint">冲刺</option>
        </Select>
        <Select className="h-11" value={props.status} onChange={(event) => props.onStatusChange(event.target.value as StagePlanDto["status"])} disabled={props.stagePlanPending}>
          <option value="draft">草稿</option><option value="active">进行中</option><option value="completed">已完成</option><option value="archived">已归档</option>
        </Select>
      </div>
      <Button variant="primary" size="lg" className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-sky-300 px-4 font-medium text-[#071018] disabled:cursor-not-allowed disabled:opacity-50" type="submit" loading={props.stagePlanPending} loadingLabel="保存中...">
        <Save className="h-4 w-4" aria-hidden="true" />保存阶段计划
      </Button>
      {props.stagePlanError ? <Alert tone="danger">{props.stagePlanError}</Alert> : null}
    </form>
  );
}

function StagePlanList(props: SimulationStageSectionProps) {
  return (
    <div className="mt-6 grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-medium text-white">持久阶段计划</h3>
        <Button variant="secondary" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-sky-200/20 px-3 text-sm text-sky-100 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={props.onGenerateDraft} loading={props.draftGenerationPending} loadingLabel="生成中...">
          <Plus className="h-4 w-4" aria-hidden="true" />生成持久草稿
        </Button>
        <Button variant="secondary" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-amber-200/25 px-3 text-sm text-amber-100 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={props.onGenerateAiDraft} loading={props.draftGenerationPending} loadingLabel="生成中...">
          <BrainCircuit className="h-4 w-4" aria-hidden="true" />生成 AI 草稿
        </Button>
      </div>
      {props.plans.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">还没有阶段计划；先保存计划，再确认草稿。</p>
      ) : (
        <Select className="h-11" value={props.selectedPlanId} onChange={(event) => props.onSelectedPlanChange(event.target.value)}>
          {props.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} / {labelStageMode(plan.mode)} / {labelStagePlanStatus(plan.status)}</option>)}
        </Select>
      )}
      {props.plans.map((plan) => (
        <Surface as="article" key={plan.id} tone="raised" padding="sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md border border-sky-200/20 px-2 py-1 text-xs text-sky-100">{labelStageMode(plan.mode)}</span>
            <span className="rounded-md border border-sky-200/20 px-2 py-1 text-xs text-sky-100">{labelStagePlanStatus(plan.status)}</span>
          </div>
          <h3 className="mt-3 font-medium text-white">{plan.name}</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{plan.goal}</p>
          <p className="mt-2 text-xs text-zinc-500">{formatDate(plan.startDate)} 至 {formatDate(plan.endDate)}</p>
        </Surface>
      ))}
      {props.draftGenerationError ? <Alert tone="danger">{props.draftGenerationError}</Alert> : null}
    </div>
  );
}

function StageDraftList(props: SimulationStageSectionProps) {
  return (
    <div className="mt-6 grid gap-3">
      <h3 className="font-medium text-white">已持久化阶段调整草稿</h3>
      {props.drafts.length === 0 ? (
        <p className="rounded-md border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-400">还没有持久草稿；生成后会固定 canAutoApply=false / requiresUserConfirmation=true。</p>
      ) : null}
      {props.drafts.map((draft) => {
        const operation = props.getDraftOperation(draft.id);
        return (
          <Surface as="article" key={draft.id} tone="raised" padding="sm">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">{labelStageDraftStatus(draft.status)}</span>
            <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">{labelStageDraftSource(draft.source)}</span>
            <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">{draft.canAutoApply ? "可自动应用" : "不自动应用"}</span>
            <span className="rounded-md border border-violet-200/20 px-2 py-1 text-xs text-violet-100">{draft.requiresUserConfirmation ? "需用户确认" : "无需确认"}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-violet-50">{draft.riskConclusion}</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{draft.nextStageEmphasis}</p>
          <p className="mt-2 text-xs text-zinc-500">{labelStageMode(draft.mode)} / {labelTaskIntensity(draft.taskIntensity)} / {formatDateTime(draft.createdAt)}</p>
          {draft.status === "draft" ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-300 px-3 text-sm font-medium text-[#120d1b] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => props.onDecideDraft(draft.id, draft.revision, "confirm")} loading={operation.pending} loadingLabel="处理中..." disabled={!draft.stagePlanId}>
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />确认应用到阶段计划
              </Button>
              <Button variant="secondary" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => props.onDecideDraft(draft.id, draft.revision, "reject")} disabled={operation.pending}>
                <XCircle className="h-4 w-4" aria-hidden="true" />驳回
              </Button>
            </div>
          ) : null}
          {operation.error ? <Alert tone="danger" className="mt-3">{operation.error}</Alert> : null}
          </Surface>
        );
      })}
    </div>
  );
}
