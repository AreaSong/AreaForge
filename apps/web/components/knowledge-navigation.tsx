"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { KNOWLEDGE_TAB_ITEMS } from "@/lib/navigation/batch7";
import { KNOWLEDGE_CONTEXT_EVENT, readKnowledgeContextQuery } from "@/lib/client/knowledge-context";

export function KnowledgeNavigation() {
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

  return (
    <nav className="flex flex-wrap gap-2" aria-label="知识工作台">
      {KNOWLEDGE_TAB_ITEMS.map((item) => {
        const href = contextQuery ? `${item.href}?${contextQuery}` : item.href;
        return (
          <Link
            key={item.href}
            href={href}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-zinc-300 hover:bg-white/5 hover:text-white"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
