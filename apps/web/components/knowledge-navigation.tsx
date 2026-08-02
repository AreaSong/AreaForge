"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { KNOWLEDGE_TAB_ITEMS, KNOWLEDGE_TOOL_ITEMS } from "@/lib/navigation/batch7";
import { WorkbenchNavigation } from "@/components/ui/workbench-navigation";
import {
  KNOWLEDGE_CONTEXT_EVENT,
  KNOWLEDGE_CONTEXT_KEYS,
  readKnowledgeContextQuery,
} from "@/lib/client/knowledge-context";

export function KnowledgeNavigation() {
  const pathname = usePathname();
  const [contextQuery, setContextQuery] = useState("");

  useEffect(() => {
    const update = () => setContextQuery(readKnowledgeContextQuery());
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(KNOWLEDGE_CONTEXT_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(KNOWLEDGE_CONTEXT_EVENT, update);
    };
  }, []);

  const context = new URLSearchParams(contextQuery);
  const query = context.get("q") ?? "";
  const clearContext = new URLSearchParams(context);
  clearContext.delete("q");
  const clearHref = clearContext.size > 0 ? `${pathname}?${clearContext}` : pathname;

  return (
    <div className="space-y-3">
      <WorkbenchNavigation label="知识工作台" items={KNOWLEDGE_TAB_ITEMS} tools={KNOWLEDGE_TOOL_ITEMS} suffix={contextQuery ? `?${contextQuery}` : ""} />
      <form action={pathname} method="get" role="search" className="flex max-w-xl items-center gap-2">
        {KNOWLEDGE_CONTEXT_KEYS.filter((key) => key !== "q").map((key) => {
          const value = context.get(key);
          return value ? <input key={key} type="hidden" name={key} value={value} /> : null;
        })}
        <label htmlFor="knowledge-search" className="sr-only">搜索当前知识工作台</label>
        <input
          key={query}
          id="knowledge-search"
          name="q"
          type="search"
          maxLength={120}
          defaultValue={query}
          placeholder="搜索标题"
          className="h-10 min-w-0 flex-1 rounded-md border border-white/10 bg-[#0b0e12] px-3 text-sm text-zinc-100 outline-none focus:border-teal-400/50"
        />
        <button type="submit" aria-label="搜索" title="搜索" className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-teal-300/30 text-teal-200">
          <Search aria-hidden="true" size={17} />
        </button>
        {query ? (
          <Link href={clearHref} aria-label="清除搜索" title="清除搜索" className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 text-zinc-300">
            <X aria-hidden="true" size={17} />
          </Link>
        ) : null}
      </form>
    </div>
  );
}
