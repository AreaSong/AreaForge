import { Ban, Eye, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import {
  adoptDraftLabel,
  noteKinds,
  projectionFields,
  type AiDraftEndpoint,
  type AiDraftNoteKind,
  type AiDraftScope,
  type AiDraftTone,
  type AiFormDraft,
  type ProjectionKey,
  type ProjectionValues,
} from "@/components/ai-draft-panel-model";

interface AiDraftPanelViewProps {
  endpoint: AiDraftEndpoint;
  selectedText: string;
  tone: AiDraftTone;
  scope: AiDraftScope;
  kind: AiDraftNoteKind;
  checked: AiFormDraft["checked"];
  values: ProjectionValues;
  preview: Record<string, unknown> | null;
  previewNote: string | null;
  token: string | null;
  draft: unknown;
  error: string | null;
  saveNotice: string | null;
  projectionReady: boolean;
  pending: boolean;
  savingResult: boolean;
  onSelectedTextChange: (value: string) => void;
  onToneChange: (value: AiDraftTone) => void;
  onScopeChange: (value: AiDraftScope) => void;
  onKindChange: (value: AiDraftNoteKind) => void;
  onCheckedChange: (key: ProjectionKey, value: boolean) => void;
  onValueChange: (key: keyof ProjectionValues, value: string) => void;
  onPreview: () => void;
  onGenerate: () => void;
  onAdopt: () => void;
  onReject: () => void;
}

export function AiDraftPanelView(props: AiDraftPanelViewProps) {
  return (
    <div className="space-y-4">
      <label className="block text-sm text-zinc-400">
        选中文本
        <Textarea
          className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-white"
          value={props.selectedText}
          disabled={props.savingResult}
          onChange={(event) => props.onSelectedTextChange(event.target.value)}
          placeholder="粘贴或输入本次要发送的选中文本"
        />
      </label>
      <EndpointOptions
        endpoint={props.endpoint}
        tone={props.tone}
        scope={props.scope}
        kind={props.kind}
        disabled={props.savingResult}
        onToneChange={props.onToneChange}
        onScopeChange={props.onScopeChange}
        onKindChange={props.onKindChange}
      />
      {projectionFields[props.endpoint].length > 0 ? (
        <ProjectionControls
          endpoint={props.endpoint}
          checked={props.checked}
          values={props.values}
          disabled={props.savingResult}
          onCheckedChange={props.onCheckedChange}
          onValueChange={props.onValueChange}
        />
      ) : null}
      {props.error ? <p className="text-sm text-red-300">{props.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!props.selectedText.trim() || !props.projectionReady || props.pending || props.savingResult}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
          onClick={props.onPreview}
        >
          <Eye aria-hidden="true" size={16} />
          发送前预览
        </Button>
        <Button
          type="button"
          disabled={!props.token || props.pending || props.savingResult}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-200 disabled:opacity-50"
          onClick={props.onGenerate}
        >
          <Sparkles aria-hidden="true" size={16} />
          确认生成草稿
        </Button>
      </div>
      {props.previewNote ? <p role="status" className="text-sm text-zinc-300">{props.previewNote}</p> : null}
      {props.preview ? <PayloadPreview title="本次生成输入预览" value={props.preview} /> : null}
      {props.draft ? <PayloadPreview title="草稿结果" value={props.draft} accent /> : null}
      {props.draft ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={props.savingResult}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-200 disabled:opacity-60"
            onClick={props.onAdopt}
          >
            {props.savingResult ? "处理中..." : adoptDraftLabel(props.endpoint)}
          </Button>
          <Button
            type="button"
            disabled={props.savingResult}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-300 disabled:opacity-60"
            onClick={props.onReject}
          >
            <Ban aria-hidden="true" size={15} />
            放弃草稿
          </Button>
        </div>
      ) : null}
      {props.saveNotice ? <p role="status" className="text-sm text-teal-200">{props.saveNotice}</p> : null}
    </div>
  );
}

function EndpointOptions(props: {
  endpoint: AiDraftEndpoint;
  tone: AiDraftTone;
  scope: AiDraftScope;
  kind: AiDraftNoteKind;
  disabled: boolean;
  onToneChange: (value: AiDraftTone) => void;
  onScopeChange: (value: AiDraftScope) => void;
  onKindChange: (value: AiDraftNoteKind) => void;
}) {
  if (props.endpoint === "motivation") {
    return <SelectField label="语气" value={props.tone} disabled={props.disabled} onChange={props.onToneChange} options={["CALM", "DIRECT", "BRIEF"]} />;
  }
  if (props.endpoint === "learning-tree") {
    return <SelectField label="范围" value={props.scope} disabled={props.disabled} onChange={props.onScopeChange} options={["global", "subject", "branch"]} />;
  }
  if (props.endpoint === "knowledge-card") {
    return <SelectField label="卡片类型" value={props.kind} disabled={props.disabled} onChange={props.onKindChange} options={[...noteKinds]} />;
  }
  return null;
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: T[];
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      {props.label}
      <Select
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white"
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((option) => <option key={option}>{option}</option>)}
      </Select>
    </label>
  );
}

function ProjectionControls(props: {
  endpoint: AiDraftEndpoint;
  checked: AiFormDraft["checked"];
  values: ProjectionValues;
  disabled: boolean;
  onCheckedChange: (key: ProjectionKey, value: boolean) => void;
  onValueChange: (key: keyof ProjectionValues, value: string) => void;
}) {
  return (
    <fieldset className="space-y-3 border-t border-white/10 pt-3" disabled={props.disabled}>
      <legend className="text-sm font-medium text-zinc-300">可选上下文（默认不发送）</legend>
      {projectionFields[props.endpoint].map((field) => (
        <div key={field.key} className="af-content-grid-two grid gap-2">
          <label className="flex min-h-10 items-center gap-2 text-sm text-zinc-300">
            <Checkbox
              checked={Boolean(props.checked[field.key])}
              onChange={(event) => props.onCheckedChange(field.key, event.target.checked)}
            />
            {field.label}
          </label>
          <ProjectionInput
            field={field.key}
            disabled={props.disabled || !props.checked[field.key]}
            values={props.values}
            onChange={props.onValueChange}
          />
        </div>
      ))}
    </fieldset>
  );
}

function ProjectionInput(props: {
  field: ProjectionKey;
  disabled: boolean;
  values: ProjectionValues;
  onChange: (key: keyof ProjectionValues, value: string) => void;
}) {
  const className = "h-10 min-w-0 rounded-md border border-white/10 bg-transparent px-3 text-sm text-white disabled:opacity-40";
  if (props.field === "dateWindow") {
    return (
      <div className="af-content-grid-two grid gap-2">
        <Input aria-label="开始日期" type="date" disabled={props.disabled} className={className} value={props.values.dateStart} onChange={(event) => props.onChange("dateStart", event.target.value)} />
        <Input aria-label="结束日期" type="date" disabled={props.disabled} className={className} value={props.values.dateEnd} onChange={(event) => props.onChange("dateEnd", event.target.value)} />
      </div>
    );
  }
  if (props.field === "defaultDurationMinutes") {
    return <Input aria-label="默认时长（分钟）" type="number" min={5} max={480} step={5} disabled={props.disabled} className={className} value={props.values.defaultDurationMinutes} onChange={(event) => props.onChange("defaultDurationMinutes", event.target.value)} />;
  }
  const textField = props.field as Exclude<ProjectionKey, "dateWindow" | "defaultDurationMinutes">;
  return <Input aria-label={textField} maxLength={120} disabled={props.disabled} className={className} value={props.values[textField]} onChange={(event) => props.onChange(textField, event.target.value)} />;
}

function PayloadPreview(props: { title: string; value: unknown; accent?: boolean }) {
  return (
    <section aria-live="polite" className="space-y-2">
      <h4 className="text-sm font-medium text-zinc-300">{props.title}</h4>
      <pre className={`overflow-auto rounded-md border p-3 text-xs ${props.accent ? "border-teal-500/20 bg-black/30 text-zinc-200" : "border-white/10 bg-black/30 text-zinc-300"}`}>
        {JSON.stringify(props.value, null, 2)}
      </pre>
    </section>
  );
}
