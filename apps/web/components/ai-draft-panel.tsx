"use client";

import { Eye, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";

type Endpoint = "learning-tree" | "knowledge-card" | "plan" | "motivation";
type ProjectionKey =
  | "subjectLabel"
  | "rootNodeLabel"
  | "nodeLabel"
  | "milestoneLabel"
  | "dateWindow"
  | "defaultDurationMinutes";

const projectionFields = {
  "learning-tree": [
    { key: "subjectLabel", label: "科目名称" },
    { key: "rootNodeLabel", label: "根节点名称" },
  ],
  "knowledge-card": [
    { key: "subjectLabel", label: "科目名称" },
    { key: "nodeLabel", label: "考纲节点名称" },
  ],
  plan: [
    { key: "subjectLabel", label: "科目名称" },
    { key: "milestoneLabel", label: "里程碑名称" },
    { key: "dateWindow", label: "日期范围" },
    { key: "defaultDurationMinutes", label: "默认时长" },
  ],
  motivation: [],
} satisfies Record<Endpoint, Array<{ key: ProjectionKey; label: string }>>;

const noteKinds = ["GENERAL", "CONCEPT", "FORMULA", "METHOD", "EXAMPLE", "SUMMARY"] as const;

interface ProjectionValues {
  subjectLabel: string;
  rootNodeLabel: string;
  nodeLabel: string;
  milestoneLabel: string;
  dateStart: string;
  dateEnd: string;
  defaultDurationMinutes: string;
}

const emptyProjectionValues: ProjectionValues = {
  subjectLabel: "",
  rootNodeLabel: "",
  nodeLabel: "",
  milestoneLabel: "",
  dateStart: "",
  dateEnd: "",
  defaultDurationMinutes: "",
};

export function AiDraftPanel(props: { endpoint: Endpoint; defaultText?: string }) {
  const [selectedText, setSelectedText] = useState(props.defaultText ?? "");
  const [tone, setTone] = useState<"CALM" | "DIRECT" | "BRIEF">("CALM");
  const [scope, setScope] = useState<"global" | "subject" | "branch">("global");
  const [kind, setKind] = useState<(typeof noteKinds)[number]>("GENERAL");
  const [checked, setChecked] = useState<Partial<Record<ProjectionKey, boolean>>>({});
  const [values, setValues] = useState<ProjectionValues>(emptyProjectionValues);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revokePreview() {
    setToken(null);
    setPreview(null);
    setDraft(null);
  }

  function changeForm(update: () => void) {
    update();
    revokePreview();
    setError(null);
  }

  const requestInput = { endpoint: props.endpoint, selectedText, tone, scope, kind, checked, values };
  const projectionReady = checkedProjectionIsComplete(props.endpoint, checked, values);

  async function runPreview() {
    setError(null);
    setDraft(null);
    const response = await postDraft(props.endpoint, buildRequestBody("preview", requestInput));
    if (!response.ok || !response.payload?.previewToken) {
      setError(readError(response.payload, "预览失败"));
      return;
    }
    setToken(response.payload.previewToken as string);
    setPreview((response.payload.payloadPreview as Record<string, unknown>) ?? null);
  }

  async function runGenerate() {
    if (!token) return;
    setError(null);
    const response = await postDraft(
      props.endpoint,
      buildRequestBody("generate", requestInput, token),
    );
    if (!response.ok) {
      setError(readError(response.payload, "生成失败"));
      return;
    }
    setDraft(response.payload?.draft ?? null);
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm text-zinc-400">
        选中文本
        <textarea
          className="mt-1 min-h-24 w-full rounded-md border border-white/10 bg-transparent px-3 py-2 text-white"
          value={selectedText}
          onChange={(event) => changeForm(() => setSelectedText(event.target.value))}
          placeholder="粘贴或输入本次要发送的选中文本"
        />
      </label>
      <EndpointOptions
        endpoint={props.endpoint}
        tone={tone}
        scope={scope}
        kind={kind}
        onToneChange={(value) => changeForm(() => setTone(value))}
        onScopeChange={(value) => changeForm(() => setScope(value))}
        onKindChange={(value) => changeForm(() => setKind(value))}
      />
      {projectionFields[props.endpoint].length > 0 ? (
        <ProjectionControls
          endpoint={props.endpoint}
          checked={checked}
          values={values}
          onCheckedChange={(key, value) =>
            changeForm(() => setChecked((current) => ({ ...current, [key]: value })))
          }
          onValueChange={(key, value) =>
            changeForm(() => setValues((current) => ({ ...current, [key]: value })))
          }
        />
      ) : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!selectedText.trim() || !projectionReady || pending}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
          onClick={() => startTransition(() => void runPreview())}
        >
          <Eye aria-hidden="true" size={16} />
          发送前预览
        </button>
        <button
          type="button"
          disabled={!token || pending}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-4 text-sm text-zinc-200 disabled:opacity-50"
          onClick={() => startTransition(() => void runGenerate())}
        >
          <Sparkles aria-hidden="true" size={16} />
          确认生成草稿
        </button>
      </div>
      {preview ? <PayloadPreview title="将发送以下内容" value={preview} /> : null}
      {draft ? <PayloadPreview title="草稿结果" value={draft} accent /> : null}
    </div>
  );
}

function EndpointOptions(props: {
  endpoint: Endpoint;
  tone: "CALM" | "DIRECT" | "BRIEF";
  scope: "global" | "subject" | "branch";
  kind: (typeof noteKinds)[number];
  onToneChange: (value: "CALM" | "DIRECT" | "BRIEF") => void;
  onScopeChange: (value: "global" | "subject" | "branch") => void;
  onKindChange: (value: (typeof noteKinds)[number]) => void;
}) {
  if (props.endpoint === "motivation") {
    return (
      <SelectField label="语气" value={props.tone} onChange={props.onToneChange} options={["CALM", "DIRECT", "BRIEF"]} />
    );
  }
  if (props.endpoint === "learning-tree") {
    return (
      <SelectField label="范围" value={props.scope} onChange={props.onScopeChange} options={["global", "subject", "branch"]} />
    );
  }
  if (props.endpoint === "knowledge-card") {
    return <SelectField label="卡片类型" value={props.kind} onChange={props.onKindChange} options={[...noteKinds]} />;
  }
  return null;
}

function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block text-sm text-zinc-400">
      {props.label}
      <select
        className="mt-1 h-10 w-full rounded-md border border-white/10 bg-transparent px-3 text-white"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value as T)}
      >
        {props.options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ProjectionControls(props: {
  endpoint: Endpoint;
  checked: Partial<Record<ProjectionKey, boolean>>;
  values: ProjectionValues;
  onCheckedChange: (key: ProjectionKey, value: boolean) => void;
  onValueChange: (key: keyof ProjectionValues, value: string) => void;
}) {
  return (
    <fieldset className="space-y-3 border-t border-white/10 pt-3">
      <legend className="text-sm font-medium text-zinc-300">可选上下文（默认不发送）</legend>
      {projectionFields[props.endpoint].map((field) => (
        <div key={field.key} className="grid gap-2 sm:grid-cols-[minmax(10rem,0.7fr)_minmax(0,1.3fr)] sm:items-center">
          <label className="flex min-h-10 items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={Boolean(props.checked[field.key])}
              onChange={(event) => props.onCheckedChange(field.key, event.target.checked)}
            />
            {field.label}
          </label>
          <ProjectionInput field={field.key} disabled={!props.checked[field.key]} values={props.values} onChange={props.onValueChange} />
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
      <div className="grid grid-cols-2 gap-2">
        <input aria-label="开始日期" type="date" disabled={props.disabled} className={className} value={props.values.dateStart} onChange={(event) => props.onChange("dateStart", event.target.value)} />
        <input aria-label="结束日期" type="date" disabled={props.disabled} className={className} value={props.values.dateEnd} onChange={(event) => props.onChange("dateEnd", event.target.value)} />
      </div>
    );
  }
  if (props.field === "defaultDurationMinutes") {
    return <input aria-label="默认时长（分钟）" type="number" min={5} max={480} step={5} disabled={props.disabled} className={className} value={props.values.defaultDurationMinutes} onChange={(event) => props.onChange("defaultDurationMinutes", event.target.value)} />;
  }
  const textField = props.field as Exclude<ProjectionKey, "dateWindow" | "defaultDurationMinutes">;
  return <input aria-label={textField} maxLength={120} disabled={props.disabled} className={className} value={props.values[textField]} onChange={(event) => props.onChange(textField, event.target.value)} />;
}

function checkedProjectionIsComplete(
  endpoint: Endpoint,
  checked: Partial<Record<ProjectionKey, boolean>>,
  values: ProjectionValues,
): boolean {
  return projectionFields[endpoint].every(({ key }) => {
    if (!checked[key]) return true;
    if (key === "dateWindow") return Boolean(values.dateStart && values.dateEnd);
    if (key === "defaultDurationMinutes") {
      const duration = Number(values.defaultDurationMinutes);
      return Number.isInteger(duration) && duration >= 5 && duration <= 480;
    }
    return Boolean(values[key].trim());
  });
}

function buildRequestBody(
  phase: "preview" | "generate",
  input: {
    endpoint: Endpoint;
    selectedText: string;
    tone: "CALM" | "DIRECT" | "BRIEF";
    scope: "global" | "subject" | "branch";
    kind: (typeof noteKinds)[number];
    checked: Partial<Record<ProjectionKey, boolean>>;
    values: ProjectionValues;
  },
  previewToken?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = { phase, selectedText: input.selectedText };
  if (previewToken) body.previewToken = previewToken;
  if (input.endpoint === "motivation") body.tone = input.tone;
  if (input.endpoint === "learning-tree") body.scope = input.scope;
  if (input.endpoint === "knowledge-card") body.kind = input.kind;
  if (input.endpoint !== "motivation") body.checkedProjection = buildCheckedProjection(input.checked, input.values);
  return body;
}

function buildCheckedProjection(
  checked: Partial<Record<ProjectionKey, boolean>>,
  values: ProjectionValues,
): Record<string, unknown> {
  const projection: Record<string, unknown> = {};
  for (const key of ["subjectLabel", "rootNodeLabel", "nodeLabel", "milestoneLabel"] as const) {
    if (checked[key]) projection[key] = values[key].trim();
  }
  if (checked.dateWindow) projection.dateWindow = { start: values.dateStart, end: values.dateEnd };
  if (checked.defaultDurationMinutes) projection.defaultDurationMinutes = Number(values.defaultDurationMinutes);
  return projection;
}

async function postDraft(endpoint: Endpoint, body: Record<string, unknown>) {
  const response = await fetch(`/api/ai/drafts/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, payload };
}

function readError(payload: Record<string, unknown> | null, fallback: string): string {
  return typeof payload?.error === "string" ? payload.error : fallback;
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
