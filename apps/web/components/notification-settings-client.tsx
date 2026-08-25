"use client";

import { useEffect, useState, useTransition } from "react";
import { sanitizeForegroundNotificationRoute } from "@areaforge/core";
import { ConflictResolutionModal } from "@/components/conflict-resolution-modal";
import { sendNotificationTest, updateNotificationPreferences } from "@/lib/api/notification";
import {
  loadPrivateBusinessDraft,
  LONG_PRIVATE_DRAFT_TTL_MS,
  redirectToLoginWithCurrentLocation,
  removePrivateBusinessDraft,
  savePrivateBusinessDraft,
} from "@/lib/client/private-business-drafts";
import { classifyApiFailure } from "@/lib/client/api-errors";
import type { NotificationPreferenceDto } from "@/lib/contracts";
import { getBrowserStoragePort } from "@/lib/client/storage-port";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/field";

const SHOW_TITLE_KEY = "af.notification.showSpecificTitle";

interface NotificationConflict {
  baseline: NotificationPreferenceDto;
  submitted: NotificationPreferenceDto;
  latest: NotificationPreferenceDto;
  conflictFields: string[];
}

export function NotificationSettingsClient(props: { userId: string; initial: NotificationPreferenceDto }) {
  const draftKey = `areaforge.notification-preference.draft.${props.userId}`;
  const [pref, setPref] = useState(props.initial);
  const [savedPref, setSavedPref] = useState(props.initial);
  const [showSpecificTitle, setShowSpecificTitle] = useState(() => {
    if (typeof window === "undefined") return false;
    return getBrowserStoragePort("local")?.getItem(SHOW_TITLE_KEY) === "1";
  });
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<NotificationConflict | null>(null);
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
    const timer = window.setTimeout(() => {
      const draft = loadPrivateBusinessDraft(draftKey, LONG_PRIVATE_DRAFT_TTL_MS, isNotificationPreference);
      if (draft) {
        setPref(draft);
        if (draft.revision !== props.initial.revision) {
          setConflict({
            baseline: props.initial,
            submitted: draft,
            latest: props.initial,
            conflictFields: ["revision"],
          });
        }
      }
      setDraftReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey, props.initial]);

  useEffect(() => {
    if (!draftReady) return;
    if (notificationPreferencesEqual(pref, savedPref)) {
      removePrivateBusinessDraft(draftKey);
      return;
    }
    savePrivateBusinessDraft(draftKey, pref);
  }, [draftKey, draftReady, pref, savedPref]);

  async function save() {
    setError(null);
    setMessage(null);
    setConflict(null);
    const submitted = structuredClone(pref);
    try {
      const response = await updateNotificationPreferences({
        expectedRevision: submitted.revision,
        reviewDueEnabled: submitted.reviewDueEnabled,
        planStartEnabled: submitted.planStartEnabled,
        eveningReviewEnabled: submitted.eveningReviewEnabled,
        reviewDueWindowStart: submitted.reviewDueWindowStart,
        reviewDueWindowEnd: submitted.reviewDueWindowEnd,
        planStartWindowStart: submitted.planStartWindowStart,
        planStartWindowEnd: submitted.planStartWindowEnd,
        eveningReviewWindowStart: submitted.eveningReviewWindowStart,
        eveningReviewWindowEnd: submitted.eveningReviewWindowEnd,
        quietHoursStart: submitted.quietHoursStart,
        quietHoursEnd: submitted.quietHoursEnd,
      });
      const payload = response.body;
      if (!response.ok) {
        const failure = classifyApiFailure(response);
        if (failure.kind === "unauthorized") {
          setError("登录已过期，本地修改已保留。重新登录后请显式重试。");
          redirectToLoginWithCurrentLocation();
          return;
        }
        if (failure.kind === "conflict" && payload?.latest && isNotificationPreference(payload.latest)) {
          setConflict({
            baseline: savedPref,
            submitted,
            latest: payload.latest,
            conflictFields: failure.conflictFields.length > 0 ? failure.conflictFields : ["revision"],
          });
          setError("提醒偏好已在其他页面更新。本地修改仍保留，请查看最新状态后决定如何合并。");
          return;
        }
        setError(failure.code ?? Object.values(failure.fieldErrors).flat()[0] ?? "保存失败，本地修改已保留");
        return;
      }
      if (!payload?.preference) {
        setError("保存失败，本地修改已保留");
        return;
      }
      setPref((current) => notificationPreferencesEqual(current, submitted)
        ? payload.preference!
        : { ...current, revision: payload.preference!.revision });
      setSavedPref(payload.preference);
      setMessage("提醒偏好已保存");
    } catch {
      setError("网络不可用，本地修改已保留；恢复网络后请显式重试。");
    }
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
    try {
      const response = await sendNotificationTest(testCategory);
      const payload = response.body;
      if (!response.ok) {
        const failure = classifyApiFailure(response);
        if (failure.kind === "unauthorized") {
          redirectToLoginWithCurrentLocation();
          return;
        }
        setError(failure.code ?? Object.values(failure.fieldErrors).flat()[0] ?? "测试失败");
        return;
      }
      if (!payload?.payload) {
        setError("测试失败");
        return;
      }
      if (!("Notification" in window) || Notification.permission !== "granted") {
        setMessage("权限未授予：已降级为应用内提示 - " + payload.payload.body);
        return;
      }
      const title = showSpecificTitle ? payload.payload.title : "AreaForge 提醒";
      const notification = new Notification(title, { body: payload.payload.body, tag: payload.payload.tag, data: payload.payload.data });
      notification.onclick = () => {
        window.focus();
        window.location.assign(sanitizeForegroundNotificationRoute(payload.payload?.data.route));
        notification.close();
      };
      setMessage("已发送前台测试通知");
    } catch {
      setError("网络不可用，暂时无法发送测试通知。");
    }
  }

  return (
    <>
    <div className="space-y-4 rounded-lg border border-white/10 p-4">
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <Checkbox
          checked={pref.reviewDueEnabled}
          onChange={(event) => setPref((prev) => ({ ...prev, reviewDueEnabled: event.target.checked }))}
        />
        复习到期提醒
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <Checkbox
          checked={pref.planStartEnabled}
          onChange={(event) => setPref((prev) => ({ ...prev, planStartEnabled: event.target.checked }))}
        />
        计划开始提醒
      </label>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <Checkbox
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
          <Checkbox
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
        <Checkbox
          checked={showSpecificTitle}
          onChange={(event) => {
            const next = event.target.checked;
            setShowSpecificTitle(next);
            getBrowserStoragePort("local")?.setItem(SHOW_TITLE_KEY, next ? "1" : "0");
          }}
        />
        当前设备显示具体标题（本地偏好，不跨设备）
      </label>
      <p className="text-xs text-zinc-500">
        浏览器权限：{permission === "unsupported" ? "不支持" : permission}
      </p>
      {error ? (
        <p className="text-sm text-red-300" role="alert" aria-live="assertive" aria-atomic="true">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-300" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          type="button"
          disabled={pending}
          className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
          onClick={() => startTransition(() => void save())}
        >
          保存提醒偏好
        </Button>
        <Button
          variant="secondary"
          type="button"
          className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-200"
          onClick={() => void requestPermissionOnce()}
        >
          请求通知权限
        </Button>
        <Select aria-label="测试通知类别" className="h-10 !w-auto rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-200" value={testCategory} onChange={(event) => setTestCategory(event.target.value as typeof testCategory)}>
          <option value="review">复习到期</option>
          <option value="plan">计划开始</option>
          <option value="evening">晚间复盘</option>
        </Select>
        <Button
          variant="secondary"
          type="button"
          className="h-10 rounded-md border border-white/10 px-4 text-sm text-zinc-200"
          onClick={() => void sendTest()}
        >
          测试通知
        </Button>
      </div>
    </div>
    <ConflictResolutionModal
      open={conflict !== null}
      title="提醒偏好已在其他页面更新"
      description="本地修改和服务端最新值都已保留。请选择采用服务端，或以最新 revision 为基线人工合并后再次保存。"
      conflictFields={conflict?.conflictFields ?? []}
      comparisons={conflict ? notificationConflictComparisons(conflict) : []}
      onAdoptServer={() => {
        if (!conflict) return;
        setPref(conflict.latest);
        setSavedPref(conflict.latest);
        setConflict(null);
        setError(null);
        setMessage("已采用服务端最新提醒偏好");
      }}
      onManualMerge={() => {
        if (!conflict) return;
        setPref({ ...conflict.submitted, revision: conflict.latest.revision });
        setSavedPref(conflict.latest);
        setConflict(null);
        setError("已前移到服务端最新 revision 并保留本地修改；请检查后再次点击保存，不会自动重放");
      }}
    />
    </>
  );
}

function NotificationWindowRow(props: { label: string; start: number; end: number; onChange: (start: number, end: number) => void }) {
  return (
    <div className="af-time-window-grid grid gap-2">
      <span className="text-sm text-zinc-400">{props.label}</span>
      <HourSelect label={`${props.label}开始`} value={props.start} onChange={(value) => props.onChange(value, props.end)}/>
      <HourSelect label={`${props.label}结束`} value={props.end} onChange={(value) => props.onChange(props.start, value)}/>
    </div>
  );
}

function HourSelect(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Select aria-label={props.label} className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-200" value={props.value} onChange={(event) => props.onChange(Number(event.target.value))}>
      {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}
    </Select>
  );
}

function isNotificationPreference(value: unknown): value is NotificationPreferenceDto {
  if (!value || typeof value !== "object") return false;
  const pref = value as Partial<NotificationPreferenceDto>;
  return [pref.reviewDueEnabled, pref.planStartEnabled, pref.eveningReviewEnabled]
    .every((field) => typeof field === "boolean")
    && [
      pref.reviewDueWindowStart,
      pref.reviewDueWindowEnd,
      pref.planStartWindowStart,
      pref.planStartWindowEnd,
      pref.eveningReviewWindowStart,
      pref.eveningReviewWindowEnd,
      pref.revision,
    ].every((field) => typeof field === "number" && Number.isInteger(field))
    && (pref.quietHoursStart === null || typeof pref.quietHoursStart === "number")
    && (pref.quietHoursEnd === null || typeof pref.quietHoursEnd === "number");
}

function notificationPreferencesEqual(left: NotificationPreferenceDto, right: NotificationPreferenceDto): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function notificationConflictComparisons(conflict: NotificationConflict) {
  const labels: Record<keyof NotificationPreferenceDto, string> = {
    reviewDueEnabled: "复习到期提醒",
    planStartEnabled: "计划开始提醒",
    eveningReviewEnabled: "晚间复盘提醒",
    reviewDueWindowStart: "复习时间窗开始",
    reviewDueWindowEnd: "复习时间窗结束",
    planStartWindowStart: "计划时间窗开始",
    planStartWindowEnd: "计划时间窗结束",
    eveningReviewWindowStart: "晚间复盘开始",
    eveningReviewWindowEnd: "晚间复盘结束",
    quietHoursStart: "安静时段开始",
    quietHoursEnd: "安静时段结束",
    revision: "版本",
  };
  return (Object.keys(labels) as Array<keyof NotificationPreferenceDto>).map((field) => ({
    field,
    label: labels[field],
    baseline: conflict.baseline[field],
    local: conflict.submitted[field],
    server: conflict.latest[field],
  }));
}
