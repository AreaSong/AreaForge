"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Drawer } from "@/components/ui/overlays";
import { useQuickReviewActivityGuard } from "@/components/quick-review-activity-guard";
import { completeIdempotentCommand, getOrCreateIdempotencyKey } from "@/lib/client/idempotent-command";
import { getClientDeviceHeaders } from "@/lib/client/device-identity";
import { redirectToLoginWithCurrentLocation } from "@/lib/client/private-business-drafts";
import type { StudyTaskDto, SubjectDto } from "@/lib/study/types";

type RecoveryMode = "menu" | "five-minute" | "minimum-task";

export function RecoveryActionDrawer(props: {
  open: boolean;
  title: string;
  motivationLine: string | null;
  motivationUrl: string | null;
  motivationError: string | null;
  workspaceId: string | null;
  defaultSubjectId: string | null;
  onClose: () => void;
}) {
  return <Drawer open={props.open} title={props.title} onClose={props.onClose}><RecoveryActionContent {...props} /></Drawer>;
}

export function RecoveryActionContent(props: {
  open: boolean;
  title: string;
  motivationLine: string | null;
  motivationUrl: string | null;
  motivationError: string | null;
  workspaceId: string | null;
  defaultSubjectId: string | null;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { withActivityBarrier } = useQuickReviewActivityGuard();
  const [mode, setMode] = useState<RecoveryMode>("menu");
  const [subjects, setSubjects] = useState<SubjectDto[]>([]);
  const [tasks, setTasks] = useState<StudyTaskDto[]>([]);
  const [subjectId, setSubjectId] = useState(props.defaultSubjectId ?? "");
  const [taskChoice, setTaskChoice] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("今天最小任务");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setMode("menu");
    setError(null);
    props.onClose();
  }

  async function prepare(nextMode: Exclude<RecoveryMode, "menu">) {
    setPending(true);
    setError(null);
    try {
      const [subjectResponse, taskResponse] = await Promise.all([
        fetch("/api/subjects", { cache: "no-store" }),
        nextMode === "minimum-task" ? fetch("/api/tasks", { cache: "no-store" }) : null,
      ]);
      if (subjectResponse.status === 401 || taskResponse?.status === 401) {
        redirectToLoginWithCurrentLocation();
        return;
      }
      if (!subjectResponse.ok || (taskResponse && !taskResponse.ok)) throw new Error("RECOVERY_OPTIONS_UNAVAILABLE");
      const subjectBody = await subjectResponse.json() as { subjects?: SubjectDto[] };
      const activeSubjects = (subjectBody.subjects ?? []).filter((subject) => !subject.archivedAt && !subject.legacyScope);
      const allowedSubjectIds = new Set(activeSubjects.map((subject) => subject.id));
      const taskBody = taskResponse ? await taskResponse.json() as { tasks?: StudyTaskDto[] } : null;
      const activeTasks = (taskBody?.tasks ?? [])
        .filter((task) => allowedSubjectIds.has(task.subjectId) && (task.status === "todo" || task.status === "in_progress"))
        .sort((left, right) => left.estimatedMinutes - right.estimatedMinutes);
      const selectedSubjectId = activeSubjects.some((subject) => subject.id === props.defaultSubjectId)
        ? props.defaultSubjectId as string
        : activeSubjects[0]?.id ?? "";
      setSubjects(activeSubjects);
      setTasks(activeTasks);
      setSubjectId(selectedSubjectId);
      setTaskChoice(activeTasks[0]?.id ?? "new");
      setMode(nextMode);
    } catch {
      setError("无法读取可用科目和任务，请显式重试。");
    } finally {
      setPending(false);
    }
  }

  async function continueCurrentAction() {
    setPending(true);
    setError(null);
    try {
      const sessionId = await readActiveSessionId();
      if (!sessionId) {
        setError("当前没有进行中的活动，请选择 5 分钟启动或最小任务。");
        return;
      }
      close();
      router.push(`/focus?returnTo=${encodeURIComponent(pathname)}`);
    } catch (message) {
      setError(message instanceof Error ? message.message : "无法读取当前活动。");
    } finally {
      setPending(false);
    }
  }

  async function startFiveMinutes() {
    if (!subjectId) {
      setError("请选择一个未归档科目。");
      return;
    }
    await startSession({ subjectId, goalMinutes: 5, startSource: "RECOVERY" });
  }

  async function startMinimumTask() {
    await withActivityBarrier(runStartMinimumTask);
  }

  async function runStartMinimumTask() {
    setPending(true);
    setError(null);
    const commandScope = `recovery-minimum-task:${props.workspaceId ?? "setup"}`;
    try {
      const activeSessionId = await readActiveSessionId();
      if (activeSessionId) {
        close();
        router.push(`/focus?returnTo=${encodeURIComponent(pathname)}`);
        return;
      }
      let taskId = taskChoice;
      if (taskChoice === "new") {
        if (!subjectId || !newTaskTitle.trim()) {
          setError("请选择科目并填写最小任务标题。");
          return;
        }
        const payload = {
          subjectId,
          title: newTaskTitle.trim(),
          estimatedMinutes: 25,
          type: "study",
          priority: "high",
        };
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: getOrCreateIdempotencyKey(commandScope, "task-create", payload),
            ...payload,
          }),
        });
        if (response.status === 401) return redirectToLoginWithCurrentLocation();
        const body = await response.json().catch(() => null) as { task?: { id: string }; error?: string } | null;
        if (!response.ok || !body?.task?.id) throw new Error(body?.error ?? "创建最小任务失败，当前输入仍保留。");
        taskId = body.task.id;
      }
      await postStartSession({ taskId, goalMinutes: 25, startSource: "RECOVERY" });
      completeIdempotentCommand(commandScope);
      close();
      router.push(`/focus?returnTo=${encodeURIComponent(pathname)}`);
    } catch (message) {
      setError(message instanceof Error ? message.message : "最小任务启动失败，请显式重试。");
    } finally {
      setPending(false);
    }
  }

  async function startSession(payload: { subjectId: string; goalMinutes: number; startSource: "RECOVERY" }) {
    await withActivityBarrier(() => runStartSession(payload));
  }

  async function runStartSession(payload: { subjectId: string; goalMinutes: number; startSource: "RECOVERY" }) {
    setPending(true);
    setError(null);
    try {
      const activeSessionId = await readActiveSessionId();
      await (activeSessionId ?? postStartSession(payload));
      close();
      router.push(`/focus?returnTo=${encodeURIComponent(pathname)}`);
    } catch (message) {
      setError(message instanceof Error ? message.message : "启动失败，请显式重试。");
    } finally {
      setPending(false);
    }
  }

  async function readActiveSessionId(): Promise<string | null> {
    const response = await fetch("/api/study-sessions/active", { cache: "no-store" });
    if (response.status === 401) {
      redirectToLoginWithCurrentLocation();
      throw new Error("登录已过期，重新登录后请显式重试。");
    }
    const body = await response.json().catch(() => null) as { session?: { id?: string } | null; error?: string } | null;
    if (!response.ok) throw new Error(body?.error ?? "无法读取当前活动。");
    return body?.session?.id ?? null;
  }

  async function postStartSession(payload: Record<string, unknown>): Promise<string> {
    const commandScope = `recovery:focus-start:${String(payload.subjectId ?? "subject")}:${String(payload.goalMinutes ?? "none")}`;
    const requestBody = {
      idempotencyKey: getOrCreateIdempotencyKey(commandScope, "study-session-start", payload),
      ...payload,
    };
    const response = await fetch("/api/study-sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getClientDeviceHeaders() },
      body: JSON.stringify(requestBody),
    });
    if (response.status === 401) {
      redirectToLoginWithCurrentLocation();
      throw new Error("登录已过期，重新登录后请显式重试。");
    }
    const body = await response.json().catch(() => null) as { session?: { id?: string }; latest?: { id?: string }; error?: string } | null;
    const sessionId = body?.session?.id ?? (response.status === 409 ? body?.latest?.id : undefined);
    if (!response.ok && !sessionId) throw new Error(body?.error ?? "无法启动专注活动。");
    if (!sessionId) throw new Error("服务端未返回可继续的活动。");
    completeIdempotentCommand(commandScope);
    return sessionId;
  }

  return (
    <>
      {props.motivationLine ? <p className="rounded-md border border-white/10 p-3 text-sm text-zinc-200">{props.motivationLine}</p> : null}
      {props.motivationUrl ? (
        <a
          className="mt-3 inline-flex text-sm text-teal-300 hover:underline"
          href={props.motivationUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          打开 HTTPS 视频链接
        </a>
      ) : null}
      {props.motivationError ? <p className="mt-3 text-sm text-red-300" role="alert">{props.motivationError}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-300" role="alert">{error}</p> : null}

      {mode === "menu" ? (
        <div className="mt-4 flex flex-col gap-2">
          <ActionButton disabled={pending} onClick={() => void continueCurrentAction()}>继续当前</ActionButton>
          <ActionButton disabled={pending} onClick={() => void prepare("five-minute")}>启动 5 分钟</ActionButton>
          <button type="button" disabled={pending} className="h-11 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-60" onClick={() => void prepare("minimum-task")}>切换到最小任务</button>
        </div>
      ) : null}

      {mode === "five-minute" ? (
        <div className="mt-4 grid gap-3">
          <SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} />
          <div className="flex gap-2"><BackButton onClick={() => setMode("menu")} /><PrimaryButton disabled={pending || !subjectId} onClick={() => void startFiveMinutes()}>开始 5 分钟</PrimaryButton></div>
        </div>
      ) : null}

      {mode === "minimum-task" ? (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-2 text-sm text-zinc-300">最小任务<select className="h-11 rounded-md border border-white/10 bg-[#151a20] px-3" value={taskChoice} onChange={(event) => setTaskChoice(event.target.value)}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} · {task.estimatedMinutes} 分</option>)}<option value="new">新建最小任务</option></select></label>
          {taskChoice === "new" ? <><SubjectSelect subjects={subjects} value={subjectId} onChange={setSubjectId} /><label className="grid gap-2 text-sm text-zinc-300">任务标题<input className="h-11 rounded-md border border-white/10 bg-[#151a20] px-3" value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} /></label></> : null}
          <div className="flex gap-2"><BackButton onClick={() => setMode("menu")} /><PrimaryButton disabled={pending || !taskChoice} onClick={() => void startMinimumTask()}>开始最小任务</PrimaryButton></div>
        </div>
      ) : null}
    </>
  );
}

function SubjectSelect(props: { subjects: SubjectDto[]; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-2 text-sm text-zinc-300">科目<select className="h-11 rounded-md border border-white/10 bg-[#151a20] px-3" value={props.value} onChange={(event) => props.onChange(event.target.value)}><option value="">请选择科目</option>{props.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>;
}

function ActionButton(props: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={props.disabled} className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-200 disabled:opacity-60" onClick={props.onClick}>{props.children}</button>;
}

function BackButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="h-11 rounded-md border border-white/10 px-4 text-sm" onClick={onClick}>返回</button>;
}

function PrimaryButton(props: { disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={props.disabled} className="h-11 flex-1 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-60" onClick={props.onClick}>{props.children}</button>;
}
