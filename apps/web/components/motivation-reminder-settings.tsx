"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_MOTIVATION_REMINDER_PREFERENCE,
  readMotivationReminderPreference,
  writeMotivationReminderPreference,
  type MotivationReminderPreference,
} from "@/lib/client/motivation-reminder-preference";

export function MotivationReminderSettings({ userId }: { userId: string }) {
  const [preference, setPreference] = useState<MotivationReminderPreference>(DEFAULT_MOTIVATION_REMINDER_PREFERENCE);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreference(readMotivationReminderPreference(userId));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  function save() {
    writeMotivationReminderPreference(userId, preference);
    setSaved(true);
  }

  return (
    <div className="space-y-4 rounded-lg border border-white/10 p-4">
      <h2 className="text-base font-medium text-white">自动动机提醒</h2>
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={preference.enabled}
          disabled={!ready}
          onChange={(event) => {
            setSaved(false);
            setPreference((current) => ({ ...current, enabled: event.target.checked }));
          }}
        />
        在当前设备启用
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(9rem,1fr)_8rem_8rem] sm:items-center">
        <span className="text-sm text-zinc-400">允许展示时间窗</span>
        <HourSelect label="动机提醒开始" value={preference.windowStart} onChange={(windowStart) => {
          setSaved(false);
          setPreference((current) => ({ ...current, windowStart }));
        }} />
        <HourSelect label="动机提醒结束" value={preference.windowEnd} onChange={(windowEnd) => {
          setSaved(false);
          setPreference((current) => ({ ...current, windowEnd }));
        }} />
      </div>
      <p className="text-xs text-zinc-500">仅保存在当前设备；未启用时不会发起自动提醒请求。</p>
      {saved ? <p className="text-sm text-emerald-300" role="status">当前设备偏好已保存</p> : null}
      <button
        type="button"
        disabled={!ready}
        className="h-10 rounded-md bg-teal-500/90 px-4 text-sm font-medium text-black disabled:opacity-50"
        onClick={save}
      >
        保存当前设备偏好
      </button>
    </div>
  );
}

function HourSelect(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <select
      aria-label={props.label}
      className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-200"
      value={props.value}
      onChange={(event) => props.onChange(Number(event.target.value))}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
      ))}
    </select>
  );
}
