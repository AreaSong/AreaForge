import { getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import {
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { WindowWorkState } from "@/lib/client/window-system-state";
import type { MotivationDraftAdvice, PlanDraftAdvice } from "@/lib/contracts";
import { shanghaiDateInputToIso } from "@/lib/formatters";
import {
  emptyProjectionValues,
  hasDraftWork,
  type AiDraftEndpoint,
  type AiDraftNoteKind,
  type AiDraftRequestInput,
  type AiDraftScope,
  type AiDraftTone,
  type AiFormDraft,
  type ProjectionValues,
} from "@/components/ai-draft-panel-model";

export interface WorkflowFormState {
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
  operation: AiFormDraft["operation"];
}

export interface AdoptionSnapshot {
  endpoint: AiDraftEndpoint;
  userId: string;
  formDraftKey: string;
  scope: AiDraftScope;
  values: ProjectionValues;
  checked: AiFormDraft["checked"];
  draft: unknown;
  operation: NonNullable<AiFormDraft["operation"]>;
}

export function snapshotAdoption(
  options: { endpoint: AiDraftEndpoint; userId: string },
  form: WorkflowFormState,
  formDraftKey: string,
): AdoptionSnapshot {
  return {
    endpoint: options.endpoint,
    userId: options.userId,
    formDraftKey,
    scope: form.scope,
    values: { ...form.values },
    checked: { ...form.checked },
    draft: form.draft,
    operation: { ...form.operation! },
  };
}

export function snapshotRequestInput(
  endpoint: AiDraftEndpoint,
  form: WorkflowFormState,
): AiDraftRequestInput {
  return {
    endpoint,
    selectedText: form.selectedText,
    tone: form.tone,
    scope: form.scope,
    kind: form.kind,
    checked: { ...form.checked },
    values: { ...form.values },
  };
}

export function readGeneratedResult(body: {
  draft?: unknown;
  operationId?: unknown;
  projectionVersion?: unknown;
  resultProof?: unknown;
} | null): { draft: unknown; operation: NonNullable<AiFormDraft["operation"]> } | null {
  const operation = {
    id: String(body?.operationId ?? ""),
    projectionVersion: String(body?.projectionVersion ?? ""),
    resultProof: String(body?.resultProof ?? ""),
  };
  return body?.draft && operation.id && operation.projectionVersion && operation.resultProof
    ? { draft: body.draft, operation }
    : null;
}

export function persistGeneratedDraft(
  persistence: { contextKey: string; formDraftKey: string },
  input: AiDraftRequestInput,
  generated: { draft: unknown; operation: NonNullable<AiFormDraft["operation"]> },
): void {
  savePrivateBusinessDraft<AiFormDraft>(persistence.formDraftKey, {
    contextKey: persistence.contextKey,
    selectedText: input.selectedText,
    tone: input.tone,
    scope: input.scope,
    kind: input.kind,
    checked: input.checked,
    values: input.values,
    generatedDraft: generated.draft,
    operation: generated.operation,
  });
}

export function buildPlanAdoptionRequest(snapshot: AdoptionSnapshot, draft: PlanDraftAdvice) {
  const plannedDate = snapshot.checked.dateWindow && snapshot.values.dateStart
    ? shanghaiDateInputToIso(snapshot.values.dateStart)
    : null;
  return {
    operationId: snapshot.operation.id,
    projectionVersion: snapshot.operation.projectionVersion,
    resultProof: snapshot.operation.resultProof,
    tasks: draft.tasks.map((task) => ({
      title: task.title,
      plannedDate,
      estimatedMinutes: task.estimatedMinutes,
    })),
  };
}

export function buildMotivationAdoptionRequest(
  snapshot: AdoptionSnapshot,
  draft: MotivationDraftAdvice,
) {
  const payload = {
    type: "QUOTE" as const,
    title: draft.line.slice(0, 160),
    body: `${draft.line}\n\n${draft.recoveryHint}`,
    tags: ["ai-draft"],
  };
  const scope = `ai-motivation-adoption:${snapshot.operation.id}`;
  return {
    scope,
    body: {
      ...payload,
      idempotencyKey: getOrCreateIdempotencyKey(scope, "motivation-item", payload),
    },
  };
}

export function emptyWorkflowForm(defaultText = ""): WorkflowFormState {
  return {
    selectedText: defaultText,
    tone: "CALM",
    scope: "global",
    kind: "GENERAL",
    checked: {},
    values: { ...emptyProjectionValues },
    preview: null,
    previewNote: null,
    token: null,
    draft: null,
    operation: null,
  };
}

export function revokePreview(form: WorkflowFormState): WorkflowFormState {
  return {
    ...form,
    preview: null,
    previewNote: null,
    token: null,
    draft: null,
    operation: null,
  };
}

export function workflowFormFromDraft(draft: AiFormDraft): WorkflowFormState {
  return {
    selectedText: draft.selectedText,
    tone: draft.tone,
    scope: draft.scope,
    kind: draft.kind,
    checked: draft.checked,
    values: draft.values,
    preview: null,
    previewNote: null,
    token: null,
    draft: draft.generatedDraft,
    operation: draft.operation,
  };
}

export function formDraftFromWorkflow(
  contextKey: string,
  form: WorkflowFormState,
): AiFormDraft {
  return {
    contextKey,
    selectedText: form.selectedText,
    tone: form.tone,
    scope: form.scope,
    kind: form.kind,
    checked: form.checked,
    values: form.values,
    generatedDraft: form.draft,
    operation: form.operation,
  };
}

export function getAiDraftWorkState(
  form: WorkflowFormState,
  pending: boolean,
  savingResult: boolean,
): WindowWorkState {
  if (pending || savingResult) return "submitting";
  return hasDraftWork(form) ? "dirty" : "clean";
}

export function clearPersistedAdoptedDraft(formDraftKey: string): void {
  removePrivateBusinessDraft(formDraftKey);
}
