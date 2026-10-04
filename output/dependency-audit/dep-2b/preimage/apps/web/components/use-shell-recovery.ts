"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { evaluateAutomaticMotivationGate } from "@areaforge/core";
import {
  MOTIVATION_REMINDER_PREFERENCE_EVENT,
  motivationReminderPreferenceKey,
  readMotivationReminderPreference,
} from "@/lib/client/motivation-reminder-preference";
import { requestMotivationNext } from "@/lib/api/motivation";
import type { AppShellStatusDto } from "@/lib/contracts";
import { getBrowserStoragePort } from "@/lib/client/storage-port";
import { createLatestOperationGate } from "@/lib/client/operation-gates";

export function useShellRecovery(input: {
  userId: string;
  workspaceId: string | null;
  suppressDistractions: boolean;
  reminderCandidate: AppShellStatusDto["motivationReminderCandidate"];
  openTool: (key: "recovery-help") => void;
}) {
  const { userId, workspaceId, suppressDistractions, reminderCandidate, openTool } = input;
  const [automaticContent, setAutomaticContent] = useState<RecoveryContent>(EMPTY_RECOVERY_CONTENT);
  const [manualContent, setManualContent] = useState<RecoveryContent>(EMPTY_RECOVERY_CONTENT);
  const [manualActive, setManualActive] = useState(false);
  const manualRequestGateRef = useRef(createLatestOperationGate());

  useEffect(() => () => {
    manualRequestGateRef.current.invalidate();
  }, []);

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
        const response = await requestMotivationNext("automatic");
        const body = response.body;
        if (!response.ok || cancelled) return;

        const cooldown = body?.reminderAllowed ? 4 * 60 * 60 * 1000 : 15 * 60 * 1000;
        writeLocalStorage(cooldownKey, String(Date.now() + cooldown));
        if (!body?.reminderAllowed || !body.item) return;

        setAutomaticContent({
          error: null,
          line: body.item.body ?? body.item.title ?? null,
          url: body.item.externalUrl ?? null,
        });
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
    const requestToken = manualRequestGateRef.current.begin();
    setManualActive(true);
    setManualContent(EMPTY_RECOVERY_CONTENT);
    openTool("recovery-help");
    try {
      const response = await requestMotivationNext("manual");
      if (!manualRequestGateRef.current.isCurrent(requestToken)) return;
      const body = response.body;
      if (!response.ok) {
        setManualContent({ error: body?.error ?? "无法加载动机内容", line: null, url: null });
        return;
      }
      if (body?.item) {
        setManualContent({
          error: null,
          line: body.item.body ?? body.item.title ?? null,
          url: body.item.externalUrl ?? null,
        });
      } else {
        setManualContent({ error: null, line: "内容库为空。可到设置 → 档案添加语录。", url: null });
      }
    } catch {
      if (manualRequestGateRef.current.isCurrent(requestToken)) {
        setManualContent({ error: "无法加载动机内容", line: null, url: null });
      }
    } finally {
      manualRequestGateRef.current.finish(requestToken);
    }
  }, [openTool]);

  const automaticAvailable = Boolean(automaticContent.line || automaticContent.url);
  const selected = manualActive ? manualContent : automaticContent;
  return {
    source: manualActive || !automaticAvailable ? "manual" as const : "automatic" as const,
    ...selected,
    open,
    hasAutomaticReminder: !manualActive && automaticAvailable,
  };
}

interface RecoveryContent {
  error: string | null;
  line: string | null;
  url: string | null;
}

const EMPTY_RECOVERY_CONTENT: RecoveryContent = { error: null, line: null, url: null };

function readLocalStorage(key: string): string | null {
  try {
    return getBrowserStoragePort("local")?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    getBrowserStoragePort("local")?.setItem(key, value);
  } catch {
    // Optional cooldown state must not block recovery.
  }
}
