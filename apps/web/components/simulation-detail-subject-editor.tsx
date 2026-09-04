import { Archive, ArchiveRestore, ArrowRight, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button, IconButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import type { SimulationLossReasonDto, SyllabusOptionNodeDto } from "@/lib/contracts";
import {
  simulationLossReasons,
  type LossItemAction,
  type SimulationLossItemDraft,
  type SubjectDraft,
} from "@/components/simulation-detail-drafts";

export type SubjectNumericField =
  | "paperFullScore"
  | "targetScore"
  | "actualScore"
  | "durationMinutes"
  | "blankQuestionCount";

export interface SimulationSubjectEditorProps {
  examId: string;
  active: SubjectDraft;
  subjectName: string;
  nodes: SyllabusOptionNodeDto[];
  busy: boolean;
  activeLossItems: SimulationLossItemDraft[];
  archivedLossItems: SimulationLossItemDraft[];
  onUpdateField: (field: SubjectNumericField, value: number | null) => void;
  onUpdateSummary: (value: string) => void;
  onAddLossItem: () => void;
  onUpdateLossItem: (clientKey: string, patch: Partial<SimulationLossItemDraft>) => void;
  onRemoveUnsavedLossItem: (clientKey: string) => void;
  onMutateLossItem: (item: SimulationLossItemDraft, action: LossItemAction) => void;
}

export function SimulationSubjectEditor(props: SimulationSubjectEditorProps) {
  return (
    <div className="space-y-5">
      <SubjectResultFields
        active={props.active}
        subjectName={props.subjectName}
        disabled={props.busy}
        onUpdateField={props.onUpdateField}
        onUpdateSummary={props.onUpdateSummary}
      />
      <LossItemsPanel
        examId={props.examId}
        active={props.active}
        nodes={props.nodes}
        busy={props.busy}
        activeLossItems={props.activeLossItems}
        archivedLossItems={props.archivedLossItems}
        onAddLossItem={props.onAddLossItem}
        onUpdateLossItem={props.onUpdateLossItem}
        onRemoveUnsavedLossItem={props.onRemoveUnsavedLossItem}
        onMutateLossItem={props.onMutateLossItem}
      />
    </div>
  );
}

function SubjectResultFields(props: {
  active: SubjectDraft;
  subjectName: string;
  disabled: boolean;
  onUpdateField: (field: SubjectNumericField, value: number | null) => void;
  onUpdateSummary: (value: string) => void;
}) {
  const fields: Array<[SubjectNumericField, string, number, number]> = [
    ["paperFullScore", "卷面满分", 1, 1],
    ["targetScore", "目标分", 0.5, 0],
    ["actualScore", "实际分", 0.5, 0],
    ["durationMinutes", "用时（分）", 1, 0],
    ["blankQuestionCount", "未作答数", 1, 0],
  ];

  return (
    <Card variant="master" className="p-5 sm:p-6 space-y-4">
      <SectionHeader
        title={`${props.subjectName} 分科结果`}
        description="录入卷面满分、目标分、实际得分、用时与未作答题数。"
      />
      <div className="af-five-field-grid mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {fields.map(([field, label, step, min]) => (
          <label key={field} className="min-w-0 text-sm text-zinc-300">
            <span className="block text-xs font-medium text-zinc-400">{label}</span>
            <Input
              type="number"
              step={step}
              min={min}
              value={props.active[field] ?? ""}
              disabled={props.disabled}
              onChange={(event) => props.onUpdateField(
                field,
                event.target.value === "" ? (field === "blankQuestionCount" ? 0 : null) : Number(event.target.value),
              )}
              className="mt-1 h-11 bg-white/[0.03] text-white"
            />
          </label>
        ))}
      </div>
      <Field label="分科总结" htmlFor={`subject-summary-${props.active.subjectId}`}>
        <Textarea
          id={`subject-summary-${props.active.subjectId}`}
          value={props.active.summary}
          disabled={props.disabled}
          onChange={(event) => props.onUpdateSummary(event.target.value)}
          placeholder={`概括 ${props.subjectName} 本场发挥情况...`}
          controlHeight="sm"
          className="bg-white/[0.03] text-white"
        />
      </Field>
    </Card>
  );
}

function LossItemsPanel(props: {
  examId: string;
  active: SubjectDraft;
  nodes: SyllabusOptionNodeDto[];
  busy: boolean;
  activeLossItems: SimulationLossItemDraft[];
  archivedLossItems: SimulationLossItemDraft[];
  onAddLossItem: () => void;
  onUpdateLossItem: (clientKey: string, patch: Partial<SimulationLossItemDraft>) => void;
  onRemoveUnsavedLossItem: (clientKey: string) => void;
  onMutateLossItem: (item: SimulationLossItemDraft, action: LossItemAction) => void;
}) {
  return (
    <Card variant="master" className="p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
        <div>
          <h2 className="text-base font-semibold text-white">结构化失分</h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            归因失分原因与考纲关联，形成精确补救动作。
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={props.onAddLossItem}>
          <Plus aria-hidden="true" size={15} />
          新增失分
        </Button>
      </div>

      <div className="space-y-3">
        {props.activeLossItems.length === 0 ? (
          <p className="py-2 text-sm text-zinc-500">暂无结构化失分条目，点击上方“新增失分”开始记录。</p>
        ) : null}
        {props.activeLossItems.map((item) => (
          <LossItemRow
            key={item.id ?? item.clientKey}
            examId={props.examId}
            active={props.active}
            item={item}
            nodes={props.nodes}
            busy={props.busy}
            onUpdate={props.onUpdateLossItem}
            onRemove={props.onRemoveUnsavedLossItem}
            onMutate={props.onMutateLossItem}
          />
        ))}
      </div>

      {props.archivedLossItems.length > 0 ? (
        <details className="mt-4 border-t border-white/5 pt-3">
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
            已归档失分（{props.archivedLossItems.length}）
          </summary>
          <div className="mt-3 space-y-2">
            {props.archivedLossItems.map((item) => (
              <div
                key={item.id ?? item.clientKey}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-sm"
              >
                <span className="min-w-0 text-zinc-400">
                  {simulationLossReasons.find((reason) => reason.value === item.reason)?.label ?? item.reason}
                  {` · ${item.lostScore} 分`}
                  {item.note ? ` · ${item.note}` : ""}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={props.busy || !item.id}
                  onClick={() => props.onMutateLossItem(item, "restore")}
                >
                  <ArchiveRestore aria-hidden="true" size={15} />
                  恢复
                </Button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </Card>
  );
}

function LossItemRow(props: {
  examId: string;
  active: SubjectDraft;
  item: SimulationLossItemDraft;
  nodes: SyllabusOptionNodeDto[];
  busy: boolean;
  onUpdate: (clientKey: string, patch: Partial<SimulationLossItemDraft>) => void;
  onRemove: (clientKey: string) => void;
  onMutate: (item: SimulationLossItemDraft, action: LossItemAction) => void;
}) {
  const item = props.item;
  return (
    <div className="af-loss-entry-grid grid min-w-0 gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
      <Select
        aria-label="失分原因"
        value={item.reason}
        disabled={props.busy}
        onChange={(event) => props.onUpdate(item.clientKey, { reason: event.target.value as SimulationLossReasonDto })}
        className="h-11 bg-white/[0.03] text-white"
      >
        {simulationLossReasons.map((reason) => (
          <option key={reason.value} value={reason.value}>
            {reason.label}
          </option>
        ))}
      </Select>
      <Select
        aria-label="考纲节点"
        value={item.syllabusNodeId ?? ""}
        disabled={props.busy}
        onChange={(event) => props.onUpdate(item.clientKey, { syllabusNodeId: event.target.value || null })}
        className="h-11 bg-white/[0.03] text-white"
      >
        <option value="">不关联节点</option>
        {props.nodes.map((node) => (
          <option key={node.id} value={node.id}>
            {node.title}
          </option>
        ))}
      </Select>
      <Input
        aria-label="失分值"
        type="number"
        min={0.5}
        step={0.5}
        value={item.lostScore}
        disabled={props.busy}
        onChange={(event) => props.onUpdate(item.clientKey, { lostScore: Number(event.target.value) })}
        className="h-11 bg-white/[0.03] text-white"
      />
      <Input
        aria-label="失分备注"
        value={item.note}
        maxLength={500}
        disabled={props.busy}
        onChange={(event) => props.onUpdate(item.clientKey, { note: event.target.value })}
        placeholder="备注"
        className="h-11 bg-white/[0.03] text-white placeholder:text-zinc-600"
      />
      <div className="flex min-h-11 flex-wrap items-center justify-end gap-1">
        {item.id ? (
          <>
            {!item.dirty ? (
              item.mistakeId ? (
                <Link
                  href={`/knowledge/mistakes/${item.mistakeId}?returnTo=${encodeURIComponent(`/test/simulations/${props.examId}`)}`}
                  className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-teal-300 transition-colors hover:bg-white/[0.05] hover:text-teal-200"
                >
                  打开错题
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              ) : (
                <Link
                  href={`/knowledge/mistakes?create=1&simulationLossItemId=${item.id}`}
                  className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs font-medium text-teal-300 transition-colors hover:bg-white/[0.05] hover:text-teal-200"
                >
                  转为错题
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              )
            ) : null}
            <IconButton
              label="保存失分"
              disabled={props.busy || !item.dirty}
              onClick={() => props.onMutate(item, "save")}
              className="text-teal-300 disabled:opacity-40"
            >
              <Save aria-hidden="true" size={17} />
            </IconButton>
            <IconButton
              label="归档失分"
              title={item.dirty ? "请先保存修改" : "归档失分"}
              disabled={props.busy || item.dirty}
              onClick={() => props.onMutate(item, "archive")}
              className="text-red-300 disabled:opacity-40"
            >
              <Archive aria-hidden="true" size={17} />
            </IconButton>
          </>
        ) : props.active.subjectResultId ? (
          <>
            <IconButton
              label="创建失分"
              disabled={props.busy}
              onClick={() => props.onMutate(item, "save")}
              className="text-teal-300 disabled:opacity-40"
            >
              <Save aria-hidden="true" size={17} />
            </IconButton>
            <IconButton
              label="移除未保存失分"
              disabled={props.busy}
              onClick={() => props.onRemove(item.clientKey)}
              className="text-red-300 disabled:opacity-40"
            >
              <Trash2 aria-hidden="true" size={17} />
            </IconButton>
          </>
        ) : (
          <>
            <span className="px-1 text-xs text-zinc-500">随分科保存</span>
            <IconButton
              label="移除未保存失分"
              disabled={props.busy}
              onClick={() => props.onRemove(item.clientKey)}
              className="text-red-300 disabled:opacity-40"
            >
              <Trash2 aria-hidden="true" size={17} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

export function SimulationAnalysisFields(props: {
  disabled: boolean;
  mindset: string;
  summary: string;
  reviewText: string;
  onMindsetChange: (value: string) => void;
  onSummaryChange: (value: string) => void;
  onReviewTextChange: (value: string) => void;
}) {
  return (
    <Card variant="master" className="p-5 sm:p-6 space-y-4">
      <SectionHeader
        title="完成分析"
        description="记录整场状态与结论，作为确认前的最后核对。"
      />
      <Field label="心态" htmlFor="simulation-mindset">
        <Textarea
          id="simulation-mindset"
          value={props.mindset}
          disabled={props.disabled}
          onChange={(event) => props.onMindsetChange(event.target.value)}
          controlHeight="sm"
          placeholder="记录临场心态、焦虑或疲劳情况..."
          className="bg-white/[0.03] text-white"
        />
      </Field>
      <Field label="整场总结" htmlFor="simulation-summary">
        <Textarea
          id="simulation-summary"
          value={props.summary}
          disabled={props.disabled}
          onChange={(event) => props.onSummaryChange(event.target.value)}
          controlHeight="sm"
          placeholder="整场模拟综合发挥与核心得失..."
          className="bg-white/[0.03] text-white"
        />
      </Field>
      <Field label="复盘" htmlFor="simulation-review">
        <Textarea
          id="simulation-review"
          value={props.reviewText}
          disabled={props.disabled}
          onChange={(event) => props.onReviewTextChange(event.target.value)}
          placeholder="这次考试为什么得到这个结果，下一次具体如何调整"
          controlHeight="md"
          className="bg-white/[0.03] text-white placeholder:text-zinc-600"
        />
      </Field>
    </Card>
  );
}
