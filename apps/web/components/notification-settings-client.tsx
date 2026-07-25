"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import type { NotificationPreferenceDto } from "@/lib/study/notification-preferences-service";

const SHOW_TITLE_KEY = "af.notification.showSpecificTitle";

export function NotificationSettingsClient(props: { userId: string; initial: NotificationPreferenceDto }) {
  const draftKey = `areaforge.notification-preference.draft.${props.userId}`;
  const [pref, setPref] = useState(props.initial);
  const [showSpecificTitle, setShowSpecificTitle] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SHOW_TITLE_KEY) === "1";
  });
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestConflict, setLatestConflict] = useState<NotificationPreferenceDto | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [testCategory, setTestCategory] = useState<"review" | "plan" | "evening">("review");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPermission("Notification" in window ? Notification.permission : "unsupported");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isNotificationPreference);
    if (draft) setPref(draft);
    setDraftReady(true);
  }, [draftKey]);

  useEffect(() => {
    if (!draftReady) return;
    savePrivateBusinessDraft(draftKey, pref);
  }, [draftKey, draftReady, pref]);

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
      body: JSON.stringify({ category: testCategory }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { payload?: { title: string; body: string; tag: string; data: { route: string } }; error?: string }
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
    const notification = new Notification(title, { body: payload.payload.body, tag: payload.payload.tag, data: payload.payload.data });
    notification.onclick = () => {
      window.focus();
      window.location.assign(sanitizeNotificationRoute(payload.payload?.data.route));
      notification.close();
    };
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
      <div className="grid gap-3 border-t border-white/10 pt-4">
        <NotificationWindowRow label="复习到期时间窗" start={pref.reviewDueWindowStart} end={pref.reviewDueWindowEnd} onChange={(start, end) => setPref((current) => ({ ...current, reviewDueWindowStart: start, reviewDueWindowEnd: end }))}/>
        <NotificationWindowRow label="计划开始时间窗" start={pref.planStartWindowStart} end={pref.planStartWindowEnd} onChange={(start, end) => setPref((current) => ({ ...current, planStartWindowStart: start, planStartWindowEnd: end }))}/>
        <NotificationWindowRow label="晚间复盘时间窗" start={pref.eveningReviewWindowStart} end={pref.eveningReviewWindowEnd} onChange={(start, end) => setPref((current) => ({ ...current, eveningReviewWindowStart: start, eveningReviewWindowEnd: end }))}/>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={pref.quietHoursStart !== null && pref.quietHoursEnd !== null}
            onChange={(event) => setPref((current) => ({
              ...current,
              quietHoursStart: event.target.checked ? 22 : null,
              quietHoursEnd: event.target.checked ? 7 : null,
            }))}
          />
          启用安静时段
        </label>
        {pref.quietHoursStart !== null && pref.quietHoursEnd !== null ? (
          <NotificationWindowRow label="安静时段（可跨午夜）" start={pref.quietHoursStart} end={pref.quietHoursEnd} onChange={(start, end) => setPref((current) => ({ ...current, quietHoursStart: start, quietHoursEnd: end }))}/>
        ) : null}
      </div>
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
        <select aria-label="测试通知类别" className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-200" value={testCategory} onChange={(event) => setTestCategory(event.target.value as typeof testCategory)}>
          <option value="review">复习到期</option>
          <option value="plan">计划开始</option>
          <option value="evening">晚间复盘</option>
        </select>
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

function NotificationWindowRow(props: { label: string; start: number; end: number; onChange: (start: number, end: number) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_8rem_8rem] sm:items-center">
      <span className="text-sm text-zinc-400">{props.label}</span>
      <HourSelect label={`${props.label}开始`} value={props.start} onChange={(value) => props.onChange(value, props.end)}/>
      <HourSelect label={`${props.label}结束`} value={props.end} onChange={(value) => props.onChange(props.start, value)}/>
    </div>
  );
}

function HourSelect(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <select aria-label={props.label} className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-200" value={props.value} onChange={(event) => props.onChange(Number(event.target.value))}>
      {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
    </select>
  );
}

function sanitizeNotificationRoute(route?: string): string {
  return route && ["/knowledge/reviews", "/today/plan", "/today"].includes(route) ? route : "/today";
}
