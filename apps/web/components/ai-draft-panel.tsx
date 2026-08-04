"use client";

import { Ban, Eye, Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";

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

const noteKinds = ["GENERAL", "CONCEPT", "METHOD", "EXAMPLE", "JOURNAL", "SUMMARY"] as const;

interface ProjectionValues {
  subjectLabel: string;
  rootNodeLabel: string;
  nodeLabel: string;
  milestoneLabel: string;
  dateStart: string;
  dateEnd: string;
  defaultDurationMinutes: string;
}

interface AiFormDraft {
  selectedText: string;
  tone: "CALM" | "DIRECT" | "BRIEF";
  scope: "global" | "subject" | "branch";
  kind: (typeof noteKinds)[number];
  checked: Partial<Record<ProjectionKey, boolean>>;
  values: ProjectionValues;
  generatedDraft: unknown;
  operation: { id: string; projectionVersion: string; resultProof: string } | null;
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

export function AiDraftPanel(props: { endpoint: Endpoint; userId: string; defaultText?: string; draftContextKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeContextKey = `${pathname}?${searchParams.toString()}`;
  const draftScope = hashDraftContext(props.draftContextKey ?? routeContextKey);
  const formDraftKey = `areaforge.ai-draft.form.${props.endpoint}.${props.userId}.${draftScope}`;
  const [selectedText, setSelectedText] = useState(props.defaultText ?? "");
  const [tone, setTone] = useState<"CALM" | "DIRECT" | "BRIEF">("CALM");
  const [scope, setScope] = useState<"global" | "subject" | "branch">("global");
  const [kind, setKind] = useState<(typeof noteKinds)[number]>("GENERAL");
  const [checked, setChecked] = useState<Partial<Record<ProjectionKey, boolean>>>({});
  const [values, setValues] = useState<ProjectionValues>(emptyProjectionValues);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<AiFormDraft["operation"]>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [pending, startTransition] = useTransition();
  const loadedDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    loadedDraftKeyRef.current = null;
    const timer = window.setTimeout(() => {
      setDraftReady(false);
      setSelectedText(props.defaultText ?? "");
      setTone("CALM");
      setScope("global");
      setKind("GENERAL");
      setChecked({});
      setValues(emptyProjectionValues);
      setPreview(null);
      setPreviewNote(null);
      setToken(null);
      setDraft(null);
      setOperation(null);
      const saved = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isAiFormDraft);
      if (saved) {
        setSelectedText(saved.selectedText);
        setTone(saved.tone);
        setScope(saved.scope);
        setKind(saved.kind);
        setChecked(saved.checked);
        setValues(saved.values);
        setDraft(saved.generatedDraft);
        setOperation(saved.operation);
      }
      loadedDraftKeyRef.current = formDraftKey;
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey, props.defaultText]);

  useEffect(() => {
    if (!draftReady || loadedDraftKeyRef.current !== formDraftKey) return;
    if (!selectedText.trim() && !draft) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<AiFormDraft>(formDraftKey, {
      selectedText,
      tone,
      scope,
      kind,
      checked,
      values,
      generatedDraft: draft,
      operation,
    });
  }, [checked, draft, draftReady, formDraftKey, kind, operation, scope, selectedText, tone, values]);

  function revokePreview() {
    setToken(null);
    setPreview(null);
    setPreviewNote(null);
    setDraft(null);
    setOperation(null);
    setSaveNotice(null);
  }

  function changeForm(update: () => void) {
    update();
    revokePreview();
    setError(null);
  }

  function clearAdoptedDraft() {
    setSelectedText("");
    setTone("CALM");
    setScope("global");
    setKind("GENERAL");
    setChecked({});
    setValues(emptyProjectionValues);
    setPreview(null);
    setPreviewNote(null);
    setToken(null);
    setDraft(null);
    setOperation(null);
    removePrivateBusinessDraft(formDraftKey);
  }

  const requestInput = { endpoint: props.endpoint, selectedText, tone, scope, kind, checked, values };
  const projectionReady = checkedProjectionIsComplete(props.endpoint, checked, values);

  async function runPreview() {
    setError(null);
    setDraft(null);
    setToken(null);
    setPreview(null);
    setPreviewNote(null);
    try {
      const response = await postDraft(props.endpoint, buildRequestBody("preview", requestInput));
      if (response.status === 401) {
        setError("登录已过期，AI 输入草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (
        !response.ok
        || typeof response.payload?.previewToken !== "string"
        || typeof response.payload.note !== "string"
      ) {
        setError(readError(response.payload, response.status === 409 ? "预览状态冲突，请显式重试" : "预览失败"));
        return;
      }
      setToken(response.payload.previewToken);
      setPreview((response.payload.payloadPreview as Record<string, unknown>) ?? null);
      setPreviewNote(response.payload.note);
    } catch {
      setError("网络不可用，AI 输入草稿已保留；恢复网络后请显式重试。");
    }
  }

  async function runGenerate() {
    if (!token) return;
    setError(null);
    try {
      const response = await postDraft(
        props.endpoint,
        buildRequestBody("generate", requestInput, token),
      );
      if (response.status === 401) {
        setError("登录已过期，AI 输入草稿已保留。重新登录后请重新预览并显式生成。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(readError(response.payload, response.status === 409 ? "生成状态冲突，请重新预览" : "生成失败"));
        return;
      }
      const generatedDraft = response.payload?.draft ?? null;
      const nextOperation = {
        id: String(response.payload?.operationId ?? ""),
        projectionVersion: String(response.payload?.projectionVersion ?? ""),
        resultProof: String(response.payload?.resultProof ?? ""),
      };
      if (!generatedDraft || !nextOperation.id || !nextOperation.projectionVersion || !nextOperation.resultProof) {
        setError("生成结果不完整，请重新预览并显式重试。");
        return;
      }
      savePrivateBusinessDraft<AiFormDraft>(formDraftKey, {
        selectedText,
        tone,
        scope,
        kind,
        checked,
        values,
        generatedDraft,
        operation: nextOperation,
      });
      setDraft(generatedDraft);
      setOperation(nextOperation);
      setSaveNotice("草稿已生成，仍需你明确采用或放弃；确认中心会保留待处理状态。");
    } catch {
      setError("网络不可用，AI 输入草稿已保留；恢复网络后请重新预览并显式重试。");
    }
  }

  async function adoptDraft() {
    if (!draft || !operation?.id || savingResult) return;
    setError(null);
    setSaveNotice(null);
    setSavingResult(true);
    try {
      if (!await acknowledgeResult(operation, "结果确认失败，草稿已保留，请显式重试采用。")) return;
      if (props.endpoint === "learning-tree" && isLearningTreeDraft(draft)) {
        saveLocalAiDraft(props.userId, "learning-tree", { markdownDraft: draft.markdownDraft, scope });
        clearAdoptedDraft();
        router.push("/knowledge/imports");
        return;
      }
      if (props.endpoint === "knowledge-card" && isKnowledgeCardDraft(draft)) {
        saveLocalAiDraft(props.userId, "knowledge-card", draft);
        clearAdoptedDraft();
        router.push("/knowledge/cards");
        return;
      }
      if (props.endpoint === "plan" && isPlanDraft(draft)) {
        const plannedDate = checked.dateWindow && values.dateStart
          ? new Date(`${values.dateStart}T00:00:00+08:00`).toISOString()
          : null;
        const response = await fetch("/api/plan-inbox/ai-plan-adoptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operationId: operation.id,
            projectionVersion: operation.projectionVersion,
            resultProof: operation.resultProof,
            tasks: draft.tasks.map((task) => ({
              title: task.title,
              plannedDate,
              estimatedMinutes: task.estimatedMinutes,
            })),
          }),
        });
        if (response.status === 401) {
          setError("登录已过期，生成结果已保留。重新登录后请显式重试采用。");
          redirectToLoginWithCurrentLocation();
          return;
        }
        if (!response.ok) throw new Error(readError(await response.json().catch(() => null), "计划草稿入箱失败"));
        setSaveNotice(`已将 ${draft.tasks.length} 项计划草稿加入收件箱，仍需逐项补全并转换。`);
        clearAdoptedDraft();
        return;
      }
      if (props.endpoint === "motivation" && isMotivationDraft(draft)) {
        const commandPayload = {
          type: "QUOTE" as const,
          title: draft.line.slice(0, 160),
          body: `${draft.line}\n\n${draft.recoveryHint}`,
          tags: ["ai-draft"],
        };
        const commandScope = `ai-motivation-adoption:${operation.id}`;
        const response = await fetch("/api/motivation/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...commandPayload,
            idempotencyKey: getOrCreateIdempotencyKey(commandScope, "motivation-item", commandPayload),
          }),
        });
        if (response.status === 401) {
          setError("登录已过期，生成结果已保留。重新登录后请显式重试采用。");
          redirectToLoginWithCurrentLocation();
          return;
        }
        if (!response.ok) throw new Error(readError(await response.json().catch(() => null), "动机草稿保存失败"));
        completeIdempotentCommand(commandScope);
        setSaveNotice("已保存到动机内容库。生成操作本身未自动写入内容库。");
        clearAdoptedDraft();
        return;
      }
      throw new Error("草稿结构与当前用途不匹配，请重新生成。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "采用草稿失败");
    } finally {
      setSavingResult(false);
    }
  }

  async function rejectDraft() {
    if (!draft || !operation?.id || savingResult) return;
    setError(null);
    setSaveNotice(null);
    setSavingResult(true);
    try {
      const response = await postDraft(props.endpoint, {
        phase: "reject",
        resultProof: operation.resultProof,
      });
      if (response.status === 401) {
        setError("登录已过期，AI 草稿已保留。重新登录后请显式重试放弃。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(readError(response.payload, response.status === 409 ? "草稿状态已变化，请刷新确认" : "放弃草稿失败"));
        return;
      }
      if (
        response.payload?.operationId !== operation.id
        || response.payload?.projectionVersion !== operation.projectionVersion
        || response.payload?.status !== "REJECTED"
      ) {
        setError("驳回结果身份不一致，草稿仍保留，请重新检查。");
        return;
      }
      clearAdoptedDraft();
      setSaveNotice("草稿已放弃；服务端保留了这次 AI 生成历史。");
    } catch {
      setError("网络不可用，草稿仍保留；恢复网络后请显式重试放弃。");
    } finally {
      setSavingResult(false);
    }
  }

  async function acknowledgeResult(
    currentOperation: NonNullable<AiFormDraft["operation"]>,
    failureMessage: string,
  ): Promise<boolean> {
    try {
      const response = await postDraft(props.endpoint, {
        phase: "ack",
        resultProof: currentOperation.resultProof,
      });
      if (response.status === 401) {
        setError("登录已过期，生成结果已保留。重新登录后请显式重试采用。");
        redirectToLoginWithCurrentLocation();
        return false;
      }
      if (!response.ok) {
        setError(readError(response.payload, failureMessage));
        return false;
      }
      if (
        response.payload?.operationId !== currentOperation.id
        || response.payload?.projectionVersion !== currentOperation.projectionVersion
      ) {
        setError("生成结果身份不一致，请重新预览并显式生成。");
        return false;
      }
      return true;
    } catch {
      setError(failureMessage);
      return false;
    }
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
      {previewNote ? <p role="status" className="text-sm text-zinc-300">{previewNote}</p> : null}
      {preview ? <PayloadPreview title="本次生成输入预览" value={preview} /> : null}
      {draft ? <PayloadPreview title="草稿结果" value={draft} accent /> : null}
      {draft ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={savingResult} className="inline-flex h-10 items-center gap-2 rounded-md border border-teal-300/30 px-3 text-sm text-teal-200 disabled:opacity-60" onClick={() => void adoptDraft()}>
            {savingResult ? "处理中..." : adoptDraftLabel(props.endpoint)}
          </button>
          <button type="button" disabled={savingResult} className="inline-flex h-10 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-zinc-300 disabled:opacity-60" onClick={() => void rejectDraft()}>
            <Ban aria-hidden="true" size={15} />
            放弃草稿
          </button>
        </div>
      ) : null}
      {saveNotice ? <p role="status" className="text-sm text-teal-200">{saveNotice}</p> : null}
    </div>
  );
}

function adoptDraftLabel(endpoint: Endpoint): string {
  return ({ "learning-tree": "送往学习树校验", "knowledge-card": "转到知识卡片表单", plan: "加入投入草稿", motivation: "保存到动机内容库" })[endpoint];
}

function saveLocalAiDraft(userId: string, endpoint: "learning-tree" | "knowledge-card", value: unknown) {
  window.localStorage.setItem(`areaforge.ai-draft.${endpoint}.${userId}`, JSON.stringify({ version: 1, userId, updatedAt: Date.now(), value }));
}

function isLearningTreeDraft(value: unknown): value is { schemaVersion: "learning-tree-draft-v1"; markdownDraft: string } {
  return isRecord(value) && value.schemaVersion === "learning-tree-draft-v1" && typeof value.markdownDraft === "string";
}

function isKnowledgeCardDraft(value: unknown): value is { schemaVersion: "knowledge-card-draft-v1"; title: string; body: string; kindHint: string } {
  return isRecord(value) && value.schemaVersion === "knowledge-card-draft-v1" && typeof value.title === "string" && typeof value.body === "string" && typeof value.kindHint === "string";
}

function isPlanDraft(value: unknown): value is { schemaVersion: "plan-draft-v1"; tasks: Array<{ title: string; estimatedMinutes: number }> } {
  return isRecord(value) && value.schemaVersion === "plan-draft-v1" && Array.isArray(value.tasks) && value.tasks.every((task) => isRecord(task) && typeof task.title === "string" && typeof task.estimatedMinutes === "number");
}

function isMotivationDraft(value: unknown): value is { schemaVersion: "motivation-draft-v1"; line: string; recoveryHint: string } {
  return isRecord(value) && value.schemaVersion === "motivation-draft-v1" && typeof value.line === "string" && typeof value.recoveryHint === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return { ok: response.ok, status: response.status, payload };
}

function isAiFormDraft(value: unknown): value is AiFormDraft {
  if (!isRecord(value) || typeof value.selectedText !== "string") return false;
  if (!["CALM", "DIRECT", "BRIEF"].includes(String(value.tone))) return false;
  if (!["global", "subject", "branch"].includes(String(value.scope))) return false;
  if (!noteKinds.includes(value.kind as (typeof noteKinds)[number])) return false;
  if (!isRecord(value.checked) || !isProjectionValues(value.values)) return false;
  if (value.operation !== null && (
    !isRecord(value.operation)
    || typeof value.operation.id !== "string"
    || typeof value.operation.projectionVersion !== "string"
    || typeof value.operation.resultProof !== "string"
    || !value.operation.resultProof
  )) return false;
  return true;
}

function hashDraftContext(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash).toString(36);
}

function isProjectionValues(value: unknown): value is ProjectionValues {
  if (!isRecord(value)) return false;
  return [
    "subjectLabel",
    "rootNodeLabel",
    "nodeLabel",
    "milestoneLabel",
    "dateStart",
    "dateEnd",
    "defaultDurationMinutes",
  ].every((key) => typeof value[key] === "string");
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
