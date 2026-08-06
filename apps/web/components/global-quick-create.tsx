"use client";

import { FilePlus2, ListTree, NotebookPen, Plus, SquareCheckBig, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useWindowSystem } from "@/components/window-system";

export function GlobalQuickCreate() {
  const { openWindow, registerWindow } = useWindowSystem();

  useEffect(() => registerWindow({
    key: "quick-create",
    kind: "quick-create",
    title: "快捷创建",
    closePolicy: "free",
    render: () => <QuickCreateContent />,
  }), [registerWindow]);

  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-zinc-300 hover:bg-white/5"
      onClick={() => openWindow("quick-create")}
      aria-label="快捷创建"
      title="快捷创建"
    >
      <Plus size={17} aria-hidden="true" />
    </button>
  );
}

function QuickCreateContent() {
  return (
    <nav className="grid gap-2" aria-label="创建对象">
      <QuickCreateLink href="/roadmap/allocation?createMinimum=1" label="任务" icon={<SquareCheckBig size={18} aria-hidden="true" />} />
      <QuickCreateLink href="/knowledge/syllabi?create=1" label="考纲节点" icon={<ListTree size={18} aria-hidden="true" />} />
      <QuickCreateLink href="/knowledge/cards?create=1" label="知识卡片" icon={<NotebookPen size={18} aria-hidden="true" />} />
      <QuickCreateLink href="/knowledge/mistakes?create=1" label="错题" icon={<TriangleAlert size={18} aria-hidden="true" />} />
      <QuickCreateLink href="/knowledge/resources?create=1" label="资料" icon={<FilePlus2 size={18} aria-hidden="true" />} />
    </nav>
  );
}

function QuickCreateLink(props: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={props.href} className="flex h-11 items-center gap-3 rounded-md border border-white/10 px-3 text-sm text-zinc-100 hover:bg-white/5">
      {props.icon}
      {props.label}
    </Link>
  );
}
