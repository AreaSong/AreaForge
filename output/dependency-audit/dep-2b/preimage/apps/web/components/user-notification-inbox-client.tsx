"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Alert, Badge, EmptyState, Skeleton } from "@/components/ui/feedback";
import { listUserNotifications, updateUserNotification } from "@/lib/api/notification";
import { isConflict } from "@/lib/client/api-errors";
import type {
  UserNotificationAction,
  UserNotificationDto,
  UserNotificationFilter,
} from "@/lib/contracts";
import { formatDateTimeShort } from "@/lib/formatters";

const filters: Array<{ value: UserNotificationFilter; label: string }> = [
  { value: "unread", label: "未读" },
  { value: "all", label: "全部" },
  { value: "dismissed", label: "已隐藏" },
];

export function UserNotificationInboxClient(props: { enabled: boolean }) {
  const [filter, setFilter] = useState<UserNotificationFilter>("unread");
  const [notifications, setNotifications] = useState<UserNotificationDto[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (!props.enabled) return;
    if (showLoading) setPending("load");
    setError(null);
    const result = await listUserNotifications(filter);
    if (result.ok) setNotifications(result.body?.notifications ?? []);
    else setError(result.status === 0 ? "网络不可用，请恢复连接后重试。" : "通知读取失败，请重试。");
    if (showLoading) setPending(null);
  }, [filter, props.enabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!props.enabled) {
    return <SectionCard variant="subtle"><p className="text-sm text-zinc-400">持久通知中心默认关闭；开启前不会读取或写入通知记录。</p></SectionCard>;
  }

  async function update(notification: UserNotificationDto, action: UserNotificationAction) {
    const actionKey = `${notification.id}:${action}`;
    setPending(actionKey);
    setError(null);
    const result = await updateUserNotification(notification.id, action, notification.revision);
    setPending(null);
    if (!result.ok || !result.body?.notification) {
      setError(isConflict(result) ? "通知状态已在其他页面变化，已重新载入。" : "通知更新失败，请重试。");
      if (isConflict(result)) await load(false);
      return;
    }
    const updated = result.body.notification;
    setNotifications((current) => projectUpdatedNotification(current, updated, filter));
    setNotice(notificationActionMessage(action));
  }

  function selectFilter(next: UserNotificationFilter) {
    if (next === filter) return;
    setFilter(next);
    setNotifications([]);
    setNotice(null);
    setError(null);
  }

  return (
    <SectionCard variant="subtle" className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100"><BellRing className="size-4 text-teal-300" aria-hidden="true" />通知收件箱</h3>
          <p className="mt-1 max-w-prose text-xs leading-5 text-zinc-400">跨设备保存排名邀请、状态和申诉结果；通知不包含挑战名称或申诉正文。</p>
        </div>
        <Button className="min-h-11" disabled={pending !== null} onClick={() => void load()} size="sm" type="button" variant="secondary"><RefreshCw className="size-3.5" aria-hidden="true" />刷新通知</Button>
      </header>

      <div className="flex flex-wrap gap-2" aria-label="通知筛选">
        {filters.map((item) => <Button aria-pressed={filter === item.value} className="min-h-11" disabled={pending !== null} key={item.value} onClick={() => selectFilter(item.value)} size="sm" type="button" variant={filter === item.value ? "primary" : "secondary"}>{item.label}</Button>)}
      </div>

      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="danger" role="alert">{error}</Alert> : null}
      {pending === "load" && notifications.length === 0 ? <div className="space-y-2"><Skeleton /><Skeleton className="h-24" /></div> : null}
      {pending !== "load" && notifications.length === 0 ? <EmptyState title={emptyTitle(filter)} description="新的成员与排名事件会显示在这里。" className="py-8" /> : null}
      {notifications.length > 0 ? <div className="space-y-3">{notifications.map((notification) => <NotificationRow key={notification.id} notification={notification} pending={pending} onUpdate={update} />)}</div> : null}
    </SectionCard>
  );
}

function NotificationRow(props: {
  notification: UserNotificationDto;
  pending: string | null;
  onUpdate: (notification: UserNotificationDto, action: UserNotificationAction) => Promise<void>;
}) {
  const item = props.notification;
  const dismissed = item.dismissedAt !== null;
  const unread = item.readAt === null;
  return (
    <article className={`space-y-3 rounded-xl border p-4 ${unread ? "border-teal-400/25 bg-teal-500/[0.05]" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-medium text-zinc-100">{item.title}</h4><Badge tone={unread ? "info" : "neutral"}>{dismissed ? "已隐藏" : unread ? "未读" : "已读"}</Badge></div><p className="mt-1 text-xs text-zinc-500">{item.workspaceLabel}</p></div>
        <time className="text-xs text-zinc-500" dateTime={item.createdAt}>{formatDateTimeShort(item.createdAt)}</time>
      </div>
      <p className="max-w-prose text-sm leading-6 text-zinc-300">{item.body}</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink className="min-h-11" href={item.route} size="sm" variant="secondary">{item.actionLabel}</ButtonLink>
        {!dismissed && unread ? <NotificationActionButton action="read" item={item} label="标为已读" pending={props.pending} onUpdate={props.onUpdate} /> : null}
        {!dismissed && !unread ? <NotificationActionButton action="unread" item={item} label="标为未读" pending={props.pending} onUpdate={props.onUpdate} /> : null}
        {!dismissed ? <NotificationActionButton action="dismiss" item={item} label="隐藏" pending={props.pending} onUpdate={props.onUpdate} /> : null}
        {dismissed ? <NotificationActionButton action="restore" item={item} label="恢复" pending={props.pending} onUpdate={props.onUpdate} /> : null}
      </div>
    </article>
  );
}

function NotificationActionButton(props: { action: UserNotificationAction; item: UserNotificationDto; label: string; pending: string | null; onUpdate: (notification: UserNotificationDto, action: UserNotificationAction) => Promise<void> }) {
  const actionKey = `${props.item.id}:${props.action}`;
  return <Button className="min-h-11" disabled={props.pending !== null} onClick={() => void props.onUpdate(props.item, props.action)} size="sm" type="button" variant="secondary">{props.pending === actionKey ? "处理中" : props.label}</Button>;
}

function projectUpdatedNotification(current: UserNotificationDto[], updated: UserNotificationDto, filter: UserNotificationFilter): UserNotificationDto[] {
  if ((filter === "unread" && updated.readAt !== null) || (filter === "all" && updated.dismissedAt !== null) || (filter === "dismissed" && updated.dismissedAt === null)) {
    return current.filter((item) => item.id !== updated.id);
  }
  return current.map((item) => item.id === updated.id ? updated : item);
}

function notificationActionMessage(action: UserNotificationAction): string {
  if (action === "read") return "通知已标为已读。";
  if (action === "unread") return "通知已标为未读。";
  if (action === "dismiss") return "通知已隐藏，可在“已隐藏”中恢复。";
  return "通知已恢复。";
}

function emptyTitle(filter: UserNotificationFilter): string {
  if (filter === "unread") return "没有未读通知";
  if (filter === "dismissed") return "没有已隐藏通知";
  return "暂无通知";
}
