"use client";

import { useCallback, useEffect, useState } from "react";
import { evaluateAutomaticMotivationGate } from "@areaforge/core";
import {
  MOTIVATION_REMINDER_PREFERENCE_EVENT,
  motivationReminderPreferenceKey,
  readMotivationReminderPreference,
} from "@/lib/client/motivation-reminder-preference";
import type { AppShellStatusDto } from "@/lib/study/app-shell-service";

export function useShellRecovery(input: {
  userId: string;
  workspaceId: string | null;
  suppressDistractions: boolean;
  reminderCandidate: AppShellStatusDto["motivationReminderCandidate"];
  openTool: (key: "recovery-help") => void;
}) {
  const { userId, workspaceId, suppressDistractions, reminderCandidate, openTool } = input;
  const [source, setSource] = useState<"manual" | "automatic">("manual");
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (suppressDistractions || !workspaceId) return;
    let cancelled = false;
    const cooldownKey = `af.motivation.auto.next.${workspaceId}`;

    async function showAutomaticReminder() {
      const preference = readMotivationReminderPreference(userId);
      const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
      const clientGate = evaluateAutomaticMotivationGate({
        enabled: preference.enabled,
        hour: shanghaiNow.getUTCHours(),
        windowStart: preference.windowStart,
        windowEnd: preference.windowEnd,
        visible: document.visibilityState === "visible",
        immersive: suppressDistractions,
        hasActiveActivity: reminderCandidate.blockedByActiveActivity,
        trigger: reminderCandidate.trigger,
      });
      if (!clientGate.allowed) return;
      const nextEligibleAt = Number(readLocalStorage(cooldownKey) ?? "0");
      if (Number.isFinite(nextEligibleAt) && nextEligibleAt > Date.now()) return;

      try {
        const response = await fetch("/api/motivation/next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "automatic" }),
        });
        const body = (await response.json().catch(() => null)) as
          | { item?: { title?: string; body?: string | null; externalUrl?: string | null } | null; reminderAllowed?: boolean }
          | null;
        if (!response.ok || cancelled) return;

        const cooldown = body?.reminderAllowed ? 4 * 60 * 60 * 1000 : 15 * 60 * 1000;
        writeLocalStorage(cooldownKey, String(Date.now() + cooldown));
        if (!body?.reminderAllowed || !body.item) return;

        setError(null);
        setLine(body.item.body ?? body.item.title ?? null);
        setUrl(body.item.externalUrl ?? null);
        setSource("automatic");
        // Automatic motivation stays non-blocking. The toolbar marks the
        // available reminder; only an explicit user action opens the tool.
      } catch {
        // Automatic recovery remains non-blocking when its content is unavailable.
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void showAutomaticReminder();
    };
    const onPreferenceChange = () => void showAutomaticReminder();
    const onStorage = (event: StorageEvent) => {
      if (event.key === motivationReminderPreferenceKey(userId)) void showAutomaticReminder();
    };
    void showAutomaticReminder();
    const interval = window.setInterval(() => void showAutomaticReminder(), 60_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(MOTIVATION_REMINDER_PREFERENCE_EVENT, onPreferenceChange);
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(MOTIVATION_REMINDER_PREFERENCE_EVENT, onPreferenceChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [reminderCandidate, suppressDistractions, userId, workspaceId]);

  const open = useCallback(async () => {
    setError(null);
    setLine(null);
    setUrl(null);
    setSource("manual");
    openTool("recovery-help");
    try {
      const response = await fetch("/api/motivation/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "manual" }),
      });
      const body = (await response.json().catch(() => null)) as
        | { item?: { title?: string; body?: string | null; externalUrl?: string | null }; error?: string }
        | null;
      if (!response.ok) {
        setError(body?.error ?? "无法加载动机内容");
        return;
      }
      if (body?.item) {
        setLine(body.item.body ?? body.item.title ?? null);
        setUrl(body.item.externalUrl ?? null);
      } else {
        setLine("内容库为空。可到设置 → 档案添加语录。");
      }
    } catch {
      setError("无法加载动机内容");
    }
  }, [openTool]);

  return { source, error, line, url, open, hasAutomaticReminder: source === "automatic" && Boolean(line || url) };
}

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Optional cooldown state must not block recovery.
  }
}
