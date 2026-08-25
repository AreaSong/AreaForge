"use client";

import { X } from "lucide-react";
import { forwardRef, useId, useRef, type ButtonHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "@/components/ui/button";
import { useFocusScope, usePortalReady } from "@/components/ui/focus-scope";

export const OverlayBackdrop = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function OverlayBackdrop({ className, type = "button", ...props }, ref) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={`absolute inset-0 h-auto w-auto appearance-none border-0 bg-transparent p-0 ${className ?? ""}`.trim()}
      />
    );
  },
);

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
  const portalReady = usePortalReady();
  const active = open && portalReady;

  useFocusScope({
    active,
    panelRef,
    allowEscape: allowEscape && dismissible,
    onEscape: onClose,
    returnFocusRef,
  });

  if (!active) return null;

  return createPortal(
    <div className="af-overlay-viewport fixed inset-0 z-[var(--af-layer-modal)] flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in sm:items-center" role="presentation">
      <OverlayBackdrop className="cursor-default" aria-hidden="true" tabIndex={-1} onClick={allowEscape && dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 flex max-h-full w-full max-w-lg flex-col rounded-lg border border-white/10 bg-[#101419] p-4 shadow-xl animate-scale-in"
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
          {dismissible ? (
            <IconButton
              label="关闭对话框"
              size="sm"
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <div className="af-responsive-surface min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
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
  side?: "left" | "right";
}) {
  const { open, onClose, title, children, side = "right" } = props;
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const portalReady = usePortalReady();
  const active = open && portalReady;

  useFocusScope({ active, panelRef, allowEscape: true, onEscape: onClose });

  if (!active) return null;

  return createPortal(
    <div className={`fixed inset-0 z-[var(--af-layer-modal)] flex bg-black/50 backdrop-blur-sm animate-fade-in ${side === "left" ? "justify-start" : "justify-end"}`} role="presentation">
      <OverlayBackdrop className="cursor-default" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`af-drawer-panel relative z-10 flex w-full max-w-md flex-col bg-[#0d1117] shadow-xl ${side === "left" ? "border-r border-white/10 animate-slide-in-left" : "border-l border-white/10 animate-slide-in-right"}`}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
          <IconButton
            label="关闭抽屉"
            size="sm"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="af-responsive-surface min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
