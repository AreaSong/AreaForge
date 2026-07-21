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
  const [error, setError] = useState<string | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<ExamWorkspaceDto | null>(null);

  async function createWorkspaceAndSubject() {
    setError(null);
    const createResponse = await fetch("/api/exam-workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stableKey,
        name,
        targetExamDate: targetExamDate ? new Date(`${targetExamDate}T00:00:00+08:00`).toISOString() : null,
        activate: true,
      }),
    });
    const createBody = (await createResponse.json().catch(() => null)) as
      | { workspace?: ExamWorkspaceDto; error?: string }
      | null;
    if (!createResponse.ok || !createBody?.workspace) {
      setError(createBody?.error ?? "创建工作区失败");
      return;
    }

    const subjectResponse = await fetch(`/api/exam-workspaces/${createBody.workspace.id}/subjects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stableKey: subjectKey,
        name: subjectName,
        color: "#35d7c5",
        sortOrder: 10,
      }),
    });
    if (!subjectResponse.ok) {
      const subjectBody = (await subjectResponse.json().catch(() => null)) as { error?: string } | null;
      setError(subjectBody?.error ?? "创建科目失败（工作区已创建，可继续补科目）");
      setCreatedWorkspace(createBody.workspace);
      setStep("takeover");
      return;
    }

    setCreatedWorkspace(createBody.workspace);
    setStep("takeover");
  }

  async function applyTakeover(take: boolean) {
    setError(null);
    const workspace = createdWorkspace ?? props.workspaces.find((row) => row.id === props.activeId);
    if (!workspace) {
      setError("缺少工作区");
      return;
    }
    if (take && props.takeover && props.takeover.eligibleSubjectIds.length > 0) {
      const response = await fetch("/api/exam-workspaces/takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          subjectIds: props.takeover.eligibleSubjectIds,
          expectedRevision: workspace.revision,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "接管失败");
        return;
      }
    }
    router.replace("/today");
    router.refresh();
  }

  async function addSubject() {
    setError(null);
    if (!props.activeId) return;
    const response = await fetch(`/api/exam-workspaces/${props.activeId}/subjects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stableKey: subjectKey,
        name: subjectName,
        color: "#35d7c5",
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "添加科目失败");
      return;
    }
    router.refresh();
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

      {step === "goal" ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="text-sm font-medium text-white">1. 考试目标与科目</h2>
          <label className="block text-sm">
            <span className="text-zinc-400">工作区名称</span>
            <input className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2" value={name} onChange={(e) => setName(e.target.value)} />
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
            <button type="button" className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => void createWorkspaceAndSubject()}>
              确认并进入旧数据处理
            </button>
            <Link href="/today" className="h-11 rounded-md border border-white/10 px-4 text-sm leading-[2.75rem] text-zinc-300">
              取消
            </Link>
          </div>
        </div>
      ) : (
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
            <button type="button" className="h-11 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black" onClick={() => void applyTakeover(true)}>
              接管到当前工作区
            </button>
            <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-200" onClick={() => void applyTakeover(false)}>
              暂不接管并使用新科目
            </button>
          </div>
        </div>
      )}

      {props.activeId ? (
        <div className="space-y-3 rounded-md border border-white/10 bg-[#101419] p-4">
          <h2 className="text-sm font-medium text-white">当前科目</h2>
          <ul className="space-y-1 text-sm text-zinc-300">
            {props.subjects.map((subject) => (
              <li key={subject.id}>
                {subject.name}
                {subject.groupId ? ` · 分组` : ""}
                {subject.archivedAt ? " · 已归档" : ""}
              </li>
            ))}
          </ul>
          {props.groups.length > 0 ? (
            <p className="text-xs text-zinc-500">分组：{props.groups.map((group) => group.name).join("、")}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} placeholder="科目名" />
            <input className="h-10 rounded-md border border-white/10 bg-[#151a20] px-2 text-sm" value={subjectKey} onChange={(e) => setSubjectKey(e.target.value)} placeholder="stableKey" />
          </div>
          <button type="button" className="h-10 rounded-md border border-white/10 px-3 text-sm text-zinc-200" onClick={() => void addSubject()}>
            添加科目
          </button>
        </div>
      ) : null}

      <div className="rounded-md border border-white/10 p-4 text-sm">
        <h2 className="font-medium text-white">工作区列表</h2>
        <ul className="mt-2 space-y-1 text-zinc-400">
          {props.workspaces.map((workspace) => (
            <li key={workspace.id}>
              {workspace.name} · {workspace.status}
              {workspace.id === props.activeId ? " · 当前" : ""}
            </li>
          ))}
        </ul>
      </div>

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
