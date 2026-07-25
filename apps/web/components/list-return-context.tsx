"use client";

import Link from "next/link";
import { useEffect } from "react";

const storageKey = "areaforge.list-return.v1";

interface ListReturnRecord {
  url: string;
  scrollY: number;
  focusId: string;
}

export function ListDetailLink(props: {
  href: string;
  focusId: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={props.href}
      data-return-focus={props.focusId}
      className={props.className}
      onClick={() => {
        const record: ListReturnRecord = {
          url: `${window.location.pathname}${window.location.search}`,
          scrollY: window.scrollY,
          focusId: props.focusId,
        };
        window.sessionStorage.setItem(storageKey, JSON.stringify(record));
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
        const record = readRecord();
        if (!record || window.history.length <= 1) return;
        event.preventDefault();
        window.history.back();
      }}
    >
      {props.children}
    </Link>
  );
}

export function useRestoreListReturn() {
  useEffect(() => {
    const record = readRecord();
    if (!record || record.url !== `${window.location.pathname}${window.location.search}`) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: record.scrollY });
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-return-focus]"))
        .find((element) => element.dataset.returnFocus === record.focusId);
      target?.focus({ preventScroll: true });
      window.sessionStorage.removeItem(storageKey);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
}

function readRecord(): ListReturnRecord | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as Partial<ListReturnRecord> | null;
    if (!value || typeof value.url !== "string" || typeof value.scrollY !== "number" || typeof value.focusId !== "string") return null;
    return value as ListReturnRecord;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return null;
  }
}
