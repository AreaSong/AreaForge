import type { ReactNode } from "react";

export type FeedbackTone = "neutral" | "info" | "success" | "warning" | "danger";
export type PersistenceState = "clean" | "local-draft" | "saving" | "saved" | "conflict";

const toneClass: Record<FeedbackTone, string> = {
  neutral: "border-white/10 bg-white/[0.03] text-zinc-300",
  info: "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
  success: "border-emerald-400/25 bg-emerald-500/[0.08] text-emerald-100",
  warning: "border-amber-400/25 bg-amber-500/[0.08] text-amber-100",
  danger: "border-red-400/30 bg-red-500/10 text-red-100",
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
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${toneClass[tone]} ${props.className ?? ""}`} role={props.role ?? (tone === "danger" ? "alert" : "status")}>
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
  return <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs ${toneClass[tone]} ${props.className ?? ""}`}>{props.children}</span>;
}

export function EmptyState(props: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`border-y border-dashed border-white/15 px-4 py-10 text-center ${props.className ?? ""}`}>
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
