"use client";

import { FileUp, Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConflictResolutionModal, type ConflictComparison } from "@/components/conflict-resolution-modal";
import { ListDetailLink, useRestoreListReturn } from "@/components/list-return-context";
import { Drawer } from "@/components/ui/overlays";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { StudyResourceDto, StudyResourceEditorOptionsDto, StagingUploadResult } from "@/lib/study/study-resource-service";

type UploadItem = {
  key: string;
  file?: File;
  originalName: string;
  status: "ready" | "staging" | "duplicate" | "done" | "failed";
  staging?: StagingUploadResult;
  decision?: "reuse" | "copy" | "skip";
  reuseResourceId?: string;
  resultTitle?: string;
  error?: string;
  submittedSnapshot?: UploadResolutionRequest;
};

type UploadResolutionRequest = {
  attachmentId: string;
  decision: "reuse" | "copy" | "skip";
  reuseResourceId?: string;
  title: string;
  subjectId: string | null;
  category: string;
  tags: string[];
};

type UploadResolutionLatest = {
  attachmentId: string;
  decision: "reuse" | "copy" | "skip";
  resourceId: string | null;
  resource: StudyResourceDto | null;
  request: UploadResolutionRequest | null;
};

type UploadResolutionConflict = {
  itemKey: string;
  submitted: UploadResolutionRequest;
  latest: UploadResolutionLatest;
  conflictFields: string[];
  workbench: string;
};

type BatchStagingResponseItem = {
  index: number;
  originalName: string;
  staging: StagingUploadResult | null;
  error: string | null;
};

type PendingUploadDraft = {
  key: string;
  fileName: string;
  staging: StagingUploadResult;
  decision: "reuse" | "copy" | "skip";
  reuseResourceId?: string;
  submittedSnapshot?: UploadResolutionRequest;
};

type ResourceFormDraft = {
  mode: "files" | "link";
  subjectId: string;
  category: string;
  tags: string;
  linkTitle: string;
  linkUrl: string;
};

const categories = [
  ["TEXTBOOK", "教材/讲义"], ["COURSE", "课程资料"], ["EXERCISE", "习题/题集"],
  ["PAST_PAPER", "真题/模拟"], ["SOLUTION", "题解/解析"], ["SUMMARY", "总结/速查"],
  ["IMAGE", "截图/图片"], ["OTHER", "其他"],
] as const;

export function StudyResourceWorkbench(props: {
  userId: string;
  resources: StudyResourceDto[];
  archivedResources: StudyResourceDto[];
  options: StudyResourceEditorOptionsDto;
  initialSubjectId?: string;
  initialCreate?: boolean;
}) {
  const router = useRouter();
  const createModeRef = useRef<HTMLButtonElement>(null);
  const pendingUploadDraftKey = `areaforge.resource.draft.upload-pending.${props.userId}`;
  const formDraftKey = `areaforge.resource.draft.form.${props.userId}`;
  useRestoreListReturn();
  const [mode, setMode] = useState<"files" | "link">("files");
  const [uploads, setUploads] = useState<UploadItem[]>(() => loadPendingUploads(pendingUploadDraftKey));
  const [subjectId, setSubjectId] = useState(props.options.subjects.some((subject) => subject.id === props.initialSubjectId) ? props.initialSubjectId as string : props.options.subjects[0]?.id ?? "");
  const [category, setCategory] = useState("OTHER");
  const [tags, setTags] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateDrawerOpen, setDuplicateDrawerOpen] = useState(false);
  const [resolutionConflict, setResolutionConflict] = useState<UploadResolutionConflict | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [recoveredPending, setRecoveredPending] = useState(() => loadPendingUploads(pendingUploadDraftKey).some((item) => item.status === "duplicate"));
  const [formDraftReady, setFormDraftReady] = useState(false);

  useEffect(() => {
    if (!props.initialCreate) return;
    const timer = window.setTimeout(() => {
      createModeRef.current?.scrollIntoView({ block: "center" });
      createModeRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.initialCreate]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(formDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isResourceFormDraft);
      if (draft) {
        setMode(draft.mode);
        setSubjectId(draft.subjectId);
        setCategory(draft.category);
        setTags(draft.tags);
        setLinkTitle(draft.linkTitle);
        setLinkUrl(draft.linkUrl);
      }
      setFormDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [formDraftKey]);

  useEffect(() => {
    if (!formDraftReady) return;
    if (!linkTitle && !linkUrl && !tags && !uploads.some((item) => item.status === "duplicate")) {
      removePrivateBusinessDraft(formDraftKey);
      return;
    }
    savePrivateBusinessDraft<ResourceFormDraft>(formDraftKey, { mode, subjectId, category, tags, linkTitle, linkUrl });
  }, [category, formDraftKey, formDraftReady, linkTitle, linkUrl, mode, subjectId, tags, uploads]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/study-resources/uploads/staging", { method: "GET", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json().catch(() => null) as { items?: StagingUploadResult[] } | null;
      })
      .then((body) => {
        if (cancelled || !body?.items?.length) return;
        const restored = body.items.map((staging) => restoreServerPendingUpload(staging));
        setUploads((current) => mergePendingUploads(current, restored));
        setRecoveredPending(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const pendingItems = uploads.filter((item): item is UploadItem & { staging: StagingUploadResult; decision: "reuse" | "copy" | "skip" } => item.status === "duplicate" && Boolean(item.staging && item.decision));
    if (pendingItems.length === 0) {
      removePrivateBusinessDraft(pendingUploadDraftKey);
      return;
    }
    const draft: PendingUploadDraft[] = pendingItems.map((item) => ({
      key: item.key,
      fileName: item.originalName,
      staging: {
        attachment: item.staging.attachment,
        duplicates: item.staging.duplicates.map(({ resourceId, stableKey, title }) => ({ resourceId, stableKey, title })),
      },
      decision: item.decision,
      reuseResourceId: item.reuseResourceId,
      submittedSnapshot: item.submittedSnapshot,
    }));
    savePrivateBusinessDraft(pendingUploadDraftKey, draft);
  }, [pendingUploadDraftKey, uploads]);

  useEffect(() => {
    const hasUnresolvedUpload = pending || uploads.some((item) => item.status === "staging" || item.status === "duplicate");
    if (!hasUnresolvedUpload) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "仍有未完成的资料上传或重复处理，离开后可返回恢复。";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [pending, uploads]);

  function selectFiles(files: FileList | null) {
    setError(null);
    setRecoveredPending(false);
    if (!files) return;
    const selected = Array.from(files);
    if (selected.length < 1 || selected.length > 5) {
      setUploads([]);
      setError("每批请选择 1 至 5 个文件");
      return;
    }
    setUploads(selected.map((file) => ({ key: crypto.randomUUID(), file, originalName: file.name, status: "ready" })));
  }

  async function uploadBatch() {
    if (!uploads.length || pending) return;
    setPending(true);
    setError(null);
    const selected = uploads.filter((item) => item.status === "ready");
    const commandScope = `study-resource:upload-batch:${props.userId}`;
    const idempotencyKey = getOrCreateIdempotencyKey(commandScope, "resource-upload", selected.map((item) => ({
      name: item.file?.name ?? item.originalName,
      size: item.file?.size ?? null,
      type: item.file?.type ?? null,
      lastModified: item.file?.lastModified ?? null,
    })));
    setUploads((current) => current.map((item) => item.status === "ready" ? { ...item, status: "staging" } : item));
    const form = new FormData();
    selected.forEach((item) => {
      if (item.file) form.append("file", item.file);
    });
    let response: Response;
    try {
      response = await fetch("/api/study-resources/uploads/staging", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: form,
      });
    } catch {
      const message = "上传请求失败，请检查网络后重新选择文件";
      setUploads((current) => current.map((item) => item.status === "staging" ? { ...item, status: "failed", error: message } : item));
      setError(message);
      setPending(false);
      return;
    }
    if (response.status === 401) {
      setUploads((current) => current.map((item) => item.status === "staging" ? { ...item, status: "failed", error: "登录已过期，请重新登录后重新选择文件" } : item));
      setPending(false);
      redirectToLoginWithCurrentLocation();
      return;
    }
    const body = await response.json().catch(() => null) as { items?: BatchStagingResponseItem[]; error?: string } | null;
    if (!response.ok || !body?.items) {
      const message = body?.error ?? "上传失败";
      setUploads((current) => current.map((item) => item.status === "staging" ? { ...item, status: "failed", error: message } : item));
      setError(message);
      setPending(false);
      return;
    }
    completeIdempotentCommand(commandScope);
    const staged = selected.map((item, index) => {
      const result = body.items?.find((candidate) => candidate.index === index);
      if (!result?.staging || result.error) {
        return { ...item, status: "failed" as const, error: result?.error ?? "上传失败" };
      }
      if (result.staging.duplicates.length) {
        return {
          ...item,
          status: "duplicate" as const,
          staging: result.staging,
          decision: "reuse" as const,
          reuseResourceId: result.staging.duplicates[0]?.resourceId,
        };
      }
      return { ...item, staging: result.staging, decision: "copy" as const };
    });
    const prepared = staged.map((item) => item.status === "duplicate"
      ? item
      : { ...item, status: "duplicate" as const, submittedSnapshot: buildResolutionRequest(item) });
    setUploads((current) => current.map((item) => prepared.find((next) => next.key === item.key) ?? item));
    const autoTargets = prepared.filter((item, index) => staged[index]?.status !== "duplicate");
    const settled = await Promise.all(autoTargets.map((item) => resolveItem(
      item,
      item.submittedSnapshot ?? buildResolutionRequest(item),
    )));
    const firstConflict = settled.find((entry) => entry.conflict)?.conflict;
    if (firstConflict) openResolutionConflict(firstConflict);
    const resolvedByKey = new Map(settled.map((entry) => [entry.item.key, entry.item]));
    const preparedByKey = new Map(prepared.map((item) => [item.key, item]));
    const results = uploads.map((item) => resolvedByKey.get(item.key) ?? preparedByKey.get(item.key) ?? item);
    setUploads(results);
    setPending(false);
    if (results.some((item) => item.status === "done")) router.refresh();
    if (results.some((item) => item.status === "duplicate")) setDuplicateDrawerOpen(true);
  }

  async function resolveItem(
    item: UploadItem,
    submitted: UploadResolutionRequest,
  ): Promise<{ item: UploadItem; conflict?: UploadResolutionConflict }> {
    if (!item.staging || !item.decision) {
      return { item: { ...item, status: "failed", error: "缺少重复处理决策" } };
    }
    let response: Response;
    try {
      response = await fetch("/api/study-resources/uploads/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted),
      });
    } catch {
      return {
        item: {
          ...item,
          status: "duplicate",
          submittedSnapshot: submitted,
          error: "处理结果未知，提交快照已保留；请显式重试",
        },
      };
    }
    const body = await response.json().catch(() => null) as {
      resource?: StudyResourceDto;
      skipped?: boolean;
      error?: string;
      latest?: unknown;
      conflictFields?: string[];
      workbench?: string;
    } | null;
    if (response.status === 401) {
      redirectToLoginWithCurrentLocation();
      return {
        item: {
          ...item,
          status: "duplicate",
          submittedSnapshot: submitted,
          error: "登录已过期，重复处理决策与提交快照已保留",
        },
      };
    }
    if (response.status === 409 && isUploadResolutionLatest(body?.latest)) {
      return {
        item: { ...item, status: "duplicate", submittedSnapshot: submitted, error: "服务端已有不同终态，请先处理冲突" },
        conflict: {
          itemKey: item.key,
          submitted,
          latest: body.latest,
          conflictFields: body?.conflictFields ?? ["decision"],
          workbench: safeResourceWorkbench(body?.workbench),
        },
      };
    }
    if (response.status === 404) {
      router.replace(safeResourceWorkbench(body?.workbench));
      return {
        item: {
          ...item,
          status: "duplicate",
          submittedSnapshot: submitted,
          error: "上传对象已不可用，草稿已保留；请从资料工作台重新核对",
        },
      };
    }
    if (!response.ok || (!body?.resource && !body?.skipped)) {
      return {
        item: {
          ...item,
          status: "duplicate",
          submittedSnapshot: submitted,
          error: body?.error ?? "处理失败",
        },
      };
    }
    return {
      item: {
        ...item,
        status: "done",
        submittedSnapshot: undefined,
        error: undefined,
        resultTitle: body.skipped ? "已跳过" : body.resource?.title,
      },
    };
  }

  async function resolveDuplicates() {
    const targets = uploads.filter((item) => item.status === "duplicate");
    if (!targets.length || pending) return;
    setPending(true);
    const prepared = targets.map((item) => ({ ...item, submittedSnapshot: buildResolutionRequest(item) }));
    setUploads((current) => current.map((item) => prepared.find((next) => next.key === item.key) ?? item));
    const settled = await Promise.all(prepared.map((item) => resolveItem(item, item.submittedSnapshot)));
    const firstConflict = settled.find((entry) => entry.conflict)?.conflict;
    if (firstConflict) openResolutionConflict(firstConflict);
    const resolved = settled.map((entry) => entry.item);
    setUploads((current) => current.map((item) => resolved.find((next) => next.key === item.key) ?? item));
    setPending(false);
    if (resolved.every((item) => item.status !== "duplicate")) setRecoveredPending(false);
    if (resolved.some((item) => item.status === "done")) router.refresh();
    if (resolved.every((item) => item.status !== "duplicate")) setDuplicateDrawerOpen(false);
  }

  function buildResolutionRequest(item: UploadItem): UploadResolutionRequest {
    if (!item.staging || !item.decision) throw new Error("Upload decision is incomplete");
    return {
      attachmentId: item.staging.attachment.id,
      decision: item.decision,
      reuseResourceId: item.decision === "reuse" ? item.reuseResourceId : undefined,
      title: item.originalName,
      subjectId: subjectId || null,
      category,
      tags: splitTags(tags),
    };
  }

  function openResolutionConflict(conflict: UploadResolutionConflict) {
    setResolutionConflict(conflict);
    setDuplicateDrawerOpen(false);
    setConflictOpen(true);
  }

  function adoptResolvedUpload() {
    if (!resolutionConflict) return;
    const resultTitle = resolutionConflict.latest.decision === "skip"
      ? "已跳过"
      : resolutionConflict.latest.resource?.title ?? "已按服务端终态完成";
    setUploads((current) => current.map((item) => item.key === resolutionConflict.itemKey
      ? { ...item, status: "done", submittedSnapshot: undefined, error: undefined, resultTitle }
      : item));
    setConflictOpen(false);
    setResolutionConflict(null);
    router.refresh();
  }

  function mergeResolvedUploadBaseline() {
    if (!resolutionConflict) return;
    const serverRequest = resolutionConflict.latest.request;
    setUploads((current) => current.map((item) => item.key === resolutionConflict.itemKey
      ? {
          ...item,
          decision: resolutionConflict.latest.decision,
          reuseResourceId: resolutionConflict.latest.resourceId ?? undefined,
          submittedSnapshot: undefined,
          error: "已对齐服务端终态基线；请检查后再次点击应用全部决策。",
        }
      : item));
    if (serverRequest) {
      setSubjectId(serverRequest.subjectId ?? "");
      setCategory(serverRequest.category);
      setTags(serverRequest.tags.join("，"));
    }
    setConflictOpen(false);
    setResolutionConflict(null);
    setDuplicateDrawerOpen(true);
  }

  async function createLink() {
    if (pending || !linkTitle.trim() || !linkUrl.trim()) return;
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/study-resources/links", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: linkTitle, url: linkUrl, subjectId: subjectId || null, category, tags: splitTags(tags) }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "外链资料创建失败，草稿已保留");
        return;
      }
      setLinkTitle(""); setLinkUrl(""); setTags("");
      removePrivateBusinessDraft(formDraftKey);
      router.refresh();
    } catch {
      setError("网络不可用，外链资料草稿已保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  const conflictItem = resolutionConflict
    ? uploads.find((item) => item.key === resolutionConflict.itemKey)
    : undefined;
  const localConflictRequest = conflictItem?.staging && conflictItem.decision
    ? buildResolutionRequest(conflictItem)
    : resolutionConflict?.submitted;

  return (
    <div className="space-y-7">
      <header><h1 className="text-2xl font-semibold text-white">资料</h1></header>
      <section className="space-y-4 border-b border-white/10 pb-7">
        <div className="inline-flex rounded-md border border-white/10 p-1" role="group" aria-label="资料创建方式">
          <button ref={createModeRef} type="button" aria-pressed={mode === "files"} onClick={() => setMode("files")} className={`h-8 rounded px-3 text-sm ${mode === "files" ? "bg-white/10 text-white" : "text-zinc-400"}`}>文件批次</button>
          <button type="button" aria-pressed={mode === "link"} onClick={() => setMode("link")} className={`h-8 rounded px-3 text-sm ${mode === "link" ? "bg-white/10 text-white" : "text-zinc-400"}`}>HTTPS 外链</button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select aria-label="资料科目" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); updateKnowledgeContext({ subjectId: event.target.value || null, syllabusNodeId: null }); }}><option value="">暂不选择科目</option>{props.options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select>
          <select aria-label="资料类型" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input aria-label="资料标签" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="标签，逗号分隔" />
        </div>
        {mode === "files" ? (
          <div className="space-y-3">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-sm"><FileUp size={16} aria-hidden />选择 1-5 个文件<input className="sr-only" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.md,application/pdf,image/png,image/jpeg,image/webp,application/zip,text/markdown" onChange={(event) => selectFiles(event.target.files)} /></label>
            {uploads.length ? <ul className="space-y-2">{uploads.map((item) => <UploadResult key={item.key} item={item} />)}</ul> : null}
            {uploads.some((item) => item.status === "ready") ? <button type="button" disabled={pending} onClick={() => void uploadBatch()} className="h-11 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-50">上传并逐项检查</button> : null}
            {uploads.some((item) => item.status === "duplicate") ? <button type="button" disabled={pending} onClick={() => setDuplicateDrawerOpen(true)} className="h-10 rounded-md border border-amber-400/40 px-3 text-sm text-amber-200 disabled:opacity-50">处理重复项</button> : null}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <input aria-label="外链资料标题" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} placeholder="资料标题" />
            <input aria-label="HTTPS 地址" className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://" />
            <button type="button" disabled={pending || !linkTitle.trim() || !linkUrl.trim()} onClick={() => void createLink()} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-50"><Link2 size={16} aria-hidden />创建</button>
          </div>
        )}
        {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
        {recoveredPending ? <p role="status" className="text-sm text-amber-200">已恢复上次未完成的重复处理，请在本页确认复用、副本或跳过；不会自动重新上传文件。</p> : null}
      </section>
      <ResourceList title="当前资料" resources={props.resources} />
      {props.archivedResources.length ? <details className="border-t border-white/10 pt-5"><summary className="cursor-pointer text-sm text-zinc-300">已归档资料（{props.archivedResources.length}）</summary><ResourceList title="已归档" resources={props.archivedResources} /></details> : null}
      <Drawer open={duplicateDrawerOpen} title="处理重复资料" onClose={() => setDuplicateDrawerOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">同一批次的重复项在这里一次处理；跳过会清理本次上传的临时文件。</p>
          <ul className="space-y-3">
            {uploads.filter((item) => item.status === "duplicate").map((item) => (
              <li key={item.key} className="space-y-2 rounded-md border border-white/10 p-3">
                <p className="truncate text-sm text-zinc-100">{item.originalName}</p>
                <select
                  aria-label={`${item.originalName}重复处理`}
                  className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm"
                  value={item.decision}
                  onChange={(event) => setUploads((current) => current.map((row) => row.key === item.key ? { ...row, decision: event.target.value as UploadItem["decision"], submittedSnapshot: undefined } : row))}
                >
                  <option value="reuse">复用已有资料</option>
                  <option value="copy">上传为副本</option>
                  <option value="skip">跳过</option>
                </select>
                {item.decision === "reuse" ? (
                  <select
                    aria-label={`${item.originalName}复用目标`}
                    className="h-9 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-sm"
                    value={item.reuseResourceId}
                    onChange={(event) => setUploads((current) => current.map((row) => row.key === item.key ? { ...row, reuseResourceId: event.target.value, submittedSnapshot: undefined } : row))}
                  >
                    {item.staging?.duplicates.map((row) => <option key={row.resourceId} value={row.resourceId}>{row.title}</option>)}
                  </select>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" disabled={pending || !uploads.some((item) => item.status === "duplicate")} onClick={() => void resolveDuplicates()} className="h-10 w-full rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-50">应用全部决策</button>
        </div>
      </Drawer>
      <ConflictResolutionModal
        open={conflictOpen && Boolean(resolutionConflict)}
        title="处理资料上传终态冲突"
        description="该上传已由另一页面或先前请求完成。当前决策与首次提交快照仍保留，系统不会自动重放或覆盖。"
        conflictFields={resolutionConflict?.conflictFields ?? []}
        comparisons={resolutionConflict && localConflictRequest
          ? uploadResolutionComparisons(resolutionConflict, localConflictRequest)
          : []}
        onClose={() => setConflictOpen(false)}
        onAdoptServer={adoptResolvedUpload}
        onManualMerge={mergeResolvedUploadBaseline}
        adoptLabel="接受服务端已完成终态"
        mergeLabel="以服务端终态为基线再检查"
      />
    </div>
  );
}

function UploadResult(props: { item: UploadItem }) {
  const { item } = props;
  return <li className="rounded-md border border-white/10 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="truncate text-zinc-200">{item.originalName}</span><span className={item.status === "failed" ? "text-rose-300" : item.status === "done" ? "text-emerald-300" : item.status === "duplicate" ? "text-amber-200" : "text-zinc-500"}>{statusLabel(item)}</span></div>{item.status === "duplicate" ? <p className="mt-2 text-xs text-amber-200">待在右侧面板决定复用、副本或跳过</p> : null}{item.error ? <p className="mt-2 text-xs text-rose-300">{item.error}</p> : null}</li>;
}

function ResourceList({ title, resources }: { title: string; resources: StudyResourceDto[] }) {
  return <section className="space-y-3"><h2 className="text-lg font-medium text-white">{title}</h2><ul className="divide-y divide-white/10 rounded-md border border-white/10">{resources.length ? resources.map((resource) => <li key={resource.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="text-zinc-100">{resource.title}</p><p className="text-xs text-zinc-500">{resource.sourceType} · {resource.organizeStatus}{resource.displayHost ? ` · ${resource.displayHost}` : ""}</p></div><ListDetailLink className="text-teal-300 hover:underline" href={`/knowledge/resources/${resource.id}`} focusId={`resource-${resource.id}`}>打开</ListDetailLink></li>) : <li className="px-4 py-8 text-sm text-zinc-500">暂无资料。</li>}</ul></section>;
}

function statusLabel(item: UploadItem) { if (item.status === "ready") return "待上传"; if (item.status === "staging") return "检查中"; if (item.status === "duplicate") return "待重复决策"; if (item.status === "failed") return "失败"; return item.resultTitle ?? "完成"; }
function splitTags(value: string) { return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 20); }

function loadPendingUploads(key: string): UploadItem[] {
  if (typeof window === "undefined") return [];
  const raw = loadPrivateBusinessDraft(key, LONG_PRIVATE_DRAFT_TTL_MS, isPendingUploadDraftArray);
  if (!raw) return [];
  return raw.slice(0, 5).flatMap((value): UploadItem[] => {
      if (!isPendingUploadDraft(value)) return [];
      return [{
        key: value.key,
        file: createRecoveryFile(value.fileName),
        originalName: value.fileName,
        status: "duplicate",
        staging: value.staging,
        decision: value.decision,
        reuseResourceId: value.reuseResourceId,
        submittedSnapshot: value.submittedSnapshot,
      }];
    });
}

function restoreServerPendingUpload(staging: StagingUploadResult): UploadItem {
  const originalName = staging.attachment.originalName || "attachment";
  return {
    key: `attachment-${staging.attachment.id}`,
    file: createRecoveryFile(originalName),
    originalName,
    status: "duplicate",
    staging,
    decision: staging.duplicates.length ? "reuse" : "copy",
    reuseResourceId: staging.duplicates[0]?.resourceId,
  };
}

function mergePendingUploads(current: UploadItem[], restored: UploadItem[]): UploadItem[] {
  const merged = [...current];
  for (const item of restored) {
    const attachmentId = item.staging?.attachment.id;
    if (!attachmentId || merged.some((row) => row.staging?.attachment.id === attachmentId)) continue;
    merged.push(item);
  }
  return merged.slice(0, 5);
}

function createRecoveryFile(name: string): File {
  if (typeof File !== "undefined") return new File([], name);
  return { name } as File;
}

function isPendingUploadDraft(value: unknown): value is PendingUploadDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingUploadDraft>;
  const staging = candidate.staging;
  return typeof candidate.key === "string" && typeof candidate.fileName === "string" &&
    (candidate.decision === "reuse" || candidate.decision === "copy" || candidate.decision === "skip") &&
    (candidate.submittedSnapshot === undefined || isUploadResolutionRequest(candidate.submittedSnapshot)) &&
    Boolean(staging && typeof staging === "object" && staging.attachment && typeof staging.attachment.id === "string" && Array.isArray(staging.duplicates));
}

function isPendingUploadDraftArray(value: unknown): value is PendingUploadDraft[] {
  return Array.isArray(value) && value.every(isPendingUploadDraft);
}

function isResourceFormDraft(value: unknown): value is ResourceFormDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<ResourceFormDraft>;
  return (draft.mode === "files" || draft.mode === "link")
    && [draft.subjectId, draft.category, draft.tags, draft.linkTitle, draft.linkUrl]
      .every((field) => typeof field === "string");
}

function isUploadResolutionRequest(value: unknown): value is UploadResolutionRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UploadResolutionRequest>;
  return typeof candidate.attachmentId === "string" &&
    (candidate.decision === "reuse" || candidate.decision === "copy" || candidate.decision === "skip") &&
    (candidate.reuseResourceId === undefined || typeof candidate.reuseResourceId === "string") &&
    typeof candidate.title === "string" &&
    (candidate.subjectId === null || typeof candidate.subjectId === "string") &&
    typeof candidate.category === "string" &&
    Array.isArray(candidate.tags) && candidate.tags.every((tag) => typeof tag === "string");
}

function isUploadResolutionLatest(value: unknown): value is UploadResolutionLatest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UploadResolutionLatest>;
  return typeof candidate.attachmentId === "string" &&
    (candidate.decision === "reuse" || candidate.decision === "copy" || candidate.decision === "skip") &&
    (candidate.resourceId === null || typeof candidate.resourceId === "string") &&
    (candidate.resource === null || isStudyResourceDto(candidate.resource)) &&
    (candidate.request === null || isUploadResolutionRequest(candidate.request));
}

function isStudyResourceDto(value: unknown): value is StudyResourceDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudyResourceDto>;
  return typeof candidate.id === "string" && typeof candidate.revision === "number" && typeof candidate.title === "string";
}

function safeResourceWorkbench(value: unknown): string {
  return value === "/knowledge/resources" ? value : "/knowledge/resources";
}

function uploadResolutionComparisons(
  conflict: UploadResolutionConflict,
  local: UploadResolutionRequest,
): ConflictComparison[] {
  const server = conflict.latest.request;
  return [
    { field: "decision", label: "处理决策", baseline: conflict.submitted.decision, local: local.decision, server: server?.decision ?? conflict.latest.decision },
    { field: "reuseResourceId", label: "复用目标", baseline: conflict.submitted.reuseResourceId, local: local.reuseResourceId, server: server?.reuseResourceId ?? conflict.latest.resourceId },
    { field: "title", label: "资料标题", baseline: conflict.submitted.title, local: local.title, server: server?.title },
    { field: "subjectId", label: "科目", baseline: conflict.submitted.subjectId, local: local.subjectId, server: server?.subjectId },
    { field: "category", label: "资料类型", baseline: conflict.submitted.category, local: local.category, server: server?.category },
    { field: "tags", label: "标签", baseline: conflict.submitted.tags, local: local.tags, server: server?.tags },
  ];
}
