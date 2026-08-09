"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const storageKey = "areaforge.list-return.v2";
const maxRecordAgeMs = 30 * 60 * 1000;
const maxRecords = 20;

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
        const useDesktopDestination = Boolean(props.desktopHref && window.matchMedia("(min-width: 1024px)").matches);
        const targetHref = useDesktopDestination ? props.desktopHref! : props.href;
        if (useDesktopDestination && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          router.push(targetHref);
          return;
        }
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
      }}
    >
      {props.children}
    </Link>
  );
}

export function BackToListLink(props: { fallbackHref: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={props.fallbackHref}
      className={props.className}
      onClick={(event) => {
        const record = readRecordForDestination(currentUrl());
        if (!record || !sourceIsSameOrigin(record.sourceUrl) || window.history.length <= 1) return;
        event.preventDefault();
        window.location.replace(record.sourceUrl);
      }}
    >
      {props.children}
    </Link>
  );
}

export function useRestoreListReturn() {
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
  }, []);
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
    window.sessionStorage.setItem(storageKey, JSON.stringify(records));
  } catch {
    // Navigation still works when private storage is unavailable.
  }
}

function removeRecord(destinationUrl: string) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(readRecords().filter((record) => record.destinationUrl !== destinationUrl)));
  } catch {
    // Nothing else needs cleanup when private storage is unavailable.
  }
}

function readRecords(): ListReturnRecord[] {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    const now = Date.now();
    return value.filter((entry): entry is ListReturnRecord => isRecord(entry) && now - entry.createdAt <= maxRecordAgeMs);
  } catch {
    window.sessionStorage.removeItem(storageKey);
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
