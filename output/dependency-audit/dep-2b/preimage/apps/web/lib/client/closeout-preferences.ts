import { getBrowserStoragePort } from "@/lib/client/storage-port";

export const CLOSEOUT_PREFERENCES_KEY = "areaforge.closeout.preferences.v1";

export interface CloseoutPreferences {
  version: 1;
  outputPrompt: string;
  nextActionPrompt: string;
  expandOptionalReview: boolean;
}

export const defaultCloseoutPreferences: CloseoutPreferences = {
  version: 1,
  outputPrompt: "例如：写清本次理解的概念、完成的题目或留下的可复核产出",
  nextActionPrompt: "例如：下一次从哪一页、哪道题或哪个知识点继续",
  expandOptionalReview: false,
};

export function loadCloseoutPreferences(): CloseoutPreferences {
  try {
    const value = JSON.parse(
      getBrowserStoragePort("local")?.getItem(CLOSEOUT_PREFERENCES_KEY) ?? "null",
    );
    return parseCloseoutPreferences(value) ?? defaultCloseoutPreferences;
  } catch {
    return defaultCloseoutPreferences;
  }
}

export function saveCloseoutPreferences(preferences: CloseoutPreferences): void {
  const normalized = parseCloseoutPreferences(preferences);
  if (!normalized) return;
  getBrowserStoragePort("local")?.setItem(CLOSEOUT_PREFERENCES_KEY, JSON.stringify(normalized));
}

export function parseCloseoutPreferences(value: unknown): CloseoutPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CloseoutPreferences>;
  if (
    candidate.version !== 1
    || typeof candidate.outputPrompt !== "string"
    || typeof candidate.nextActionPrompt !== "string"
    || typeof candidate.expandOptionalReview !== "boolean"
  ) {
    return null;
  }
  const outputPrompt = candidate.outputPrompt.trim();
  const nextActionPrompt = candidate.nextActionPrompt.trim();
  if (!outputPrompt || outputPrompt.length > 160 || !nextActionPrompt || nextActionPrompt.length > 160) {
    return null;
  }
  return {
    version: 1,
    outputPrompt,
    nextActionPrompt,
    expandOptionalReview: candidate.expandOptionalReview,
  };
}
