"use client";

import { Pause, Play, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { getTimerElapsedSeconds, type TimerStatus } from "@areaforge/core";
import type { StudySessionDto, StudyTaskDto, SubjectDto, SyllabusOptionNodeDto } from "@/lib/study/types";

interface FocusTimerProps {
  subjects: SubjectDto[];
  tasks: StudyTaskDto[];
  syllabusNodes: SyllabusOptionNodeDto[];
  activeSession: StudySessionDto | null;
  latestCompletedSession: StudySessionDto | null;
}

interface FlatNode {
  id: string;
  subjectId: string;
  title: string;
  depth: number;
}

export function FocusTimer({ subjects, tasks, syllabusNodes, activeSession, latestCompletedSession }: FocusTimerProps) {
  const router = useRouter();
  const [session, setSession] = useState(activeSession);
  const [localCompletedSession, setLocalCompletedSession] = useState<StudySessionDto | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState(tasks.find((task) => task.status !== "done")?.id ?? "");
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id ?? "");
  const [selectedSyllabusNodeId, setSelectedSyllabusNodeId] = useState("");
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [isPending, startTransition] = useTransition();
  const flatNodes = useMemo(() => flattenNodes(syllabusNodes), [syllabusNodes]);

  const timerStatus: TimerStatus = isEnding
    ? "ending"
    : session?.status === "running" || session?.status === "paused"
      ? session.status
      : "idle";

  useEffect(() => {
    if (timerStatus !== "running") return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [timerStatus]);

  const elapsedSeconds = useMemo(() => {
    if (!session) return 0;

    return getTimerElapsedSeconds({
      status: timerStatus,
      startedAt: new Date(session.startedAt),
      pausedAt: session.pausedAt ? new Date(session.pausedAt) : undefined,
      endedAt: session.endedAt ? new Date(session.endedAt) : undefined,
      accumulatedPauseSeconds: session.accumulatedPauseSeconds,
      now,
    });
  }, [now, session, timerStatus]);

  const activeTask = tasks.find((task) => task.id === selectedTaskId);
  const resolvedSubjectId = activeTask?.subjectId ?? selectedSubjectId;
  const nodeOptions = flatNodes.filter((node) => node.subjectId === resolvedSubjectId);
  const canStart = Boolean(selectedTaskId || selectedSubjectId);
  const title = session?.taskTitle ?? activeTask?.title ?? "选择任务后开始";
  const subject = session?.subjectName ?? activeTask?.subjectName ?? subjects.find((item) => item.id === selectedSubjectId)?.name ?? "未选择科目";
  const selectedNodeTitle = flatNodes.find((node) => node.id === selectedSyllabusNodeId)?.title;
  const syllabusNode = session?.syllabusNodeTitle ?? activeTask?.syllabusNodeTitle ?? selectedNodeTitle ?? "未关联考纲节点";
  const isFocused = timerStatus === "running" || timerStatus === "paused" || timerStatus === "ending";
  const lastCompletedSession = chooseLatestSession(localCompletedSession, latestCompletedSession);
  const closeoutSession = session ? (session.status === "completed" ? session : null) : lastCompletedSession;
  const closeoutActionLabel = closeoutSession?.isLowConversion ? "补产出要求" : "保留动作";
  const closeoutSyllabusNode = closeoutSession?.syllabusNodeTitle ?? syllabusNode;

  async function mutate(path: string, body?: unknown): Promise<StudySessionDto | null> {
    setError(null);
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => null)) as { session?: StudySessionDto; error?: string } | null;
    if (!response.ok) throw new Error(data?.error ?? "请求失败");
    if (data?.session) setSession(data.session);
    startTransition(() => router.refresh());
    return data?.session ?? null;
  }

  async function start() {
    try {
      await mutate(
        "/api/study-sessions/start",
        selectedTaskId
          ? { taskId: selectedTaskId }
          : { subjectId: selectedSubjectId, syllabusNodeId: selectedSyllabusNodeId || null },
      );
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "开始失败");
    }
  }

  async function pause() {
    if (!session) return;
    try {
      await mutate(`/api/study-sessions/${session.id}/pause`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "暂停失败");
    }
  }

  async function resume() {
    if (!session) return;
    try {
      await mutate(`/api/study-sessions/${session.id}/resume`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "继续失败");
    }
  }

  async function end(formData: FormData) {
    if (!session) return;
    try {
      const completedSession = await mutate(`/api/study-sessions/${session.id}/end`, {
        qualityScore: Number(formData.get("qualityScore")),
        isEffective: formData.get("isEffective") === "true",
        understandingLevel: String(formData.get("understandingLevel") ?? ""),
        minimalOutput: String(formData.get("minimalOutput") ?? ""),
        nextAction: String(formData.get("nextAction") ?? ""),
        producedNote: formData.get("producedNote") === "on",
        producedMistake: formData.get("producedMistake") === "on",
        note: String(formData.get("note") ?? ""),
        completeTask: formData.get("completeTask") === "on",
      });
      if (completedSession) setLocalCompletedSession(completedSession);
      setSession(null);
      setIsEnding(false);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "结束失败");
    }
  }

  return (
    <section
      className={`min-w-0 rounded-lg border bg-[#101419] p-5 transition-all duration-300 ${
        isFocused ? "border-teal-300/50 shadow-[0_0_0_1px_rgba(45,212,191,0.28)]" : "border-white/10"
      }`}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-teal-300">{subject}</p>
          <h2 className="mt-2 break-words text-2xl font-semibold text-white sm:text-3xl">{title}</h2>
          <p className="mt-2 break-words text-sm text-zinc-400">{syllabusNode}</p>
        </div>
        <span className="rounded-md border border-white/10 px-3 py-2 text-sm text-zinc-300">
          {labelStatus(timerStatus)}
        </span>
      </div>

      <div className={`mt-7 grid gap-5 ${isFocused ? "lg:grid-cols-[1fr_0.82fr]" : ""}`}>
        <div className="min-w-0 rounded-lg border border-white/10 bg-[#151a20] p-5">
          <p className="text-sm text-zinc-500">本次专注</p>
          <p className={`${isFocused ? "text-6xl" : "text-5xl"} mt-3 font-semibold tabular-nums text-white`}>
            {formatElapsed(elapsedSeconds)}
          </p>

          {!session ? (
            <div className="mt-5 grid gap-3">
              <label className="grid gap-2 text-sm text-zinc-300">
                任务
                <select
                  className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
                  value={selectedTaskId}
                  onChange={(event) => {
                    setSelectedTaskId(event.target.value);
                    setSelectedSyllabusNodeId("");
                  }}
                >
                  <option value="">不关联任务</option>
                  {tasks
                    .filter((task) => task.status !== "done" && task.status !== "skipped")
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.subjectName} / {task.title}
                      </option>
                  ))}
                </select>
              </label>
              {activeTask ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-teal-300/20 bg-teal-300/10 px-3 py-3 text-sm text-teal-50">
                  <span className="min-w-0 truncate">已选：{activeTask.title}</span>
                  <button
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-teal-200/20 text-teal-100 transition hover:bg-teal-200/10"
                    type="button"
                    aria-label="清除已选任务"
                    title="清除已选任务"
                    onClick={() => {
                      setSelectedTaskId("");
                      setSelectedSyllabusNodeId("");
                    }}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <label className="grid gap-2 text-sm text-zinc-300">
                    科目
                    <select
                      className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
                      value={selectedSubjectId}
                      onChange={(event) => {
                        setSelectedSubjectId(event.target.value);
                        setSelectedSyllabusNodeId("");
                      }}
                    >
                      {subjects.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm text-zinc-300">
                    考纲节点
                    <select
                      className="h-11 w-full min-w-0 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100"
                      value={selectedSyllabusNodeId}
                      onChange={(event) => setSelectedSyllabusNodeId(event.target.value)}
                    >
                      <option value="">不关联考纲节点</option>
                      {nodeOptions.map((node) => (
                        <option key={node.id} value={node.id}>
                          {"  ".repeat(node.depth)}
                          {node.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {!session ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={start}
                disabled={!canStart || isPending}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                开始
              </button>
            ) : null}
            {timerStatus === "running" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md border border-white/10 px-4 font-medium text-zinc-100 transition hover:bg-white/10"
                type="button"
                onClick={pause}
              >
                <Pause className="h-4 w-4" aria-hidden="true" />
                暂停
              </button>
            ) : null}
            {timerStatus === "paused" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md bg-teal-400 px-4 font-medium text-[#071011] transition hover:bg-teal-300"
                type="button"
                onClick={resume}
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                继续
              </button>
            ) : null}
            {timerStatus === "running" || timerStatus === "paused" ? (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-md border border-red-300/30 px-4 font-medium text-red-100 transition hover:bg-red-400/10"
                type="button"
                onClick={() => setIsEnding(true)}
              >
                <Square className="h-4 w-4" aria-hidden="true" />
                结束
              </button>
            ) : null}
          </div>
          {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-[#151a20] p-5">
          <p className="text-sm text-zinc-500">结束后收口</p>
          {isEnding ? (
            <form action={end} className="mt-4 grid gap-3">
              <label className="grid gap-2 text-sm text-zinc-300">
                学习质量
                <select name="qualityScore" className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100">
                  <option value="5">5 / 很扎实</option>
                  <option value="4">4 / 有推进</option>
                  <option value="3">3 / 勉强有效</option>
                  <option value="2">2 / 转化偏低</option>
                  <option value="1">1 / 基本无效</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm text-zinc-300">
                是否有效学习
                <select name="isEffective" className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-zinc-100">
                  <option value="true">有效</option>
                  <option value="false">低转化，需要补产出</option>
                </select>
              </label>
              <input
                className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                name="understandingLevel"
                placeholder="理解程度"
                required
              />
              <textarea
                className="min-h-20 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-100"
                name="minimalOutput"
                placeholder="最小产出"
                required
              />
              <input
                className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-100"
                name="nextAction"
                placeholder="下一步动作"
                required
              />
              <textarea
                className="min-h-16 rounded-md border border-white/10 bg-[#0d1117] px-3 py-2 text-sm text-zinc-100"
                name="note"
                placeholder="补充记录"
              />
              <div className="grid gap-2 rounded-md border border-white/10 bg-[#0d1117] p-3 text-sm text-zinc-300">
                <label className="flex items-center gap-2">
                  <input name="producedNote" type="checkbox" className="h-4 w-4" />
                  本次产生了笔记
                </label>
                <label className="flex items-center gap-2">
                  <input name="producedMistake" type="checkbox" className="h-4 w-4" />
                  本次产生了错题或错因订正
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input name="completeTask" type="checkbox" className="h-4 w-4" />
                同时完成关联任务
              </label>
              <button className="h-11 rounded-md bg-teal-400 px-4 font-medium text-[#071011]" type="submit">
                保存收口
              </button>
            </form>
          ) : (
            <div className="mt-4 grid gap-3 text-sm text-zinc-300">
              <p>质量评分：{closeoutSession?.qualityScore ?? "未填写"}</p>
              <p>是否有效：{closeoutSession?.isEffective == null ? "未标记" : closeoutSession.isEffective ? "有效" : "低转化"}</p>
              <p>理解程度：{closeoutSession?.understandingLevel ?? "未填写"}</p>
              <p>最小产出：{closeoutSession?.minimalOutput ?? (closeoutSession?.note ? "已提交" : "未提交")}</p>
              <p>下一步：{closeoutSession?.nextAction ?? "未填写"}</p>
              {closeoutSession?.antiFakeReason ? <p>规则原因：{closeoutSession.antiFakeReason}</p> : null}
              {closeoutSession?.requiredOutput ? <p>{closeoutActionLabel}：{closeoutSession.requiredOutput}</p> : null}
              {closeoutSession ? (
                <p>
                  产出记录：{closeoutSession.producedNote ? "笔记" : "无笔记"} / {closeoutSession.producedMistake ? "错题或订正" : "无错题订正"}
                </p>
              ) : null}
              <p>关联进度：{closeoutSyllabusNode}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function labelStatus(status: TimerStatus): string {
  switch (status) {
    case "idle":
      return "未开始";
    case "running":
      return "专注中";
    case "paused":
      return "已暂停";
    case "ending":
      return "收口中";
    case "completed":
      return "待复盘";
  }
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function chooseLatestSession(first: StudySessionDto | null, second: StudySessionDto | null): StudySessionDto | null {
  if (!first) return second;
  if (!second) return first;
  return getSessionTime(first) >= getSessionTime(second) ? first : second;
}

function getSessionTime(session: StudySessionDto): number {
  return Date.parse(session.endedAt ?? session.startedAt);
}

function flattenNodes(nodes: SyllabusOptionNodeDto[], depth = 0): FlatNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      subjectId: node.subjectId,
      title: node.title,
      depth,
    },
    ...flattenNodes(node.children, depth + 1),
  ]);
}
