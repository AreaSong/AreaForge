"use client";

import { SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export function WorkbenchNotFound(props: {
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  useEffect(() => {
    document.title = `${props.title} | AreaForge`;
  }, [props.title]);

  return (
    <section
      className="mx-auto w-full max-w-xl rounded-md border border-white/10 bg-[#101419] p-6"
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <div className="flex items-start gap-3">
        <SearchX className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" aria-hidden="true" />
        <div>
          <h1 className="text-xl font-semibold text-white">{props.title}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{props.description}</p>
        </div>
      </div>
      <Link className="mt-5 inline-flex h-10 items-center rounded-md bg-teal-400 px-4 text-sm font-medium text-[#071011]" href={props.href}>
        {props.linkLabel}
      </Link>
    </section>
  );
}
