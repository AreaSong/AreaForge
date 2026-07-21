"use client";

import { useEffect } from "react";

export function Modal(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  allowEscape?: boolean;
}) {
  const { open, allowEscape = true, onClose, title, children } = props;

  useEffect(() => {
    if (!open || !allowEscape) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, allowEscape, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭对话框背景" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full max-w-lg rounded-lg border border-white/10 bg-[#101419] p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            className="rounded-md border border-white/10 px-2 py-1 text-sm text-zinc-300 hover:bg-white/10"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { open, onClose, title, children } = props;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭抽屉背景" onClick={onClose} />
      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#0d1117] p-4 shadow-xl"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
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
    </div>
  );
}
