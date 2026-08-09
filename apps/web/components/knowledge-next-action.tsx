import type { ReactNode } from "react";

export function KnowledgeNextAction(props: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  status?: ReactNode;
  id?: string;
}) {
  const headingId = props.id ?? "knowledge-next-action-heading";
  return (
    <section className="rounded-lg border border-teal-300/20 bg-teal-300/5 p-4 sm:p-5" aria-labelledby={headingId}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-200">下一行动</p>
          <h2 id={headingId} className="mt-1 text-lg font-semibold text-white">{props.title}</h2>
          {props.description ? <p className="mt-2 text-sm leading-6 text-zinc-300">{props.description}</p> : null}
        </div>
        {props.status || props.action ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {props.status}
            {props.action}
          </div>
        ) : null}
      </div>
    </section>
  );
}
