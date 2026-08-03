import type { ReactNode } from "react";

export type PageFrameVariant = "dashboard-wide" | "split-view" | "content-focus" | "workspace-full";

const frameClass: Record<PageFrameVariant, string> = {
  "dashboard-wide": "w-full space-y-6",
  "split-view": "min-h-0 w-full",
  "content-focus": "mx-auto w-full max-w-4xl space-y-6",
  "workspace-full": "min-h-0 w-full",
};

export function PageFrame(props: {
  variant: PageFrameVariant;
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${frameClass[props.variant]} ${props.className ?? ""}`}>{props.children}</div>;
}

export function PageHeader(props: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  action?: ReactNode;
  back?: ReactNode;
  status?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between ${props.className ?? ""}`}>
      <div className="min-w-0">
        {props.back ? <div className="mb-3">{props.back}</div> : null}
        {props.eyebrow ? <p className="text-xs font-medium text-teal-300">{props.eyebrow}</p> : null}
        <h1 className="mt-1 break-words text-2xl font-semibold leading-8 text-white" data-ai-current-object="true" data-ai-selectable data-ai-label={props.title}>{props.title}</h1>
        {props.description ? <div className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">{props.description}</div> : null}
        {props.status ? <div className="mt-3">{props.status}</div> : null}
      </div>
      {props.action ? <div className="flex shrink-0 items-center gap-2">{props.action}</div> : null}
    </header>
  );
}

export function SectionHeader(props: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-medium leading-7 text-white">{props.title}</h2>
          {props.meta}
        </div>
        {props.description ? <div className="mt-1 text-sm text-zinc-400">{props.description}</div> : null}
      </div>
      {props.action ? <div className="shrink-0">{props.action}</div> : null}
    </div>
  );
}

export function Toolbar(props: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      className={`flex min-h-10 flex-wrap items-center gap-2 border-y border-white/10 py-2 ${props.className ?? ""}`}
      role="group"
      aria-label={props.label}
    >
      {props.children}
    </div>
  );
}
