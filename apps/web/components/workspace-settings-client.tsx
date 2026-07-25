"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ExamWorkspaceDto,
  SubjectGroupDto,
  TakeoverPreviewDto,
  WorkspaceSubjectDto,
} from "@/lib/study/exam-workspace-service";

export function WorkspaceSettingsClient(props: {
  workspaces: ExamWorkspaceDto[];
  activeId: string | null;
  subjects: WorkspaceSubjectDto[];
  groups: SubjectGroupDto[];
  takeover: TakeoverPreviewDto | null;
  setupMode: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<"goal" | "takeover">(props.setupMode ? "goal" : "goal");
  const [name, setName] = useState("考研工作区");
  const [stableKey, setStableKey] = useState("ws-primary");
  const [targetExamDate, setTargetExamDate] = useState("");
  const [subjectName, setSubjectName] = useState("高等数学");
  const [subjectKey, setSubjectKey] = useState("math");
  const [include408, setInclude408] = useState(true);
  const activeWorkspace = props.workspaces.find((workspace) => workspace.id === props.activeId) ?? null;
  const [editName, setEditName] = useState(activeWorkspace?.name ?? "");
  const [editTargetDate, setEditTargetDate] = useState(activeWorkspace?.targetExamDate?.slice(0, 10) ?? "");
  const [editStageSummary, setEditStageSummary] = useState(activeWorkspace?.stageSummary ?? "");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!createResponse.ok || !createBody?.workspace) {
        setError(createBody?.error ?? "创建工作区失败");
        return;
      }
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
    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "添加科目失败");
      return;
    }
    router.refresh();
  }

  async function updateSubject(subject: WorkspaceSubjectDto, patch: Record<string, unknown>) {
    if (!activeWorkspace || pending) return;
    setPending(true); setError(null);
    const response = await fetch(`/api/exam-workspaces/${activeWorkspace.id}/subjects/${subject.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedWorkspaceRevision: activeWorkspace.revision, ...patch }),
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "科目更新失败"); return;
    }
    router.refresh();
  }

  async function saveWorkspace() {
    if (!activeWorkspace || pending) return;
    setPending(true); setError(null);
    const response = await fetch(`/api/exam-workspaces/${activeWorkspace.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: activeWorkspace.revision,
        name: editName,
        targetExamDate: editTargetDate ? new Date(`${editTargetDate}T00:00:00+08:00`).toISOString() : null,
        stageSummary: editStageSummary || null,
      }),
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "工作区保存失败"); return;
    }
    router.refresh();
  }

  async function activateWorkspace(workspace: ExamWorkspaceDto) {
    if (pending) return;
    setPending(true); setError(null);
    const response = await fetch(`/api/exam-workspaces/${workspace.id}/activate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: workspace.revision }),
    });
    setPending(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      setError(body?.error ?? "切换工作区失败"); return;
    }
    router.replace("/today"); router.refresh();
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

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
