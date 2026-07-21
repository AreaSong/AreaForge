"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/overlays";
import type { ActionCenterTodayDto } from "@/lib/study/action-center-service";

export function ActionCenterToday({ initial }: { initial: ActionCenterTodayDto }) {
  const router = useRouter();
  const [today] = useState(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(today.subjectTimers.subjects[0]?.subjectId ?? "");
  const [goalMinutes, setGoalMinutes] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mobileQueue, setMobileQueue] = useState<"tasks" | "reviews" | "mistakes">("tasks");

  async function startShortcut() {
    setError(null);
    if (!subjectId) {
      setError("请选择科目");
      return;
    }
    const response = await fetch("/api/study-sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        goalMinutes,
        startSource: "SUBJECT_SHORTCUT",
      }),
    });
    const body = (await response.json().catch(() => null)) as
      | { session?: { id: string }; error?: string; latest?: { id?: string } }
      | null;
    if (!response.ok) {
      if (response.status === 409 && body?.latest?.id) {
        router.push(`/focus/${body.latest.id}`);
        return;
      }
      setError(body?.error ?? "无法开始计时");
      return;
    }
    if (body?.session?.id) {
      setConfirmOpen(false);
      router.push(`/focus/${body.session.id}`);
      return;
    }
    setError("未返回 session");
  }

  async function createMinimumTask() {
    setError(null);
    if (!subjectId) {
      setError("请先选择科目");
      return;
    }
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        title: "今天最小任务",
        estimatedMinutes: 25,
        type: "study",
        priority: "high",
      }),
    });
    const body = (await response.json().catch(() => null)) as { task?: { id: string }; error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "无法创建最小任务");
      return;
    }
    startTransition(() => router.refresh());
    if (body?.task?.id) router.push(`/today/tasks/${body.task.id}`);
  }

  if (today.setupRequired) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold text-white">今日行动中心</h1>
        <div className="rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          尚未设置考试工作区。不展示伪造统计。
        </div>
        <Link
          href="/settings/workspace?setup=1"
          className="inline-flex h-11 items-center rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black hover:bg-teal-400"
        >
          设置考试目标
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-sm text-teal-300">{today.workspace?.name}</p>
        <h1 className="mt-1 text-3xl font-semibold text-white">今日行动中心</h1>
      </div>

      {today.statusBar ? (
        <div className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-200">
          {today.statusBar === "paused_activity"
            ? "活动已暂停，可继续当前行动。"
            : today.statusBar === "recovery_minimum"
              ? "恢复模式：先完成一个最小行动。"
              : "晚间提醒：最低行动或复盘尚未闭环。"}
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-[#101419] p-4">
        <p className="text-xs uppercase tracking-wide text-zinc-500">当前推荐</p>
        {today.recommendation ? (
          <>
            <h2 className="mt-2 text-xl font-medium text-white">{today.recommendation.title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{today.recommendation.reason}</p>
            {today.recommendation.softDependencyHint ? (
              <p className="mt-1 text-sm text-amber-200">{today.recommendation.softDependencyHint}</p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">暂无推荐。可以创建今天最小任务。</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={today.primaryActionHref}
            className="inline-flex h-11 items-center rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black hover:bg-teal-400"
          >
            {today.primaryActionLabel}
          </Link>
          {today.queuesEmpty ? (
            <button
              type="button"
              className="h-11 rounded-md border border-white/10 px-4 text-sm text-zinc-200 hover:bg-white/5"
              onClick={() => void createMinimumTask()}
            >
              创建今天最小任务
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium text-white">科目快捷计时</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {today.subjectTimers.subjects.map((subject) => (
            <div key={subject.subjectId} className="rounded-md border border-white/10 bg-[#101419] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-white">{subject.title}</p>
                  {subject.groupTitle ? <p className="text-xs text-zinc-500">{subject.groupTitle}</p> : null}
                  <p className="mt-2 text-xs text-zinc-400">
                    今日 {subject.todayEffectiveMinutes} 分 · 近 7 日 {subject.last7EffectiveMinutes} 分
                  </p>
                  {subject.contextSummary ? <p className="mt-1 text-xs text-zinc-500">{subject.contextSummary}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={!subject.canStart}
                  className="rounded-md border border-teal-400/40 px-3 py-1.5 text-xs text-teal-200 disabled:opacity-40"
                  onClick={() => {
                    setSubjectId(subject.subjectId);
                    setConfirmOpen(true);
                  }}
                >
                  开始
                </button>
              </div>
            </div>
          ))}
        </div>
        {today.subjectTimers.groups.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {today.subjectTimers.groups.map((group) => (
              <div key={group.groupId} className="rounded-md border border-dashed border-white/10 px-3 py-2 text-xs text-zinc-500">
                {group.title}（分组聚合，不可直接开始）· 今日 {group.todayEffectiveMinutes} 分
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-white">三队列</h2>
          <div className="flex gap-1 md:hidden">
            {(
              [
                ["tasks", "任务"],
                ["reviews", "复习"],
                ["mistakes", "错题"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`rounded-md px-2 py-1 text-xs ${mobileQueue === key ? "bg-white/10 text-white" : "text-zinc-500"}`}
                onClick={() => setMobileQueue(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <QueueCard
            title="正式任务"
            hidden={false}
            mobileHidden={mobileQueue !== "tasks"}
            items={today.queues.formalTasks}
          />
          <QueueCard
            title="笔记/资料/考纲"
            hidden={false}
            mobileHidden={mobileQueue !== "reviews"}
            items={today.queues.noteResourceSyllabusReviews}
          />
          <QueueCard
            title="错题复习"
            hidden={false}
            mobileHidden={mobileQueue !== "mistakes"}
            items={today.queues.mistakeReviews}
          />
        </div>
      </div>

      {today.recovery ? (
        <details className="rounded-md border border-white/10 bg-[#101419] p-3 text-sm">
          <summary className="cursor-pointer text-zinc-200">查看完整计划与恢复详情</summary>
          <p className="mt-2 text-zinc-400">
            阶段 {today.recovery.currentStage} · 目标 {today.recovery.targetMinutes} 分钟 · {today.recovery.reason}
          </p>
          <Link href="/today/plan" className="mt-2 inline-flex text-teal-300 hover:underline">
            打开计划
          </Link>
        </details>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <Modal open={confirmOpen} title="确认科目快捷计时" onClose={() => setConfirmOpen(false)}>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-zinc-400">科目</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              {today.subjectTimers.subjects.map((subject) => (
                <option key={subject.subjectId} value={subject.subjectId}>
                  {subject.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-zinc-400">目标时长（分钟，可选）</span>
            <input
              type="number"
              min={5}
              max={720}
              className="mt-1 h-10 w-full rounded-md border border-white/10 bg-[#151a20] px-2"
              value={goalMinutes}
              onChange={(event) => setGoalMinutes(Number(event.target.value) || 25)}
            />
          </label>
          <p className="text-xs text-zinc-500">到点只提醒，不自动结束。不要求先创建任务。</p>
          <button
            type="button"
            disabled={pending}
            className="h-11 w-full rounded-md bg-teal-500/90 text-sm font-medium text-black disabled:opacity-60"
            onClick={() => void startShortcut()}
          >
            确认开始
          </button>
        </div>
      </Modal>
    </section>
  );
}

function QueueCard(props: {
  title: string;
  items: Array<{ id: string; title: string; reason: string; href: string; softDependencyHint: string | null }>;
  hidden: boolean;
  mobileHidden: boolean;
}) {
  return (
    <div className={`rounded-md border border-white/10 bg-[#101419] p-3 ${props.mobileHidden ? "hidden md:block" : ""} ${props.hidden ? "hidden" : ""}`}>
      <h3 className="text-sm font-medium text-zinc-200">{props.title}</h3>
      {props.items.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">空</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {props.items.map((item) => (
            <li key={item.id} className="rounded border border-white/5 p-2">
              <p className="text-sm text-white">{item.title}</p>
              <p className="text-xs text-zinc-500">{item.reason}</p>
              {item.softDependencyHint ? <p className="text-xs text-amber-200">{item.softDependencyHint}</p> : null}
              <Link href={item.href} className="mt-1 inline-flex text-xs text-teal-300 hover:underline">
                开始
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
