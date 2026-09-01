"use client";

import {
  acknowledgeAiDraft,
  generateAiDraft,
  previewAiDraft,
  rejectAiDraft,
} from "@/lib/api/ai";
import { createMotivationItem } from "@/lib/api/motivation";
import { adoptAiPlan } from "@/lib/api/plan-inbox";
import { isConflict, isUnauthorized } from "@/lib/client/api-errors";
import { getAiDraftFormStorageKey } from "@/lib/client/ai-draft-form-key";
import { completeIdempotentCommand } from "@/lib/client/idempotent-command";
import { createExclusiveOperationGate, createLatestOperationGate } from "@/lib/client/operation-gates";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { WindowWorkState } from "@/lib/client/window-system-state";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  buildAiDraftGenerateRequest,
  buildAiDraftPreviewRequest,
  checkedProjectionIsComplete,
  isAiFormDraftForContext,
  readAiDraftError,
  resolveAiDraftAdoption,
  saveLocalAiDraft,
  type AiDraftEndpoint,
  type AiDraftNoteKind,
  type AiDraftScope,
  type AiDraftTone,
  type AiFormDraft,
  type ProjectionKey,
  type ProjectionValues,
} from "@/components/ai-draft-panel-model";
import {
  buildMotivationAdoptionRequest,
  buildPlanAdoptionRequest,
  clearPersistedAdoptedDraft,
  emptyWorkflowForm,
  formDraftFromWorkflow,
  getAiDraftWorkState,
  persistGeneratedDraft,
  readGeneratedResult,
  revokePreview,
  snapshotAdoption,
  snapshotRequestInput,
  workflowFormFromDraft,
  type AdoptionSnapshot,
  type WorkflowFormState,
} from "@/components/ai-draft-workflow-support";

interface AiDraftWorkflowOptions {
  endpoint: AiDraftEndpoint;
  userId: string;
  routeContextKey: string;
  defaultText?: string;
  draftContextKey?: string;
  onWorkStateChange?: (state: WindowWorkState) => void;
  onNavigate?: () => void;
}

type NetworkOperation = "preview" | "generate" | null;

export function useAiDraftWorkflow(options: AiDraftWorkflowOptions) {
  const router = useRouter();
  const contextKey = options.draftContextKey ?? options.routeContextKey;
  const formDraftKey = getAiDraftFormStorageKey(options.endpoint, options.userId, contextKey);
  const [form, setForm] = useState<WorkflowFormState>(() => emptyWorkflowForm(options.defaultText));
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [networkOperation, setNetworkOperation] = useState<NetworkOperation>(null);
  const [savingResult, setSavingResult] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const loadedDraftKeyRef = useRef<string | null>(null);
  const requestGateRef = useRef(createLatestOperationGate());
  const resultGateRef = useRef(createExclusiveOperationGate());

  const pending = networkOperation !== null;
  const projectionReady = checkedProjectionIsComplete(options.endpoint, form.checked, form.values);
  const workState = getAiDraftWorkState(form, pending, savingResult);
  const onWorkStateChange = options.onWorkStateChange;

  useEffect(() => onWorkStateChange?.(workState), [onWorkStateChange, workState]);
  useHydratedDraft({
    contextKey,
    defaultText: options.defaultText,
    formDraftKey,
    loadedDraftKeyRef,
    requestGateRef,
    resultGateRef,
    setDraftReady,
    setForm,
    setNetworkOperation,
    setSavingResult,
  });
  usePersistedDraft({ contextKey, draftReady, form, formDraftKey, loadedDraftKeyRef });

  useEffect(() => () => {
    requestGateRef.current.invalidate();
    resultGateRef.current.invalidate();
  }, []);

  function changeForm(update: (current: WorkflowFormState) => WorkflowFormState) {
    if (resultGateRef.current.isLocked()) return;
    requestGateRef.current.invalidate();
    setNetworkOperation(null);
    setForm((current) => revokePreview(update(current)));
    setError(null);
    setSaveNotice(null);
  }

  function clearAdoptedDraft() {
    requestGateRef.current.invalidate();
    setForm(emptyWorkflowForm());
    removePrivateBusinessDraft(formDraftKey);
  }

  async function runPreview() {
    if (resultGateRef.current.isLocked()) return;
    const requestToken = requestGateRef.current.begin();
    const inputSnapshot = snapshotRequestInput(options.endpoint, form);
    setNetworkOperation("preview");
    setError(null);
    setForm((current) => revokePreview(current));
    try {
      const response = await previewAiDraft(options.endpoint, buildAiDraftPreviewRequest(inputSnapshot));
      if (!requestGateRef.current.isCurrent(requestToken)) return;
      if (isUnauthorized(response)) {
        setError("登录已过期，AI 输入草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok || typeof response.body?.previewToken !== "string" || typeof response.body.note !== "string") {
        setError(readAiDraftError(response.body, isConflict(response) ? "预览状态冲突，请显式重试" : "预览失败"));
        return;
      }
      const previewBody = response.body;
      setForm((current) => ({
        ...current,
        token: previewBody.previewToken,
        preview: previewBody.payloadPreview,
        previewNote: previewBody.note,
      }));
    } catch {
      if (requestGateRef.current.isCurrent(requestToken)) {
        setError("网络不可用，AI 输入草稿已保留；恢复网络后请显式重试。");
      }
    } finally {
      if (requestGateRef.current.finish(requestToken)) setNetworkOperation(null);
    }
  }

  async function runGenerate() {
    if (!form.token || resultGateRef.current.isLocked()) return;
    const requestToken = requestGateRef.current.begin();
    const inputSnapshot = snapshotRequestInput(options.endpoint, form);
    const tokenSnapshot = form.token;
    const persistenceSnapshot = { contextKey, formDraftKey };
    setNetworkOperation("generate");
    setError(null);
    try {
      const response = await generateAiDraft(
        options.endpoint,
        buildAiDraftGenerateRequest(inputSnapshot, tokenSnapshot),
      );
      if (!requestGateRef.current.isCurrent(requestToken)) return;
      if (isUnauthorized(response)) {
        setError("登录已过期，AI 输入草稿已保留。重新登录后请重新预览并显式生成。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(readAiDraftError(response.body, isConflict(response) ? "生成状态冲突，请重新预览" : "生成失败"));
        return;
      }
      const generated = readGeneratedResult(response.body);
      if (!generated) {
        setError("生成结果不完整，请重新预览并显式重试。");
        return;
      }
      persistGeneratedDraft(persistenceSnapshot, inputSnapshot, generated);
      setForm((current) => ({ ...current, draft: generated.draft, operation: generated.operation }));
      setSaveNotice("草稿已生成，仍需你明确采用或放弃；确认中心会保留待处理状态。");
    } catch {
      if (requestGateRef.current.isCurrent(requestToken)) {
        setError("网络不可用，AI 输入草稿已保留；恢复网络后请重新预览并显式重试。");
      }
    } finally {
      if (requestGateRef.current.finish(requestToken)) setNetworkOperation(null);
    }
  }

  async function adoptDraft() {
    if (!form.draft || !form.operation?.id) return;
    const resultToken = resultGateRef.current.acquire();
    if (!resultToken) return;
    const snapshot = snapshotAdoption(options, form, formDraftKey);
    setError(null);
    setSaveNotice(null);
    setSavingResult(true);
    try {
      if (!await acknowledgeResult(snapshot, resultToken)) return;
      if (!resultGateRef.current.isActive(resultToken)) return;
      await applyAdoption(snapshot, resultToken);
    } catch (caught) {
      if (resultGateRef.current.isActive(resultToken)) {
        setError(caught instanceof Error ? caught.message : "采用草稿失败");
      }
    } finally {
      if (resultGateRef.current.release(resultToken)) setSavingResult(false);
    }
  }

  async function rejectDraft() {
    if (!form.draft || !form.operation?.id) return;
    const resultToken = resultGateRef.current.acquire();
    if (!resultToken) return;
    const operation = { ...form.operation };
    const endpoint = options.endpoint;
    setError(null);
    setSaveNotice(null);
    setSavingResult(true);
    try {
      const response = await rejectAiDraft(endpoint, { phase: "reject", resultProof: operation.resultProof });
      if (!resultGateRef.current.isActive(resultToken)) return;
      if (isUnauthorized(response)) {
        setError("登录已过期，AI 草稿已保留。重新登录后请显式重试放弃。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(readAiDraftError(response.body, isConflict(response) ? "草稿状态已变化，请刷新确认" : "放弃草稿失败"));
        return;
      }
      if (response.body?.operationId !== operation.id
        || response.body?.projectionVersion !== operation.projectionVersion
        || response.body?.status !== "REJECTED") {
        setError("驳回结果身份不一致，草稿仍保留，请重新检查。");
        return;
      }
      clearAdoptedDraft();
      setSaveNotice("草稿已放弃；服务端保留了这次 AI 生成历史。");
    } catch {
      if (resultGateRef.current.isActive(resultToken)) {
        setError("网络不可用，草稿仍保留；恢复网络后请显式重试放弃。");
      }
    } finally {
      if (resultGateRef.current.release(resultToken)) setSavingResult(false);
    }
  }

  async function acknowledgeResult(snapshot: AdoptionSnapshot, resultToken: { generation: number }) {
    try {
      const response = await acknowledgeAiDraft(snapshot.endpoint, {
        phase: "ack",
        resultProof: snapshot.operation.resultProof,
      });
      if (!resultGateRef.current.isActive(resultToken)) return false;
      if (isUnauthorized(response)) {
        setError("登录已过期，生成结果已保留。重新登录后请显式重试采用。");
        redirectToLoginWithCurrentLocation();
        return false;
      }
      if (!response.ok) {
        setError(readAiDraftError(response.body, "结果确认失败，草稿已保留，请显式重试采用。"));
        return false;
      }
      if (response.body?.operationId !== snapshot.operation.id
        || response.body?.projectionVersion !== snapshot.operation.projectionVersion) {
        setError("生成结果身份不一致，请重新预览并显式生成。");
        return false;
      }
      return true;
    } catch {
      if (resultGateRef.current.isActive(resultToken)) {
        setError("结果确认失败，草稿已保留，请显式重试采用。");
      }
      return false;
    }
  }

  async function applyAdoption(snapshot: AdoptionSnapshot, resultToken: { generation: number }) {
    const adoption = resolveAiDraftAdoption(snapshot.endpoint, snapshot.draft);
    if (!adoption) throw new Error("草稿结构与当前用途不匹配，请重新生成。");
    if (adoption.kind === "learning-tree") {
      saveLocalAiDraft(snapshot.userId, adoption.kind, {
        markdownDraft: adoption.draft.markdownDraft,
        scope: snapshot.scope,
      });
      finishNavigation(snapshot, "/knowledge/imports");
    } else if (adoption.kind === "knowledge-card") {
      saveLocalAiDraft(snapshot.userId, adoption.kind, adoption.draft);
      finishNavigation(snapshot, "/knowledge/cards");
    } else if (adoption.kind === "plan") {
      const response = await adoptAiPlan(buildPlanAdoptionRequest(snapshot, adoption.draft));
      if (!resultGateRef.current.isActive(resultToken)) return;
      handleAdoptionResponse(response, `已将 ${adoption.draft.tasks.length} 项计划草稿加入收件箱，仍需逐项补全并转换。`, "计划草稿入箱失败");
    } else {
      const command = buildMotivationAdoptionRequest(snapshot, adoption.draft);
      const response = await createMotivationItem(command.body);
      if (!resultGateRef.current.isActive(resultToken)) return;
      if (handleAdoptionResponse(response, "已保存到动机内容库。生成操作本身未自动写入内容库。", "动机草稿保存失败")) {
        completeIdempotentCommand(command.scope);
      }
    }
  }

  function finishNavigation(snapshot: AdoptionSnapshot, href: string) {
    clearPersistedAdoptedDraft(snapshot.formDraftKey);
    setForm(emptyWorkflowForm());
    options.onNavigate?.();
    router.push(href);
  }

  function handleAdoptionResponse(
    response: { ok: boolean; status: number; body: { error?: unknown } | null },
    successNotice: string,
    failureMessage: string,
  ) {
    if (isUnauthorized(response)) {
      setError("登录已过期，生成结果已保留。重新登录后请显式重试采用。");
      redirectToLoginWithCurrentLocation();
      return false;
    }
    if (!response.ok) throw new Error(readAiDraftError(response.body, failureMessage));
    clearAdoptedDraft();
    setSaveNotice(successNotice);
    return true;
  }

  return {
    endpoint: options.endpoint,
    ...form,
    error,
    saveNotice,
    projectionReady,
    pending,
    savingResult,
    onSelectedTextChange: (value: string) => changeForm((current) => ({ ...current, selectedText: value })),
    onToneChange: (value: AiDraftTone) => changeForm((current) => ({ ...current, tone: value })),
    onScopeChange: (value: AiDraftScope) => changeForm((current) => ({ ...current, scope: value })),
    onKindChange: (value: AiDraftNoteKind) => changeForm((current) => ({ ...current, kind: value })),
    onCheckedChange: (key: ProjectionKey, value: boolean) => changeForm((current) => ({
      ...current,
      checked: { ...current.checked, [key]: value },
    })),
    onValueChange: (key: keyof ProjectionValues, value: string) => changeForm((current) => ({
      ...current,
      values: { ...current.values, [key]: value },
    })),
    onPreview: () => void runPreview(),
    onGenerate: () => void runGenerate(),
    onAdopt: () => void adoptDraft(),
    onReject: () => void rejectDraft(),
  };
}

function useHydratedDraft(input: {
  contextKey: string;
  defaultText?: string;
  formDraftKey: string;
  loadedDraftKeyRef: React.MutableRefObject<string | null>;
  requestGateRef: React.MutableRefObject<ReturnType<typeof createLatestOperationGate>>;
  resultGateRef: React.MutableRefObject<ReturnType<typeof createExclusiveOperationGate>>;
  setDraftReady: (value: boolean) => void;
  setForm: (value: WorkflowFormState) => void;
  setNetworkOperation: (value: NetworkOperation) => void;
  setSavingResult: (value: boolean) => void;
}) {
  const {
    contextKey,
    defaultText,
    formDraftKey,
    loadedDraftKeyRef,
    requestGateRef,
    resultGateRef,
    setDraftReady,
    setForm,
    setNetworkOperation,
    setSavingResult,
  } = input;
  useEffect(() => {
    requestGateRef.current.invalidate();
    resultGateRef.current.invalidate();
    loadedDraftKeyRef.current = null;
    const timer = window.setTimeout(() => {
      setNetworkOperation(null);
      setSavingResult(false);
      setDraftReady(false);
      const saved = loadPrivateBusinessDraft(
        formDraftKey,
        LONG_PRIVATE_DRAFT_TTL_MS,
        (value): value is AiFormDraft => isAiFormDraftForContext(value, contextKey),
      );
      setForm(saved ? workflowFormFromDraft(saved) : emptyWorkflowForm(defaultText));
      loadedDraftKeyRef.current = formDraftKey;
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [contextKey, defaultText, formDraftKey, loadedDraftKeyRef, requestGateRef, resultGateRef, setDraftReady, setForm, setNetworkOperation, setSavingResult]);
}

function usePersistedDraft(input: {
  contextKey: string;
  draftReady: boolean;
  form: WorkflowFormState;
  formDraftKey: string;
  loadedDraftKeyRef: React.MutableRefObject<string | null>;
}) {
  const { contextKey, draftReady, form, formDraftKey, loadedDraftKeyRef } = input;
  useEffect(() => {
    if (!draftReady || loadedDraftKeyRef.current !== formDraftKey) return;
    if (!form.selectedText.trim() && !form.draft) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<AiFormDraft>(formDraftKey, formDraftFromWorkflow(contextKey, form));
  }, [contextKey, draftReady, form, formDraftKey, loadedDraftKeyRef]);
}
