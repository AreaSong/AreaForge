import {
  labelMasteryCondition,
  masteryConditionOptions,
  masteryEvidenceTypeOptions,
  masteryRetestResultOptions,
} from "@/components/syllabus-manager-labels";
import type {
  SyllabusEvidenceFormController,
  SyllabusMasteryControls,
  SyllabusRetestFormController,
} from "@/components/syllabus-manager-tree-node-hooks";
import type { MasteryEvidenceType, MasteryRetestResult } from "@/components/syllabus-manager-types";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select } from "@/components/ui/field";
import type { SyllabusNodeDto } from "@/lib/contracts";
import {
  MASTERY_STATUS_OPTIONS,
  masteryStatusLabel,
  type MasteryStatus,
} from "@/lib/knowledge/mastery-status";
import { ClipboardCheck, Plus, RotateCcw, Save } from "lucide-react";

export function MasteryControls({
  node,
  controller,
  pending,
}: {
  node: SyllabusNodeDto;
  controller: SyllabusMasteryControls;
  pending: boolean;
}) {
  const { state, actions } = controller;
  const canSubmitProof = node.masteryProof.evidenceCount > 0;
  return (
    <div className="rounded-md border border-white/10 bg-[#0d1117] p-3">
      <div className="af-content-grid-two grid gap-3">
        <label className="grid min-w-0 gap-2 text-xs text-zinc-400">
          目标掌握状态
          <Select value={state.targetMasteryStatus} onChange={(event) => actions.setTargetMasteryStatus(event.target.value as MasteryStatus)} disabled={pending}>
            {MASTERY_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{masteryStatusLabel(status)}</option>)}
          </Select>
        </label>
        <div className="grid min-w-0 gap-2">
          <p className="text-xs text-zinc-400">本次证明条件</p>
          <div className="af-content-grid-two grid gap-2">
            {masteryConditionOptions.map((condition) => (
              <label key={condition} className="flex min-h-9 items-center gap-2 rounded-md border border-white/10 px-2 py-1.5 text-xs text-zinc-300">
                <Checkbox
                  checked={state.selectedConditionSet.has(condition)}
                  onChange={() => actions.toggleCondition(condition)}
                  disabled={pending}
                />
                <span>{labelMasteryCondition(condition)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={actions.saveConditions} disabled={pending}>
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          保存条件
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={actions.proveMastery}
          disabled={pending || !canSubmitProof}
          title={canSubmitProof ? node.masteryProof.nextAction : "还没有任务、计时、笔记、错题或复测证据"}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          保存证明
        </Button>
      </div>
    </div>
  );
}

export function MasteryEvidenceForm({
  controller,
  pending,
}: {
  controller: SyllabusEvidenceFormController;
  pending: boolean;
}) {
  const { state, actions } = controller;
  return (
    <form className="min-w-0 rounded-md border border-white/10 bg-[#0d1117] p-3" onSubmit={actions.submit}>
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-teal-300" aria-hidden="true" />
        <p className="text-sm font-medium text-zinc-100">证据引用</p>
      </div>
      <div className="af-content-grid-two mt-3 grid min-w-0 gap-2">
        <Select value={state.evidenceType} onChange={(event) => actions.changeEvidenceType(event.target.value as MasteryEvidenceType)} disabled={pending}>
          {masteryEvidenceTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Select value={state.selectedReferenceId} onChange={(event) => actions.setEvidenceReferenceId(event.target.value)} disabled={pending || state.evidenceCandidates.length === 0}>
          {state.evidenceCandidates.length === 0 ? <option value="">暂无可引用记录</option> : state.evidenceCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
          ))}
        </Select>
      </div>
      <Input value={state.evidenceSummary} onChange={(event) => actions.setEvidenceSummary(event.target.value)} placeholder="证据备注" maxLength={1000} disabled={pending} className="mt-2" />
      <Button className="mt-3" type="submit" variant="secondary" size="sm" disabled={pending || !state.selectedReferenceId}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        写入证据
      </Button>
    </form>
  );
}

export function MasteryRetestForm({
  controller,
  pending,
}: {
  controller: SyllabusRetestFormController;
  pending: boolean;
}) {
  const { state, actions } = controller;
  return (
    <form className="min-w-0 rounded-md border border-white/10 bg-[#0d1117] p-3" onSubmit={actions.submit}>
      <div className="flex items-center gap-2">
        <RotateCcw className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <p className="text-sm font-medium text-zinc-100">复测记录</p>
      </div>
      <div className="af-content-grid-two mt-3 grid min-w-0 gap-2">
        <Select value={state.result} onChange={(event) => actions.setResult(event.target.value as MasteryRetestResult)} disabled={pending}>
          {masteryRetestResultOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
        <Input type="datetime-local" value={state.testedAt} onChange={(event) => actions.setTestedAt(event.target.value)} aria-label="复测时间" disabled={pending} />
        <Input value={state.score} onChange={(event) => actions.setScore(event.target.value)} placeholder="分数或结果" maxLength={80} disabled={pending} />
        <Input type="date" value={state.nextReviewDate} onChange={(event) => actions.setNextReviewDate(event.target.value)} aria-label="下次复习日期" disabled={pending} />
      </div>
      <Input value={state.summary} onChange={(event) => actions.setSummary(event.target.value)} placeholder="复测摘要" maxLength={2000} disabled={pending} className="mt-2" />
      {state.dateError ? <p className="mt-2 text-xs text-red-200" role="alert">{state.dateError}</p> : null}
      <Button className="mt-3" type="submit" variant="secondary" size="sm" disabled={pending}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        写入复测
      </Button>
    </form>
  );
}
