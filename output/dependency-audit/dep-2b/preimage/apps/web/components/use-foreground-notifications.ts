"use client";

import {
  buildForegroundNotificationPayload,
  sanitizeForegroundNotificationRoute,
  selectForegroundNotifications,
} from "@areaforge/core";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { AppShellStatusDto } from "@/lib/contracts";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/lib/client/storage-port";
import { formatDateKey } from "@/lib/formatters";

export function useForegroundNotifications(input: {
  status: AppShellStatusDto;
  suppressDistractions: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (input.suppressDistractions || document.visibilityState !== "visible" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const shanghaiNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const categories = selectForegroundNotifications({
      hour: shanghaiNow.getUTCHours(),
      preference: input.status.notificationPreference,
      candidates: input.status.notificationCandidates,
    });
    const date = formatDateKey(new Date());
    const category = categories.find((candidate) => {
      const key = notificationDedupeKey(input.status.workspaceId, date, candidate);
      return readBrowserStorageItem("local", key) !== "1";
    });
    if (!category) return;
    const payload = buildForegroundNotificationPayload(category);
    const notification = new Notification(
      readBrowserStorageItem("local", "af.notification.showSpecificTitle") === "1"
        ? payload.title
        : "AreaForge 提醒",
      {
        body: payload.body,
        tag: payload.tag,
        data: payload.data,
      },
    );
    writeBrowserStorageItem(
      "local",
      notificationDedupeKey(input.status.workspaceId, date, category),
      "1",
    );
    notification.onclick = () => {
      window.focus();
      router.push(sanitizeForegroundNotificationRoute(payload.data.route));
      notification.close();
    };
  }, [input.status, input.suppressDistractions, router]);
}

function notificationDedupeKey(workspaceId: string | null, date: string, category: string): string {
  return `af.notification.sent.${workspaceId ?? "setup"}.${date}.${category}`;
}
