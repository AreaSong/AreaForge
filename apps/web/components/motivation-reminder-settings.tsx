"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/ui/page";
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
    <section className="space-y-5 border-t border-white/10 pt-6">
      <SectionHeader
        title="当前设备提醒"
        description="只控制这台设备的展示时间窗；关闭时不会发起自动提醒请求。"
      />
      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <Checkbox
          checked={preference.enabled}
          disabled={!ready}
          onChange={(event) => {
            setSaved(false);
            setPreference((current) => ({ ...current, enabled: event.target.checked }));
          }}
        />
        在当前设备启用
      </label>
      <div className="af-time-window-grid grid gap-2">
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
      <p className="text-xs text-zinc-500">偏好仅保存在当前浏览器，不会同步到其他设备。</p>
      {saved ? <Alert tone="success">当前设备偏好已保存。</Alert> : null}
      <Button
        type="button"
        disabled={!ready}
        variant="secondary"
        onClick={save}
      >
        保存当前设备偏好
      </Button>
    </section>
  );
}

function HourSelect(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <Select
      aria-label={props.label}
      className="h-10 rounded-md border border-white/10 bg-[#0d1117] px-3 text-sm text-zinc-200"
      value={props.value}
      onChange={(event) => props.onChange(Number(event.target.value))}
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
      ))}
    </Select>
  );
}
