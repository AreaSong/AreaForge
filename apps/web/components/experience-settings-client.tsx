"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { Checkbox, Field, Input, Radio, Select } from "@/components/ui/field";
import { SectionHeader } from "@/components/ui/page";
import {
  defaultCloseoutPreferences,
  loadCloseoutPreferences,
  saveCloseoutPreferences,
  type CloseoutPreferences,
} from "@/lib/client/closeout-preferences";
import {
  defaultExperiencePreferences,
  loadExperiencePreferences,
  saveExperiencePreferences,
  type ExperiencePreferences,
} from "@/lib/client/experience-preferences";

export function ExperienceSettingsClient() {
  const [preferences, setPreferences] = useState<ExperiencePreferences>(defaultExperiencePreferences);
  const [closeoutPreferences, setCloseoutPreferences] = useState<CloseoutPreferences>(defaultCloseoutPreferences);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreferences(loadExperiencePreferences());
      setCloseoutPreferences(loadCloseoutPreferences());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function update<K extends keyof ExperiencePreferences>(field: K, value: ExperiencePreferences[K]) {
    setSaved(false);
    setPreferences((current) => ({ ...current, [field]: value }));
  }

  function updateCloseout<K extends keyof CloseoutPreferences>(field: K, value: CloseoutPreferences[K]) {
    setSaved(false);
    setCloseoutPreferences((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="space-y-6">
    <SectionCard variant="master" className="space-y-6">
      <SectionHeader
        title="界面显示偏好"
        description="这些设置只影响当前设备的显示与交互，不跨设备同步。"
      />

      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          saveExperiencePreferences(preferences);
          saveCloseoutPreferences(closeoutPreferences);
          setSaved(true);
        }}
      >
        <fieldset className="space-y-3" disabled={!ready}>
          <legend className="text-sm font-medium text-white">主题模式</legend>
          <div className="af-content-grid-two grid gap-3">
            <Choice name="theme" label="标准深色" checked={preferences.theme === "standard"} onChange={() => update("theme", "standard")} />
            <Choice name="theme" label="纯黑高对比" checked={preferences.theme === "contrast"} onChange={() => update("theme", "contrast")} />
          </div>
        </fieldset>

        <fieldset className="space-y-3" disabled={!ready}>
          <legend className="text-sm font-medium text-white">显示密度</legend>
          <div className="af-content-grid-two grid gap-3">
            <Choice name="density" label="舒适" checked={preferences.density === "comfortable"} onChange={() => update("density", "comfortable")} />
            <Choice name="density" label="紧凑" checked={preferences.density === "compact"} onChange={() => update("density", "compact")} />
          </div>
        </fieldset>

        <div className="af-content-grid-two grid gap-4">
          <Field label="文字比例" htmlFor="experience-text-scale">
            <Select
              id="experience-text-scale"
              disabled={!ready}
              value={preferences.textScale}
              onChange={(event) => update("textScale", event.target.value as ExperiencePreferences["textScale"])}
              className="h-11"
            >
              <option value="100">100%</option>
              <option value="112">112%</option>
              <option value="125">125%</option>
            </Select>
          </Field>
          <Field label="动画控制" htmlFor="experience-motion">
            <Select
              id="experience-motion"
              disabled={!ready}
              value={preferences.motion}
              onChange={(event) => update("motion", event.target.value as ExperiencePreferences["motion"])}
              className="h-11"
            >
              <option value="system">跟随系统</option>
              <option value="reduce">减少动画</option>
            </Select>
          </Field>
        </div>

        <div className="border-t border-white/10 pt-6">
          <SectionHeader
            title="学习收口模板"
            description="只保存字段提示和展开方式，不会预填或生成任何学习事实。"
          />
          <div className="mt-4 grid gap-4">
            <Field label="实际产出提示" htmlFor="closeout-output-prompt">
              <Input
                id="closeout-output-prompt"
                disabled={!ready}
                maxLength={160}
                value={closeoutPreferences.outputPrompt}
                onChange={(event) => updateCloseout("outputPrompt", event.target.value)}
              />
            </Field>
            <Field label="下一动作提示" htmlFor="closeout-next-action-prompt">
              <Input
                id="closeout-next-action-prompt"
                disabled={!ready}
                maxLength={160}
                value={closeoutPreferences.nextActionPrompt}
                onChange={(event) => updateCloseout("nextActionPrompt", event.target.value)}
              />
            </Field>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 text-sm text-zinc-300">
              <Checkbox
                disabled={!ready}
                checked={closeoutPreferences.expandOptionalReview}
                onChange={(event) => updateCloseout("expandOptionalReview", event.target.checked)}
              />
              默认展开理解程度、专注度与补充备注
            </label>
          </div>
        </div>

        <div className="flex items-center gap-4 pt-2">
          <Button type="submit" disabled={!ready} variant="primary">
            保存体验设置
          </Button>
          {saved ? (
            <span className="text-sm text-teal-300" role="status" aria-live="polite">
              体验设置已保存到当前设备。
            </span>
          ) : null}
        </div>
      </form>
    </SectionCard>
    </div>
  );
}

function Choice(props: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 text-sm transition-colors ${props.checked ? "border-teal-400/60 bg-teal-500/10 text-teal-100 font-medium" : "border-white/10 bg-white/[0.02] text-zinc-300 hover:bg-white/[0.04]"}`}>
      <Radio name={props.name} checked={props.checked} onChange={props.onChange} />
      {props.label}
    </label>
  );
}
