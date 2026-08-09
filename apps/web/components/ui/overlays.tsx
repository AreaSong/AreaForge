"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal(props: {
  open: boolean;
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  allowEscape?: boolean;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { open, allowEscape = true, onClose, title, children, returnFocusRef } = props;
  const dismissible = typeof onClose === "function";
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useOverlayFocus({
    open,
    panelRef,
    allowEscape: allowEscape && dismissible,
    onClose: () => onCloseRef.current?.(),
    returnFocusRef,
  });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--af-layer-modal)] flex items-end justify-center bg-black/60 p-2 sm:items-center sm:p-4" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-hidden="true" tabIndex={-1} onClick={allowEscape && dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col rounded-lg border border-white/10 bg-[#101419] p-4 shadow-xl sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
          {dismissible ? (
            <button
              type="button"
              className="rounded-md border border-white/10 px-2 py-1 text-sm text-zinc-300 hover:bg-white/10"
              onClick={onClose}
            >
              关闭
            </button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Drawer(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { open, onClose, title, children } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useOverlayFocus({ open, panelRef, allowEscape: true, onClose: () => onCloseRef.current() });

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--af-layer-modal)] flex justify-end bg-black/50" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0d1117] p-4 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            className="rounded-md border border-white/10 px-2 py-1 text-sm text-zinc-300 hover:bg-white/10"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

function useOverlayFocus<T extends HTMLElement>(input: {
  open: boolean;
  panelRef: React.RefObject<T | null>;
  allowEscape: boolean;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef(input.onClose);

  useEffect(() => {
    closeRef.current = input.onClose;
  }, [input.onClose]);

  useEffect(() => {
    if (!input.open) return;
    const panel = input.panelRef.current;
    if (!panel) return;
    const activePanel: T = panel;
    const explicitReturnTarget = input.returnFocusRef?.current;
    const returnTarget = explicitReturnTarget?.isConnected
      ? explicitReturnTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    function focusInitialTarget(): void {
      const initialTarget = getFocusableElements(activePanel)[0] ?? activePanel;
      initialTarget.focus();
    }

    focusInitialTarget();

    function onFocusIn(event: FocusEvent): void {
      if (activePanel.contains(event.target as Node)) return;
      focusInitialTarget();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && input.allowEscape) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = getFocusableElements(activePanel);
      if (elements.length === 0) {
        event.preventDefault();
        activePanel.focus();
        return;
      }
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !activePanel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !activePanel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey);
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [input.open, input.allowEscape, input.panelRef, input.returnFocusRef]);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true" && element.tabIndex >= 0,
  );
}
