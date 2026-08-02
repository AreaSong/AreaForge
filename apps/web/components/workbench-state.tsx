import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/feedback";

export function WorkbenchState(props: {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  detail?: ReactNode;
  role?: "alert" | "status";
  className?: string;
}) {
  return (
    <section
      className={`mx-auto w-full max-w-3xl border-y border-white/10 py-8 sm:py-10 ${props.className ?? ""}`}
      role={props.role ?? "status"}
      aria-live={props.role === "alert" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <div className="flex items-start gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-zinc-300">
          {props.icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-teal-300">{props.eyebrow}</p>
          <h1 className="mt-1 break-words text-2xl font-semibold leading-8 text-white">{props.title}</h1>
          <div className="mt-2 text-sm leading-6 text-zinc-400">{props.description}</div>
        </div>
      </div>
      {props.detail ? <div className="mt-5 border-t border-white/10 pt-4 text-xs text-zinc-500">{props.detail}</div> : null}
      {props.actions ? <div className="mt-6 flex flex-wrap gap-3">{props.actions}</div> : null}
    </section>
  );
}

export function WorkbenchLoading(props: { standalone?: boolean }) {
  return (
    <main className={`${props.standalone ? "min-h-screen bg-[#080b0f] px-4 py-8 text-zinc-100 sm:px-6 lg:px-8" : "w-full py-2"}`} aria-busy="true" aria-label="正在加载工作台">
      <div className="w-full space-y-6" role="status" aria-live="polite">
        <span className="sr-only">正在加载当前工作台</span>
        <header className="border-b border-white/10 pb-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-8 w-48 max-w-full" />
          <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        </header>
        <section className="grid gap-4 border-b border-white/10 pb-6 sm:grid-cols-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </section>
        <section className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </section>
      </div>
    </main>
  );
}
