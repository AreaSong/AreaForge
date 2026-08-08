"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { useRestoreListReturn } from "@/components/list-return-context";
import { StudyResourceCreateDrawer } from "@/components/study-resource-create-drawer";
import { StudyResourceList } from "@/components/study-resource-list";
import {
  isResourceFormDraft,
  isUploadResolutionLatest,
  loadPendingUploads,
  mergePendingUploads,
  restoreServerPendingUpload,
  safeResourceWorkbench,
  splitTags,
  uploadResolutionComparisons,
  type BatchStagingResponseItem,
  type PendingUploadDraft,
  type ResourceFormDraft,
  type UploadItem,
  type UploadResolutionConflict,
  type UploadResolutionRequest,
} from "@/components/study-resource-workbench-support";
import { Button } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { Drawer } from "@/components/ui/overlays";
import { PageFrame, PageHeader, Toolbar } from "@/components/ui/page";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { updateKnowledgeContext } from "@/lib/client/knowledge-context";
import { withReturnTo } from "@/lib/navigation/batch7";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { StudyResourceDto, StudyResourceEditorOptionsDto, StagingUploadResult } from "@/lib/study/study-resource-service";

export function StudyResourceWorkbench(props: {
  userId: string;
  resources: StudyResourceDto[];
  archivedResources: StudyResourceDto[];
  options: StudyResourceEditorOptionsDto;
  initialSubjectId?: string;
  initialCreate?: boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
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
  const [createOpen, setCreateOpen] = useState(Boolean(props.initialCreate));

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
        setCreateOpen(true);
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
    if (results.some((item) => item.status === "duplicate")) {
      setCreateOpen(false);
      setDuplicateDrawerOpen(true);
    }
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
    setCreateOpen(false);
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
      const body = await response.json().catch(() => null) as { resource?: StudyResourceDto; error?: string } | null;
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        setError(body?.error ?? "外链资料创建失败，草稿已保留");
        return;
      }
      if (!body?.resource?.id) {
        setError("服务端未返回已创建资料，当前草稿已保留，请刷新后确认状态。");
        return;
      }
      setLinkTitle(""); setLinkUrl(""); setTags("");
      removePrivateBusinessDraft(formDraftKey);
      setCreateOpen(false);
      const listQuery = new URLSearchParams();
      if (props.initialSubjectId) listQuery.set("subjectId", props.initialSubjectId);
      if (props.initialQuery) listQuery.set("q", props.initialQuery);
      const listHref = `/knowledge/resources${listQuery.size ? `?${listQuery}` : ""}`;
      router.push(withReturnTo(`/knowledge/resources/${body.resource.id}`, listHref));
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
  const unresolvedUploads = uploads.filter((item) => item.status !== "done");

  function updateSubjectFilter(value: string) {
    const query = new URLSearchParams();
    if (value) query.set("subjectId", value);
    if (props.initialQuery) query.set("q", props.initialQuery);
    updateKnowledgeContext({ subjectId: value || null, syllabusNodeId: null });
    router.push(`/knowledge/resources${query.size ? `?${query.toString()}` : ""}`);
  }

  function clearSubjectFilter() {
    updateKnowledgeContext({ subjectId: null, syllabusNodeId: null });
    const query = new URLSearchParams();
    if (props.initialQuery) query.set("q", props.initialQuery);
    router.push(`/knowledge/resources${query.size ? `?${query}` : ""}`);
  }

  function continuePendingUpload() {
    if (uploads.some((item) => item.status === "duplicate")) {
      setCreateOpen(false);
      setDuplicateDrawerOpen(true);
      return;
    }
    setCreateOpen(true);
  }

  return (
    <PageFrame variant="dashboard-wide" className="space-y-5">
      <PageHeader
        title="资料"
        eyebrow="知识工作台"
        description={`${props.resources.length} 份当前资料${props.archivedResources.length ? ` · ${props.archivedResources.length} 份已归档` : ""}`}
      />
      {unresolvedUploads.length ? (
        <Alert
          tone="warning"
          title={recoveredPending ? "已恢复未完成的资料处理" : "有未完成的资料处理"}
          action={<Button type="button" size="sm" onClick={continuePendingUpload}>继续处理</Button>}
        >
          {uploads.some((item) => item.status === "duplicate") ? "需要确认复用、保留副本或跳过。" : `${unresolvedUploads.length} 个文件仍待完成。`}
        </Alert>
      ) : null}
      <Toolbar label="资料筛选">
        <label className="flex min-w-0 items-center gap-2 text-sm text-zinc-400">
          <span className="shrink-0">科目</span>
          <select aria-label="筛选资料科目" className="h-10 min-w-0 rounded-md border border-white/10 bg-[#151a20] px-3 text-sm text-zinc-200" value={props.initialSubjectId ?? ""} onChange={(event) => updateSubjectFilter(event.target.value)}>
            <option value="">全部科目</option>
            {props.options.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
        </label>
        {props.initialQuery ? <Badge tone="info">搜索：{props.initialQuery}</Badge> : null}
        {props.initialSubjectId ? <Button type="button" size="sm" variant="ghost" onClick={clearSubjectFilter}>清除筛选</Button> : null}
      </Toolbar>
      <StudyResourceList
        title="当前资料"
        resources={props.resources}
        subjects={props.options.subjects}
      />
      {props.archivedResources.length ? <details className="border-t border-white/10 pt-5"><summary className="cursor-pointer text-sm text-zinc-300">已归档资料（{props.archivedResources.length}）</summary><div className="mt-4"><StudyResourceList title="已归档" resources={props.archivedResources} subjects={props.options.subjects} /></div></details> : null}
      <StudyResourceCreateDrawer
        open={createOpen}
        mode={mode}
        subjects={props.options.subjects}
        subjectId={subjectId}
        category={category}
        tags={tags}
        linkTitle={linkTitle}
        linkUrl={linkUrl}
        uploads={uploads}
        pending={pending}
        error={error}
        onClose={() => setCreateOpen(false)}
        onModeChange={setMode}
        onSubjectChange={(value) => { setSubjectId(value); updateKnowledgeContext({ subjectId: value || null, syllabusNodeId: null }); }}
        onCategoryChange={setCategory}
        onTagsChange={setTags}
        onLinkTitleChange={setLinkTitle}
        onLinkUrlChange={setLinkUrl}
        onSelectFiles={selectFiles}
        onUpload={() => void uploadBatch()}
        onOpenDuplicates={() => { setCreateOpen(false); setDuplicateDrawerOpen(true); }}
        onCreateLink={() => void createLink()}
      />
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
    </PageFrame>
  );
}
