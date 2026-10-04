import type { ReactNode } from "react";

export type FeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";
export type PersistenceState = "clean" | "local-draft" | "saving" | "saved" | "conflict";

const alertToneClass: Record<FeedbackTone, string> = {
  neutral: "border-transparent border-l-white/20 bg-gradient-to-r from-white/[0.05] to-transparent text-zinc-300",
  info: "border-transparent border-l-sky-400/70 bg-gradient-to-r from-sky-500/[0.08] to-transparent text-sky-100 shadow-[-2px_0_12px_rgba(56,189,248,0.1)]",
  success: "border-transparent border-l-emerald-400/70 bg-gradient-to-r from-emerald-500/[0.08] to-transparent text-emerald-100 shadow-[-2px_0_12px_rgba(52,211,153,0.1)]",
  warning: "border-transparent border-l-amber-400/70 bg-gradient-to-r from-amber-500/[0.08] to-transparent text-amber-100 shadow-[-2px_0_12px_rgba(251,191,36,0.1)]",
  danger: "border-transparent border-l-red-400/70 bg-gradient-to-r from-red-500/[0.1] to-transparent text-red-100 shadow-[-2px_0_12px_rgba(248,113,113,0.1)]",
};

const badgeToneClass: Record<FeedbackTone, string> = {
  neutral: "border-white/10 bg-white/[0.03] text-zinc-300",
  info: "border-sky-400/25 bg-sky-500/[0.08] text-sky-200",
  success: "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-200",
  warning: "border-amber-400/25 bg-amber-500/[0.08] text-amber-200",
  danger: "border-red-400/30 bg-red-500/10 text-red-200",
};

export function Alert(props: {
  tone?: FeedbackTone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
  className?: string;
}) {
  const tone = props.tone ?? "neutral";
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-md border border-l-[3px] px-4 py-3 text-sm ${alertToneClass[tone]} ${props.className ?? ""}`} role={props.role ?? (tone === "danger" ? "alert" : "status")}>
      <div className="min-w-0">
        {props.title ? <p className="font-medium text-current">{props.title}</p> : null}
        <div className={props.title ? "mt-1 text-current/80" : undefined}>{props.children}</div>
      </div>
      {props.action ? <div className="shrink-0">{props.action}</div> : null}
    </div>
  );
}

export function Badge(props: { tone?: FeedbackTone; children: ReactNode; className?: string }) {
  const tone = props.tone ?? "neutral";
  return <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs ${badgeToneClass[tone]} ${props.className ?? ""}`}>{props.children}</span>;
}

export function EmptyState(props: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent px-4 py-12 text-center shadow-[0_8px_32px_rgba(0,0,0,0.2)] ${props.className ?? ""}`}>
      <h3 className="text-base font-medium text-zinc-100">{props.title}</h3>
      {props.description ? <div className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-400">{props.description}</div> : null}
      {props.action ? <div className="mt-4 flex justify-center">{props.action}</div> : null}
    </div>
  );
}

export function Skeleton(props: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/[0.07] ${props.className ?? "h-4 w-full"}`} aria-hidden="true" />;
}

const persistenceLabel: Record<PersistenceState, string> = {
  clean: "与服务端一致",
  "local-draft": "未提交 · 已保存在本机",
  saving: "正在保存到服务端",
  saved: "已保存到服务端",
  conflict: "需要处理版本冲突",
};

const persistenceTone: Record<PersistenceState, FeedbackTone> = {
  clean: "neutral",
  "local-draft": "info",
  saving: "info",
  saved: "success",
  conflict: "warning",
};

export function PersistenceStatus(props: { state: PersistenceState; className?: string }) {
  return (
    <span className={props.className} role="status" aria-live="polite" aria-atomic="true">
      <Badge tone={persistenceTone[props.state]}>{persistenceLabel[props.state]}</Badge>
    </span>
  );
}
