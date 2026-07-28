"use client";

import { useEffect, useState } from "react";
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
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice name="theme" label="标准深色" checked={preferences.theme === "standard"} onChange={() => update("theme", "standard")} />
          <Choice name="theme" label="纯黑高对比" checked={preferences.theme === "contrast"} onChange={() => update("theme", "contrast")} />
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={!ready}>
        <legend className="text-sm font-medium text-white">显示密度</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice name="density" label="舒适" checked={preferences.density === "comfortable"} onChange={() => update("density", "comfortable")} />
          <Choice name="density" label="紧凑" checked={preferences.density === "compact"} onChange={() => update("density", "compact")} />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-zinc-300">
          文字比例
          <select className="h-11 rounded-md border border-white/10 bg-[#101419] px-3" disabled={!ready} value={preferences.textScale} onChange={(event) => update("textScale", event.target.value as ExperiencePreferences["textScale"])}>
            <option value="100">100%</option>
            <option value="112">112%</option>
            <option value="125">125%</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm text-zinc-300">
          动画
          <select className="h-11 rounded-md border border-white/10 bg-[#101419] px-3" disabled={!ready} value={preferences.motion} onChange={(event) => update("motion", event.target.value as ExperiencePreferences["motion"])}>
            <option value="system">跟随系统</option>
            <option value="reduce">减少动画</option>
          </select>
        </label>
      </div>

      <button type="submit" disabled={!ready} className="h-11 rounded-md bg-teal-500 px-4 text-sm font-medium text-black disabled:opacity-50">
        保存体验设置
      </button>
      <p className="text-sm text-teal-200" role="status" aria-live="polite">{saved ? "体验设置已保存到当前设备。" : ""}</p>
    </form>
  );
}

function Choice(props: { name: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`flex h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm ${props.checked ? "border-teal-400/60 text-teal-100" : "border-white/10 text-zinc-300"}`}>
      <input type="radio" name={props.name} checked={props.checked} onChange={props.onChange} />
      {props.label}
    </label>
  );
}
