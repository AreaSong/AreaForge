"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
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
  const [subjectKey, setSubjectKey] = useState("math");
  const [include408, setInclude408] = useState(true);
  const [editName, setEditName] = useState(activeWorkspace?.name ?? "");
  const [editTargetDate, setEditTargetDate] = useState(activeWorkspace?.targetExamDate?.slice(0, 10) ?? "");
  const [editStageSummary, setEditStageSummary] = useState(activeWorkspace?.stageSummary ?? "");
  const [workspaceDraftBaseRevision, setWorkspaceDraftBaseRevision] = useState(activeWorkspace?.revision ?? 1);
  const [workspaceDraftSourceKey, setWorkspaceDraftSourceKey] = useState<string | null>(null);
  const [workspaceConflict, setWorkspaceConflict] = useState<WorkspaceConflict | null>(null);
  const [workspaceMergeNotice, setWorkspaceMergeNotice] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
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
      setWorkspaceMergeNotice(null);
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
    setPending(true);
    setError(null);
    try {
      const createResponse = await fetch("/api/exam-workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stableKey,
          name,
          targetExamDate: targetExamDate ? new Date(`${targetExamDate}T00:00:00+08:00`).toISOString() : null,
          activate: true,
          subjects: [
            { stableKey: subjectKey, name: subjectName, color: "#35d7c5", sortOrder: 10 },
            ...(include408 ? [
              { stableKey: "408-data-structure", name: "数据结构", color: "#22c55e", sortOrder: 20, groupStableKey: "408" as const },
              { stableKey: "408-computer-organization", name: "计算机组成原理", color: "#f59e0b", sortOrder: 30, groupStableKey: "408" as const },
              { stableKey: "408-operating-system", name: "操作系统", color: "#3b82f6", sortOrder: 40, groupStableKey: "408" as const },
              { stableKey: "408-computer-network", name: "计算机网络", color: "#ef4444", sortOrder: 50, groupStableKey: "408" as const },
            ] : []),
          ],
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
        setError(createBody?.error ?? "创建工作区失败，首次设置草稿已保留");
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

  async function addSubject() {
    setError(null);
    if (!props.activeId || !activeWorkspace) return;
    setPending(true);
    try {
      const response = await fetch(`/api/exam-workspaces/${props.activeId}/subjects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stableKey: subjectKey,
          name: subjectName,
          color: "#35d7c5",
          groupId: selectedGroupId || null,
          expectedWorkspaceRevision: activeWorkspace.revision,
        }),
      });
      if (response.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "添加科目失败，本地输入仍保留");
        return;
      }
      router.refresh();
    } catch {
      setError("网络不可用，本地输入仍保留；恢复网络后请显式重试。");
    } finally {
      setPending(false);
    }
  }

  async function updateSubject(subject: WorkspaceSubjectDto, patch: Record<string, unknown>) {
    if (!activeWorkspace || pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/exam-workspaces/${activeWorkspace.id}/subjects/${subject.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedWorkspaceRevision: activeWorkspace.revision, ...patch }),
      });
      if (response.status === 401) return redirectToLoginWithCurrentLocation();
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "科目更新失败"); return;
      }
      router.refresh();
    } catch {
      setError("网络不可用，科目更新未提交；恢复网络后请显式重试。");
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-white">考试工作区</h1>
        <Link href="/settings" className="text-sm text-zinc-400 hover:text-zinc-200">
          账户与版本中心
        </Link>
      </div>

      {props.setupMode || !props.activeId ? (
        <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          首次设置：先确认考试目标与至少一门科目，再处理旧数据。取消不创建 ACTIVE 工作区。
        </div>
      ) : null}

      {props.setupMode && step === "goal" ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="text-sm font-medium text-white">1. 考试目标与科目</h2>
          <label className="block text-sm">
            <span className="text-zinc-400">工作区名称</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex items-start gap-3 rounded-md border border-white/10 p-3 text-sm text-zinc-300">
            <input type="checkbox" className="mt-1" checked={include408} onChange={(event) => setInclude408(event.target.checked)} />
            <span>同时创建 408 四科并归入 408 分组</span>
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">稳定键</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={stableKey} onChange={(e) => setStableKey(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">目标考试日</span>
            <input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={targetExamDate} onChange={(e) => setTargetExamDate(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">首个科目</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="text-zinc-400">科目稳定键</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => setStep("takeover")}>
              继续预览旧数据
            </button>
            <Link href="/today" className="h-11 rounded-md border border-white/10 px-4 text-sm leading-[2.75rem] text-zinc-300">
              取消
            </Link>
          </div>
        </div>
      ) : step === "takeover" ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="text-sm font-medium text-white">2. 旧数据处理</h2>
          {props.takeover ? (
            <p className="text-sm text-zinc-400">
              可接管 {props.takeover.eligibleCount} 个科目；未解决 {props.takeover.unresolvedCount}；跨所有者阻断{" "}
              {props.takeover.crossOwnerBlockedCount}。
            </p>
          ) : (
            <p className="text-sm text-zinc-400">未检测到可接管旧数据，可直接进入行动中心。</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-60" onClick={() => void completeFirstUseSetup(true)}>
              接管并完成设置
            </button>
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-200" onClick={() => void completeFirstUseSetup(false)}>
              暂不接管并完成设置
            </button>
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-300" onClick={() => setStep("goal")}>返回修改</button>
            <Link href="/today" className="h-11 rounded-md border border-white/10 px-4 text-sm leading-[2.75rem] text-zinc-300">取消</Link>
          </div>
        </div>
      ) : null}

      {activeWorkspace && !props.setupMode ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="text-sm font-medium text-white">当前考试目标</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-zinc-400">名称<input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-white" value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
            <label className="text-sm text-zinc-400">目标考试日<input type="date" className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2 text-white" value={editTargetDate} onChange={(event) => setEditTargetDate(event.target.value)} /></label>
          </div>
          <label className="block text-sm text-zinc-400">阶段摘要<textarea className="mt-1 min-h-20 w-full rounded-md border border-white/10 bg-[#151a20] p-2 text-white" value={editStageSummary} onChange={(event) => setEditStageSummary(event.target.value)} /></label>
          <button type="button" disabled={pending} onClick={() => void saveWorkspace()} className="h-10 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-60">保存工作区</button>
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
        </div>
      ) : null}

      {props.activeId ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="text-sm font-medium text-white">当前科目</h2>
          <ul className="space-y-2 text-sm text-zinc-300">
            {props.subjects.map((subject) => (
              <li key={subject.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/10 p-3">
                <span>{subject.name}{subject.groupId ? ` · ${props.groups.find((group) => group.id === subject.groupId)?.name ?? "分组"}` : ""}{subject.archivedAt ? " · 已归档" : ""}</span>
                <span className="flex gap-1">
                  <button type="button" aria-label={`${subject.name}上移`} disabled={pending} onClick={() => void updateSubject(subject, { sortOrder: subject.sortOrder - 10 })} className="h-8 w-8 rounded-md border border-white/10">↑</button>
                  <button type="button" aria-label={`${subject.name}下移`} disabled={pending} onClick={() => void updateSubject(subject, { sortOrder: subject.sortOrder + 10 })} className="h-8 w-8 rounded-md border border-white/10">↓</button>
                  <button type="button" disabled={pending} onClick={() => void updateSubject(subject, { archived: !subject.archivedAt })} className="h-8 rounded-md border border-white/10 px-2 text-xs">{subject.archivedAt ? "恢复" : "归档"}</button>
                </span>
              </li>
            ))}
          </ul>
          {props.groups.length > 0 ? (
            <p className="text-xs text-zinc-500">分组：{props.groups.map((group) => group.name).join("、")}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <input className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="科目名" />
            <input className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} placeholder="stableKey" />
            <select className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}><option value="">不分组</option>{props.groups.filter((group) => !group.archivedAt).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
          </div>
          <button type="button" disabled={pending} className="h-10 rounded-md border border-white/10 px-3 text-sm text-zinc-200 disabled:opacity-60" onClick={() => void addSubject()}>
            添加科目
          </button>
        </div>
      ) : null}

      <div className="rounded-md border border-white/10 p-4 text-sm">
        <h2 className="font-medium text-white">工作区列表</h2>
        <ul className="mt-2 space-y-1 text-zinc-400">
          {props.workspaces.map((workspace) => (
            <li key={workspace.id} className="flex items-center justify-between gap-3 rounded-md border border-white/10 p-2">
              <span>{workspace.name} · {workspace.status}{workspace.id === props.activeId ? " · 当前" : ""}</span>
              {workspace.id !== props.activeId ? <button type="button" disabled={pending} className="h-8 rounded-md border border-white/10 px-2 text-xs text-teal-300" onClick={() => void activateWorkspace(workspace)}>设为当前</button> : null}
            </li>
          ))}
        </ul>
      </div>

      {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
    </section>
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
