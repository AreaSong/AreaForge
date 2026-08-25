import { getBrowserStoragePort } from "@/lib/client/storage-port";

export const EXPERIENCE_PREFERENCES_KEY = "areaforge.experience.preferences.v1";

export interface ExperiencePreferences {
  version: 1;
  theme: "standard" | "contrast";
  density: "comfortable" | "compact";
  textScale: "100" | "112" | "125";
  motion: "system" | "reduce";
}

export const defaultExperiencePreferences: ExperiencePreferences = {
  version: 1,
  theme: "standard",
  density: "comfortable",
  textScale: "100",
  motion: "system",
};

export function loadExperiencePreferences(): ExperiencePreferences {
  try {
    const value = JSON.parse(getBrowserStoragePort("local")?.getItem(EXPERIENCE_PREFERENCES_KEY) ?? "null");
    return isExperiencePreferences(value) ? value : defaultExperiencePreferences;
  } catch {
    return defaultExperiencePreferences;
  }
}

export function saveExperiencePreferences(preferences: ExperiencePreferences): void {
  getBrowserStoragePort("local")?.setItem(EXPERIENCE_PREFERENCES_KEY, JSON.stringify(preferences));
  applyExperiencePreferences(preferences);
}

export function applyExperiencePreferences(preferences: ExperiencePreferences): void {
  const root = document.documentElement;
  root.dataset.afTheme = preferences.theme;
  root.dataset.afDensity = preferences.density;
  root.dataset.afTextScale = preferences.textScale;
  root.dataset.afMotion = preferences.motion;
}

function isExperiencePreferences(value: unknown): value is ExperiencePreferences {
  if (!value || typeof value !== "object") return false;
  const preferences = value as Partial<ExperiencePreferences>;
  return preferences.version === 1
    && (preferences.theme === "standard" || preferences.theme === "contrast")
    && (preferences.density === "comfortable" || preferences.density === "compact")
    && ["100", "112", "125"].includes(preferences.textScale ?? "")
    && (preferences.motion === "system" || preferences.motion === "reduce");
}
