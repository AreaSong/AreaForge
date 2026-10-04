"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getBrowserStoragePort } from "@/lib/client/storage-port";

const storageKey = "areaforge.list-return.v2";
const maxRecordAgeMs = 30 * 60 * 1000;
const maxRecords = 20;
/** The split-view container starts at the same 60rem budget as the page CSS. */
export const desktopListContainerMinWidth = 60 * 16;

export function isDesktopListContainerWide(width: number): boolean {
  return Number.isFinite(width) && width >= desktopListContainerMinWidth;
}

interface ListReturnRecord {
  sourceUrl: string;
  destinationUrl: string;
  scrollY: number;
  focusId: string;
  createdAt: number;
}

export function ListDetailLink(props: {
  href: string;
  desktopHref?: string;
  focusId: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Link
      href={props.href}
      data-return-focus={props.focusId}
      className={props.className}
      onClick={(event) => {
        const hasDesktopContainer = Boolean(props.desktopHref && shouldUseDesktopListDestination(event.currentTarget));
        const useClientNavigation = hasDesktopContainer
          && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
        const targetHref = hasDesktopContainer ? props.desktopHref! : props.href;
        const destination = new URL(targetHref, window.location.href);
        if (destination.origin !== window.location.origin) return;
        const record: ListReturnRecord = {
          sourceUrl: currentUrl(),
          destinationUrl: `${destination.pathname}${destination.search}`,
          scrollY: window.scrollY,
          focusId: props.focusId,
          createdAt: Date.now(),
        };
        writeRecord(record);
        if (useClientNavigation) {
          event.preventDefault();
          router.push(targetHref);
        }
      }}
    >
      {props.children}
    </Link>
  );
}

/**
 * Resolve the desktop detail target from the nearest content budget.  The
 * shell viewport is intentionally ignored because side rails and embedded
 * workbench panels can leave a much smaller usable width.
 */
export function shouldUseDesktopListDestination(element: Element): boolean {
  const container = element.closest<HTMLElement>(
    '[data-layout-region="page-frame"], [data-layout-region="page-content"]',
  );
  if (!container) return false;
  const rectWidth = container.getBoundingClientRect().width;
  const width = Math.max(container.clientWidth, Number.isFinite(rectWidth) ? rectWidth : 0);
  return isDesktopListContainerWide(width);
}

export function BackToListLink(props: { fallbackHref: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <Link
      href={props.fallbackHref}
      className={props.className}
      onClick={(event) => {
        const record = readRecordForDestination(currentUrl());
        if (!record || !sourceIsSameOrigin(record.sourceUrl) || window.history.length <= 1) return;
        event.preventDefault();
        router.replace(record.sourceUrl);
      }}
    >
      {props.children}
    </Link>
  );
}

export function useRestoreListReturn(navigationKey?: string) {
  useEffect(() => {
    const record = readRecordForSource(currentUrl());
    if (!record) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: record.scrollY });
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-return-focus]"))
        .find((element) => element.dataset.returnFocus === record.focusId);
      target?.focus({ preventScroll: true });
      removeRecord(record.destinationUrl);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationKey]);
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function readRecordForDestination(destinationUrl: string): ListReturnRecord | null {
  return readRecords().find((record) => record.destinationUrl === destinationUrl) ?? null;
}

function readRecordForSource(sourceUrl: string): ListReturnRecord | null {
  return readRecords().find((record) => record.sourceUrl === sourceUrl) ?? null;
}

function sourceIsSameOrigin(sourceUrl: string): boolean {
  try {
    const source = new URL(sourceUrl, window.location.origin);
    return source.origin === window.location.origin;
  } catch {
    return false;
  }
}

function writeRecord(record: ListReturnRecord) {
  const records = [record, ...readRecords().filter((entry) => entry.destinationUrl !== record.destinationUrl)].slice(0, maxRecords);
  try {
    getBrowserStoragePort("session")?.setItem(storageKey, JSON.stringify(records));
  } catch {
    // Navigation still works when private storage is unavailable.
  }
}

function removeRecord(destinationUrl: string) {
  try {
    getBrowserStoragePort("session")?.setItem(storageKey, JSON.stringify(readRecords().filter((record) => record.destinationUrl !== destinationUrl)));
  } catch {
    // Nothing else needs cleanup when private storage is unavailable.
  }
}

function readRecords(): ListReturnRecord[] {
  try {
    const value = JSON.parse(getBrowserStoragePort("session")?.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    const now = Date.now();
    return value.filter((entry): entry is ListReturnRecord => isRecord(entry) && now - entry.createdAt <= maxRecordAgeMs);
  } catch {
    getBrowserStoragePort("session")?.removeItem(storageKey);
    return [];
  }
}

function isRecord(value: unknown): value is ListReturnRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ListReturnRecord>;
  return typeof record.sourceUrl === "string"
    && typeof record.destinationUrl === "string"
    && typeof record.scrollY === "number"
    && typeof record.focusId === "string"
    && typeof record.createdAt === "number";
}
