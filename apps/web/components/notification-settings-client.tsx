"use client";

import { useState, useTransition } from "react";
import type { NotificationPreferenceDto } from "@/lib/study/notification-preferences-service";

const SHOW_TITLE_KEY = "af.notification.showSpecificTitle";

export function NotificationSettingsClient(props: { initial: NotificationPreferenceDto }) {
  const [pref, setPref] = useState(props.initial);
  const [showSpecificTitle, setShowSpecificTitle] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHOW_TITLE_KEY) === "1";
  });
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function save() {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision: pref.revision,
        reviewDueEnabled: pref.reviewDueEnabled,
        planStartEnabled: pref.planStartEnabled,
        eveningReviewEnabled: pref.eveningReviewEnabled,
        reviewDueWindowStart: pref.reviewDueWindowStart,
        reviewDueWindowEnd: pref.reviewDueWindowEnd,
        planStartWindowStart: pref.planStartWindowStart,
        planStartWindowEnd: pref.planStartWindowEnd,
        eveningReviewWindowStart: pref.eveningReviewWindowStart,
        eveningReviewWindowEnd: pref.eveningReviewWindowEnd,
        quietHoursStart: pref.quietHoursStart,
        quietHoursEnd: pref.quietHoursEnd,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { preference?: NotificationPreferenceDto; error?: string }
      | null;
    if (!response.ok || !payload?.preference) {
      setError(payload?.error ?? "保存失败");
      return;
    }
    setPref(payload.preference);
    setMessage("提醒偏好已保存");
  }

  async function requestPermissionOnce() {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    if (Notification.permission !== "default") {
      setPermission(Notification.permission);
      return;
    }
    const next = await Notification.requestPermission();
    setPermission(next);
  }

  async function sendTest() {
    setError(null);
    setMessage(null);
    const response = await fetch("/api/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "review" }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { payload?: { title: string; body: string; tag: string }; error?: string }
      | null;
    if (!response.ok || !payload?.payload) {
      setError(payload?.error ?? "测试失败");
      return;
    }
    if (!("Notification" in window) || Notification.permission !== "granted") {
      setMessage("权限未授予：已降级为应用内提示 — " + payload.payload.body);
      return;
    }
    const title = showSpecificTitle ? payload.payload.title : "AreaForge 提醒";
    new Notification(title, { body: payload.payload.body, tag: payload.payload.tag });
    setMessage("已发送前台测试通知");
  }

  return (
    <div className="space-y-4 rounded-lg border border-white/10 p-4">
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={pref.reviewDueEnabled}
          onChange={(event) => setPref((prev) => ({ ...prev, reviewDueEnabled: event.target.checked }))}
        />
        复习到期提醒
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={pref.planStartEnabled}
          onChange={(event) => setPref((prev) => ({ ...prev, planStartEnabled: event.target.checked }))}
        />
        计划开始提醒
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={pref.eveningReviewEnabled}
          onChange={(event) => setPref((prev) => ({ ...prev, eveningReviewEnabled: event.target.checked }))}
        />
        晚间复盘提醒
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={showSpecificTitle}
          onChange={(event) => {
            const next = event.target.checked;
            setShowSpecificTitle(next);
            window.localStorage.setItem(SHOW_TITLE_KEY, next ? "1" : "0");
          }}
        />
        当前设备显示具体标题（本地偏好，不跨设备）
      </label>
      <p className="text-xs text-zinc-500">
        浏览器权限：{permission === "unsupported" ? "不支持" : permission}
      </p>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
          onClick={() => startTransition(() => void save())}
        >
          保存提醒偏好
        </button>
        <button
          type="button"
          className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-200"
          onClick={() => void requestPermissionOnce()}
        >
          请求通知权限
        </button>
        <button
          type="button"
          className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-200"
          onClick={() => void sendTest()}
        >
          测试通知
        </button>
      </div>
    </div>
  );
}
