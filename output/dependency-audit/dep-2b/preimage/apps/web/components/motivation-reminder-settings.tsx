"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, SectionCard } from "@/components/ui/card";
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
    <SectionCard variant="master" className="space-y-5">
      <SectionHeader
        title="当前设备动机提醒"
        description="只控制这台设备的展示时间窗；关闭时不会发起自动提醒请求。"
      />
      <label className="flex items-center gap-2.5 text-sm text-zinc-200 font-medium">
        <Checkbox
          checked={preference.enabled}
          disabled={!ready}
          onChange={(event) => {
            setSaved(false);
            setPreference((current) => ({ ...current, enabled: event.target.checked }));
          }}
        />
        在当前设备启用动机提醒
      </label>

      <div className="af-time-window-grid grid gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <span className="text-xs font-medium text-zinc-400">允许展示时间窗</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HourSelect
            label="动机提醒开始"
            value={preference.windowStart}
            onChange={(windowStart) => {
              setSaved(false);
              setPreference((current) => ({ ...current, windowStart }));
            }}
          />
          <HourSelect
            label="动机提醒结束"
            value={preference.windowEnd}
            onChange={(windowEnd) => {
              setSaved(false);
              setPreference((current) => ({ ...current, windowEnd }));
            }}
          />
        </div>
      </div>

      <p className="text-xs text-zinc-500">偏好仅保存在当前浏览器，不会同步到其他设备。</p>
      {saved ? <Alert tone="success">当前设备偏好已保存。</Alert> : null}

      <div className="pt-2">
        <Button
          type="button"
          disabled={!ready}
          variant="secondary"
          onClick={save}
        >
          保存设备提醒偏好
        </Button>
      </div>
    </SectionCard>
  );
}

function HourSelect(props: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs text-zinc-400">
      <span className="mb-1 block">{props.label}</span>
      <Select
        aria-label={props.label}
        className="h-10"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
        ))}
      </Select>
    </label>
  );
}
