"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const activeFocusScopes: symbol[] = [];

type FocusKeyEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">;

export function usePortalReady(): boolean {
  return useSyncExternalStore(noopSubscribe, getClientPortalSnapshot, getServerPortalSnapshot);
}

const noopSubscribe = () => () => {};
const getClientPortalSnapshot = () => true;
const getServerPortalSnapshot = () => false;

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => element.tabIndex >= 0
      && element.getClientRects().length > 0
      && !element.closest('[inert], [aria-hidden="true"]'),
  );
}

export function focusInitialElement(
  container: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const preferred = initialFocusRef?.current;
  const target = preferred?.isConnected && container.contains(preferred)
    ? preferred
    : getFocusableElements(container)[0] ?? container;
  target.focus({ preventScroll: true });
}

export function trapFocus(event: FocusKeyEvent, container: HTMLElement | null): void {
  if (!container || event.key !== "Tab") return;
  const elements = getFocusableElements(container);
  if (elements.length === 0) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }

  const first = elements[0]!;
  const last = elements[elements.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

export function useFocusScope(input: {
  active: boolean;
  panelRef: RefObject<HTMLElement | null>;
  allowEscape?: boolean;
  onEscape?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
}): void {
  const onEscapeRef = useRef(input.onEscape);

  useEffect(() => {
    onEscapeRef.current = input.onEscape;
  }, [input.onEscape]);

  useEffect(() => {
    if (!input.active) return;
    const panel = input.panelRef.current;
    if (!panel) return;
    const scopeId = Symbol("focus-scope");
    activeFocusScopes.push(scopeId);
    const ownsFocus = () => activeFocusScopes.at(-1) === scopeId;
    const explicitReturnTarget = input.returnFocusRef?.current;
    const returnTarget = explicitReturnTarget?.isConnected
      ? explicitReturnTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTimer = window.setTimeout(
      () => {
        if (ownsFocus()) focusInitialElement(panel, input.initialFocusRef);
      },
      0,
    );

    const onFocusIn = (event: FocusEvent): void => {
      if (!ownsFocus()) return;
      if (panel.contains(event.target as Node)) return;
      focusInitialElement(panel, input.initialFocusRef);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!ownsFocus()) return;
      if (event.key === "Escape" && input.allowEscape && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      trapFocus(event, panel);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      const wasTopScope = ownsFocus();
      const scopeIndex = activeFocusScopes.lastIndexOf(scopeId);
      if (scopeIndex >= 0) activeFocusScopes.splice(scopeIndex, 1);
      window.clearTimeout(focusTimer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      if (wasTopScope && input.restoreFocus !== false && returnTarget?.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    };
  }, [
    input.active,
    input.allowEscape,
    input.initialFocusRef,
    input.panelRef,
    input.restoreFocus,
    input.returnFocusRef,
  ]);
}
