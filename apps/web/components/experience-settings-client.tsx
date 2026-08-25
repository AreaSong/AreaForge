"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Radio, Select } from "@/components/ui/field";
import {
  defaultExperiencePreferences,
  loadExperiencePreferences,
  saveExperiencePreferences,
  type ExperiencePreferences,
} from "@/lib/client/experience-preferences";

export function ExperienceSettingsClient() {
  const [preferences, setPreferences] = useState<ExperiencePreferences>(defaultExperiencePreferences);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreferences(loadExperiencePreferences());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function update<K extends keyof ExperiencePreferences>(field: K, value: ExperiencePreferences[K]) {
    setSaved(false);
    setPreferences((current) => ({ ...current, [field]: value }));
  }

  return (
    <form
      className="max-w-2xl space-y-7"
      onSubmit={(event) => {
        event.preventDefault();
        saveExperiencePreferences(preferences);
        setSaved(true);
      }}
    >
      <fieldset className="space-y-3" disabled={!ready}>
        <legend className="text-sm font-medium text-white">主题</legend>
        <div className="af-content-grid-two grid gap-2">
          <Choice name="theme" label="标准深色" checked={preferences.theme === "standard"} onChange={() => update("theme", "standard")} />
          <Choice name="theme" label="纯黑高对比" checked={preferences.theme === "contrast"} onChange={() => update("theme", "contrast")} />
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={!ready}>
        <legend className="text-sm font-medium text-white">显示密度</legend>
        <div className="af-content-grid-two grid gap-2">
          <Choice name="density" label="舒适" checked={preferences.density === "comfortable"} onChange={() => update("density", "comfortable")} />
          <Choice name="density" label="紧凑" checked={preferences.density === "compact"} onChange={() => update("density", "compact")} />
        </div>
      </fieldset>

      <div className="af-content-grid-two grid gap-4">
        <Field label="文字比例" htmlFor="experience-text-scale">
          <Select id="experience-text-scale" disabled={!ready} value={preferences.textScale} onChange={(event) => update("textScale", event.target.value as ExperiencePreferences["textScale"])} className="h-11 bg-[#101419]">
            <option value="100">100%</option>
            <option value="112">112%</option>
            <option value="125">125%</option>
          </Select>
        </Field>
        <Field label="动画" htmlFor="experience-motion">
          <Select id="experience-motion" disabled={!ready} value={preferences.motion} onChange={(event) => update("motion", event.target.value as ExperiencePreferences["motion"])} className="h-11 bg-[#101419]">
            <option value="system">跟随系统</option>
            <option value="reduce">减少动画</option>
          </Select>
        </Field>
      </div>

      <Button type="submit" disabled={!ready} variant="primary" className="af-container-action bg-teal-500 text-black">
        保存体验设置
      </Button>
      <p className="text-sm text-teal-200" role="status" aria-live="polite">{saved ? "体验设置已保存到当前设备。" : ""}</p>
    </form>
  );
}

function Choice(props: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm ${props.checked ? "border-teal-400/60 text-teal-100" : "border-white/10 text-zinc-300"}`}>
      <Radio name={props.name} checked={props.checked} onChange={props.onChange} />
      {props.label}
    </label>
  );
}
