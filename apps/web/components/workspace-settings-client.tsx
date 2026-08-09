"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert, Badge } from "@/components/ui/feedback";
import { PageHeader, SectionHeader } from "@/components/ui/page";
import { WorkspaceSubjectManager } from "@/components/workspace-subject-manager";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type {
  ExamWorkspaceDto,
  SubjectGroupDto,
  TakeoverPreviewDto,
  WorkspaceSubjectDto,
} from "@/lib/study/exam-workspace-service";
import {
  buildFirstUseSubjects,
  canUseTakeoverPreview,
  workspaceSetupErrorMessage,
} from "@/lib/study/workspace-first-use";

export function WorkspaceSettingsClient(props: {
  userId: string;
  workspaces: ExamWorkspaceDto[];
  activeId: string | null;
  subjects: WorkspaceSubjectDto[];
  groups: SubjectGroupDto[];
  takeover: TakeoverPreviewDto | null;
  setupMode: boolean;
}) {
  const router = useRouter();
  const { withActivityBarrier } = useQuickReviewActivityGuard();
  const setupDraftKey = `areaforge.workspace-setup.draft.${props.userId}`;
  const activeWorkspace = props.workspaces.find((workspace) => workspace.id === props.activeId) ?? null;
  const workspaceEditDraftKey = activeWorkspace
    ? `areaforge.workspace-edit.draft.${props.userId}.${activeWorkspace.id}`
    : null;
  const savedWorkspaceBaseline = useRef<WorkspaceEditDraft | null>(
    activeWorkspace ? toWorkspaceEditDraft(activeWorkspace) : null,
  );
  const [step, setStep] = useState<"goal" | "takeover">(props.setupMode ? "goal" : "goal");
  const [name, setName] = useState("考研工作区");
  const [stableKey, setStableKey] = useState("ws-primary");
  const [targetExamDate, setTargetExamDate] = useState("");
  const [subjectName, setSubjectName] = useState("高等数学");
  const [subjectKey, setSubjectKey] = useState("advanced-math");
  const [include408, setInclude408] = useState(true);
  const [editName, setEditName] = useState(activeWorkspace?.name ?? "");
  const [editTargetDate, setEditTargetDate] = useState(activeWorkspace?.targetExamDate?.slice(0, 10) ?? "");
  const [editStageSummary, setEditStageSummary] = useState(activeWorkspace?.stageSummary ?? "");
  const [workspaceDraftBaseRevision, setWorkspaceDraftBaseRevision] = useState(activeWorkspace?.revision ?? 1);
  const [workspaceDraftSourceKey, setWorkspaceDraftSourceKey] = useState<string | null>(null);
  const [workspaceConflict, setWorkspaceConflict] = useState<WorkspaceConflict | null>(null);
  const [workspaceMergeNotice, setWorkspaceMergeNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupDraftReady, setSetupDraftReady] = useState(false);

  useEffect(() => {
    if (!props.setupMode) return;
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(setupDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isWorkspaceSetupDraft);
      if (draft) {
        setStep(draft.step);
        setName(draft.name);
        setStableKey(draft.stableKey);
        setTargetExamDate(draft.targetExamDate);
        setSubjectName(draft.subjectName);
        setSubjectKey(draft.subjectKey);
        setInclude408(draft.include408);
      }
      setSetupDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [props.setupMode, setupDraftKey]);

  useEffect(() => {
    if (!props.setupMode || !setupDraftReady) return;
    savePrivateBusinessDraft<WorkspaceSetupDraft>(setupDraftKey, {
      step,
      name,
      stableKey,
      targetExamDate,
      subjectName,
      subjectKey,
      include408,
    });
  }, [include408, name, props.setupMode, setupDraftKey, setupDraftReady, stableKey, step, subjectKey, subjectName, targetExamDate]);

  useEffect(() => {
    if (!activeWorkspace || !workspaceEditDraftKey || props.setupMode) {
      return;
    }
    const timer = window.setTimeout(() => {
      const baseline = toWorkspaceEditDraft(activeWorkspace);
      const draft = loadPrivateBusinessDraft(workspaceEditDraftKey, LONG_PRIVATE_DRAFT_TTL_MS, isWorkspaceEditDraft);
      const restored = draft ?? baseline;
      savedWorkspaceBaseline.current = baseline;
      setEditName(restored.name);
      setEditTargetDate(restored.targetExamDate);
      setEditStageSummary(restored.stageSummary);
      setWorkspaceDraftBaseRevision(restored.baseRevision);
      if (draft && draft.baseRevision !== activeWorkspace.revision) {
        setWorkspaceConflict({ latest: activeWorkspace, conflictFields: ["revision"] });
        setError("工作区已在其他页面更新；本地草稿仍保留，请比较后选择如何合并。");
      } else {
        setWorkspaceConflict(null);
        setError(null);
      }
      setWorkspaceDraftSourceKey(workspaceEditDraftKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeWorkspace, props.setupMode, workspaceEditDraftKey]);

  useEffect(() => {
    if (!activeWorkspace || !workspaceEditDraftKey || workspaceDraftSourceKey !== workspaceEditDraftKey) return;
    const draft: WorkspaceEditDraft = {
      name: editName,
      targetExamDate: editTargetDate,
      stageSummary: editStageSummary,
      baseRevision: workspaceDraftBaseRevision,
    };
    if (savedWorkspaceBaseline.current && workspaceEditDraftsEqual(draft, savedWorkspaceBaseline.current)) {
      removePrivateBusinessDraft(workspaceEditDraftKey);
      return;
    }
    savePrivateBusinessDraft(workspaceEditDraftKey, draft);
  }, [
    activeWorkspace,
    editName,
    editStageSummary,
    editTargetDate,
    workspaceDraftBaseRevision,
    workspaceDraftSourceKey,
    workspaceEditDraftKey,
  ]);

  async function completeFirstUseSetup(takeover: boolean) {
    if (pending) return;
    if (takeover && !canUseTakeoverPreview(props.takeover)) {
      setError("旧数据预览暂时不可用，尚未创建工作区。请刷新后重试，或明确选择不沿用旧数据。");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const subjects = buildFirstUseSubjects({
        subjectKey,
        subjectName,
        include408,
        takeoverSubjects: takeover ? props.takeover?.eligibleSubjects ?? [] : [],
      });
      const createResponse = await fetch("/api/exam-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stableKey,
          name,
          targetExamDate: targetExamDate ? new Date(`${targetExamDate}T00:00:00+08:00`).toISOString() : null,
          activate: true,
          subjects: subjects.length > 0 ? subjects : undefined,
          takeoverSubjectIds: takeover ? props.takeover?.eligibleSubjectIds ?? [] : [],
        }),
      });
      const createBody = (await createResponse.json().catch(() => null)) as
        | { workspace?: ExamWorkspaceDto; error?: string }
        | null;
      if (createResponse.status === 401) {
        setError("登录已过期，首次设置草稿已保留。重新登录后请显式重试。");
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!createResponse.ok || !createBody?.workspace) {
        setError(workspaceSetupErrorMessage(createBody?.error));
        return;
      }
      removePrivateBusinessDraft(setupDraftKey);
      router.replace("/today");
      router.refresh();
    } catch {
      setError("网络不可用，设置尚未保存，请恢复网络后重试");
    } finally {
      setPending(false);
    }
  }

  async function saveWorkspace() {
    if (!activeWorkspace || pending) return;
    setPending(true); setError(null); setWorkspaceMergeNotice(null);
    try {
      const response = await fetch(`/api/exam-workspaces/${activeWorkspace.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: workspaceDraftBaseRevision,
          name: editName,
          targetExamDate: editTargetDate ? new Date(`${editTargetDate}T00:00:00+08:00`).toISOString() : null,
          stageSummary: editStageSummary || null,
        }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      const body = await response.json().catch(() => null) as WorkspaceUpdateResponse | null;
      if (!response.ok) {
        if (response.status === 409 && isExamWorkspaceDto(body?.latest)) {
          setWorkspaceConflict({ latest: body.latest, conflictFields: body.conflictFields ?? ["revision"] });
          setError("工作区已在其他页面更新；本地草稿仍保留，请比较后选择如何合并。");
        } else {
          setError(body?.error ?? "工作区保存失败，本地输入仍保留");
        }
        return;
      }
      const saved = isExamWorkspaceDto(body?.workspace) ? body.workspace : null;
      const baseline: WorkspaceEditDraft = {
        name: editName,
        targetExamDate: editTargetDate,
        stageSummary: editStageSummary,
        baseRevision: saved?.revision ?? workspaceDraftBaseRevision + 1,
      };
      savedWorkspaceBaseline.current = baseline;
      setWorkspaceDraftBaseRevision(baseline.baseRevision);
      setWorkspaceConflict(null);
      if (workspaceEditDraftKey) removePrivateBusinessDraft(workspaceEditDraftKey);
      setWorkspaceMergeNotice("工作区目标已保存。");
      router.refresh();
    } catch {
      setError("网络不可用，工作区输入仍保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  function adoptLatestWorkspace() {
    if (!workspaceConflict || !workspaceEditDraftKey) return;
    const latest = workspaceConflict.latest;
    const baseline = toWorkspaceEditDraft(latest);
    setEditName(baseline.name);
    setEditTargetDate(baseline.targetExamDate);
    setEditStageSummary(baseline.stageSummary);
    setWorkspaceDraftBaseRevision(baseline.baseRevision);
    savedWorkspaceBaseline.current = baseline;
    removePrivateBusinessDraft(workspaceEditDraftKey);
    setWorkspaceConflict(null);
    setError(null);
    setWorkspaceMergeNotice(`已采用服务端最新状态 r${latest.revision}。`);
    router.refresh();
  }

  function keepLocalWorkspaceDraft() {
    if (!workspaceConflict) return;
    const revision = workspaceConflict.latest.revision;
    setWorkspaceDraftBaseRevision(revision);
    setWorkspaceConflict(null);
    setError(null);
    setWorkspaceMergeNotice(`本地输入已保留，并改为基于服务端 r${revision}；请检查后再次点击保存。`);
  }

  async function activateWorkspace(workspace: ExamWorkspaceDto) {
    if (pending) return;
    await withActivityBarrier(() => runActivateWorkspace(workspace), { allowDiscard: false });
  }

  async function runActivateWorkspace(workspace: ExamWorkspaceDto) {
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/exam-workspaces/${workspace.id}/activate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: workspace.revision }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "切换工作区失败"); return;
      }
      router.replace("/today"); router.refresh();
    } catch {
      setError("网络不可用，工作区未切换；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow={props.setupMode || !props.activeId ? "首次配置" : "设置"}
        title={props.setupMode || !props.activeId ? "建立考试工作区" : "工作区与科目"}
        description={props.setupMode || !props.activeId ? "确认考试目标和首批科目，再决定是否沿用已有学习数据。" : "管理当前考试目标、科目归属和可切换的工作区。"}
        status={activeWorkspace && !props.setupMode ? <div className="flex flex-wrap gap-2"><Badge tone="success">当前：{activeWorkspace.name}</Badge><Badge>{props.subjects.filter((item) => !item.archivedAt).length} 个科目</Badge></div> : undefined}
      />

      {props.setupMode || !props.activeId ? (
        <>
          <ol className="grid border-y border-white/10 sm:grid-cols-2" aria-label="工作区设置进度">
            <SetupStep number={1} title="考试目标与科目" description="确定工作区和首批科目" active={step === "goal"} complete={step === "takeover"} />
            <SetupStep number={2} title="已有数据处理" description="确认沿用或全新开始" active={step === "takeover"} complete={false} />
          </ol>
          <Alert tone="warning">完成前不会创建工作区，也不会移动任何已有学习数据。</Alert>
        </>
      ) : null}

      {props.setupMode && step === "goal" ? (
        <section className="space-y-4 border-b border-white/10 pb-5">
          <SectionHeader title="考试目标与首批科目" description="这些信息决定后续任务、知识和复盘的数据归属。公共课、408 和专业课都在这里管理。" />
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="text-zinc-400">工作区名称</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">目标考试日</span>
            <input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={targetExamDate} onChange={(e) => setTargetExamDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">首个科目</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />
          </label>
          </div>
          <label className="flex items-start gap-3 border-y border-white/10 px-1 py-3 text-sm text-zinc-300">
            <input type="checkbox" className="mt-1" checked={include408} onChange={(event) => setInclude408(event.target.checked)} />
            <span><span className="block text-white">同时创建 408 四科</span><span className="mt-1 block text-xs text-zinc-500">数据结构、计算机组成原理、操作系统和计算机网络会自动归入 408 分组。</span></span>
          </label>
          <details className="text-sm text-zinc-500">
            <summary className="cursor-pointer">高级选项</summary>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label>工作区内部标识<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-zinc-300" value={stableKey} onChange={(event) => setStableKey(event.target.value)} /></label>
              <label>首个科目内部标识<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-zinc-300" value={subjectKey} onChange={(event) => setSubjectKey(event.target.value)} /></label>
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="lg" onClick={() => setStep("takeover")}>下一步：检查已有数据</Button>
            <ButtonLink href="/today" variant="ghost" size="lg">取消</ButtonLink>
          </div>
        </section>
      ) : step === "takeover" ? (
        <section className="space-y-4 border-b border-white/10 pb-5">
          <SectionHeader title="确认已有数据处理方式" description="沿用只会接管预览中允许的科目；归属冲突项不会移动。" />
          {props.takeover ? (
            <div className="space-y-2 border-y border-white/10 py-4 text-sm text-zinc-400">
              <p>可沿用 {props.takeover.eligibleCount} 个已有科目：{props.takeover.eligibleSubjects.map((subject) => subject.name).join("、") || "无"}。</p>
              {props.takeover.unresolvedCount > 0 || props.takeover.crossOwnerBlockedCount > 0 ? (
                <p className="text-amber-200">另有 {props.takeover.unresolvedCount} 个待确认，{props.takeover.crossOwnerBlockedCount} 个因归属冲突被阻止，本次不会移动。</p>
              ) : null}
              <p>选择沿用时，已有数学和 408 科目不会重复创建；其他新科目仍按上一步设置创建。</p>
            </div>
          ) : (
            <p role="alert" className="text-sm text-amber-200">
              旧数据预览暂时不可用。刷新后再沿用，或明确选择新建工作区且不移动旧数据。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="primary" size="lg" loading={pending} loadingLabel="创建中..." disabled={!canUseTakeoverPreview(props.takeover)} onClick={() => void completeFirstUseSetup(true)}>沿用已有数据并完成</Button>
            <Button type="button" variant="secondary" size="lg" disabled={pending} onClick={() => void completeFirstUseSetup(false)}>全新建立，不沿用</Button>
            <Button type="button" variant="ghost" size="lg" disabled={pending} onClick={() => setStep("goal")}>返回修改</Button>
            <ButtonLink href="/today" variant="ghost" size="lg">取消</ButtonLink>
          </div>
        </section>
      ) : null}

      {activeWorkspace && !props.setupMode ? (
        <section className="space-y-4 border-b border-white/10 pb-5">
          <SectionHeader title="当前考试目标" description="调整名称、目标日期和当前阶段摘要。" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-zinc-400">名称<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-white" value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">目标考试日<input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-white" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} /></label>
          </div>
          <label className="block text-sm text-zinc-400">阶段摘要<textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] p-2 text-white" value={editStageSummary} onChange={(event) => setEditStageSummary(event.target.value)} /></label>
          <Button type="button" variant="primary" loading={pending} loadingLabel="保存中..." onClick={() => void saveWorkspace()}>保存考试目标</Button>
          {workspaceConflict ? (
            <div className="space-y-2 border-l-2 border-amber-300 pl-3 text-sm text-amber-100" role="status">
              <p>服务端最新版本为 r{workspaceConflict.latest.revision}；冲突字段：{workspaceConflict.conflictFields.join("、")}。</p>
              <dl className="grid gap-1 text-xs text-zinc-300">
                <div><dt className="inline text-zinc-500">服务端名称：</dt><dd className="inline">{workspaceConflict.latest.name}</dd></div>
                <div><dt className="inline text-zinc-500">服务端目标日：</dt><dd className="inline">{workspaceConflict.latest.targetExamDate?.slice(0, 10) ?? "未设置"}</dd></div>
                <div><dt className="inline text-zinc-500">服务端阶段摘要：</dt><dd className="inline">{workspaceConflict.latest.stageSummary || "未设置"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="h-9 rounded-md border border-white/10 px-3 text-xs" onClick={adoptLatestWorkspace}>采用服务端最新状态</button>
                <button type="button" className="h-9 rounded-md border border-amber-300/50 px-3 text-xs" onClick={keepLocalWorkspaceDraft}>保留本地输入并重新确认</button>
              </div>
            </div>
          ) : null}
          {workspaceMergeNotice ? <p className="text-sm text-teal-200" role="status">{workspaceMergeNotice}</p> : null}
        </section>
      ) : null}

      {activeWorkspace && !props.setupMode ? (
        <div className="space-y-3">
          <div className="rounded-md border border-teal-300/20 bg-teal-300/[0.04] px-3 py-2 text-xs leading-5 text-zinc-400">
            <span className="font-medium text-teal-200">科目管理入口：</span>
            公共课直接添加到当前考试工作区；408 使用预置分组；专业课请新建自定义分组并在其中添加科目。分组和科目均可编辑、排序、归档和恢复。
          </div>
          <WorkspaceSubjectManager workspace={activeWorkspace} subjects={props.subjects} groups={props.groups} />
        </div>
      ) : null}

      <section className="space-y-3 border-t border-white/10 pt-5 text-sm">
        <SectionHeader title="其他工作区" description="切换后会返回今日行动中心；已有活动保护仍然生效。" meta={<Badge>{props.workspaces.length} 个</Badge>} />
        <ul className="mt-2 space-y-1 text-zinc-400">
          {props.workspaces.map((workspace) => (
            <li key={workspace.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-2">
              <span>{workspace.name}{workspace.id === props.activeId ? " · 当前使用" : workspace.status === "ARCHIVED" ? " · 已归档" : ""}</span>
              {workspace.id !== props.activeId ? <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void activateWorkspace(workspace)}>设为当前</Button> : <Badge tone="success">当前使用</Badge>}
            </li>
          ))}
        </ul>
      </section>

      {error ? <Alert tone="danger">{error}</Alert> : null}
    </section>
  );
}

function SetupStep(props: { number: number; title: string; description: string; active: boolean; complete: boolean }) {
  return (
    <li aria-current={props.active ? "step" : undefined} className={`flex min-h-20 items-center gap-3 px-4 py-3 ${props.active ? "bg-white/[0.04]" : ""}`}>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs ${props.complete ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200" : props.active ? "border-teal-400/50 text-teal-200" : "border-white/10 text-zinc-600"}`}>{props.complete ? "✓" : props.number}</span>
      <span><span className={`block text-sm font-medium ${props.active || props.complete ? "text-white" : "text-zinc-500"}`}>{props.title}</span><span className="block text-xs text-zinc-500">{props.description}</span></span>
    </li>
  );
}

interface WorkspaceSetupDraft {
  step: "goal" | "takeover";
  name: string;
  stableKey: string;
  targetExamDate: string;
  subjectName: string;
  subjectKey: string;
  include408: boolean;
}

interface WorkspaceEditDraft {
  name: string;
  targetExamDate: string;
  stageSummary: string;
  baseRevision: number;
}

interface WorkspaceConflict {
  latest: ExamWorkspaceDto;
  conflictFields: string[];
}

interface WorkspaceUpdateResponse {
  workspace?: unknown;
  latest?: unknown;
  conflictFields?: string[];
  error?: string;
}

function isWorkspaceSetupDraft(value: unknown): value is WorkspaceSetupDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<WorkspaceSetupDraft>;
  return (draft.step === "goal" || draft.step === "takeover")
    && typeof draft.name === "string"
    && typeof draft.stableKey === "string"
    && typeof draft.targetExamDate === "string"
    && typeof draft.subjectName === "string"
    && typeof draft.subjectKey === "string"
    && typeof draft.include408 === "boolean";
}

function toWorkspaceEditDraft(workspace: ExamWorkspaceDto): WorkspaceEditDraft {
  return {
    name: workspace.name,
    targetExamDate: workspace.targetExamDate?.slice(0, 10) ?? "",
    stageSummary: workspace.stageSummary ?? "",
    baseRevision: workspace.revision,
  };
}

function workspaceEditDraftsEqual(left: WorkspaceEditDraft, right: WorkspaceEditDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isWorkspaceEditDraft(value: unknown): value is WorkspaceEditDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<WorkspaceEditDraft>;
  return typeof draft.name === "string"
    && typeof draft.targetExamDate === "string"
    && typeof draft.stageSummary === "string"
    && Number.isInteger(draft.baseRevision)
    && (draft.baseRevision ?? 0) > 0;
}

function isExamWorkspaceDto(value: unknown): value is ExamWorkspaceDto {
  if (!value || typeof value !== "object") return false;
  const workspace = value as Partial<ExamWorkspaceDto>;
  return typeof workspace.id === "string"
    && typeof workspace.name === "string"
    && (workspace.targetExamDate === null || typeof workspace.targetExamDate === "string")
    && (workspace.stageSummary === null || typeof workspace.stageSummary === "string")
    && (workspace.status === "ACTIVE" || workspace.status === "ARCHIVED")
    && Number.isInteger(workspace.revision)
    && (workspace.revision ?? 0) > 0;
}
