import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { Metric } from "@/components/ui/metric";
import type { ActionCenterTodayDto } from "@/lib/contracts";

export function withTodayReturnTo(href: string): string {
  if (
    !href.startsWith("/knowledge/reviews/")
    && href !== "/focus"
    && !href.startsWith("/roadmap/allocation/tasks/")
  ) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent("/today")}`;
}

export function isSameActionTarget(left: string, right: string): boolean {
  return left.split("?", 1)[0] === right.split("?", 1)[0];
}

export function hasRemainingAction(
  items: Array<{ href: string }>,
  primaryActionHref: string,
): boolean {
  return items.some((item) => !isSameActionTarget(item.href, primaryActionHref));
}

export function flattenShortcutNodes(
  nodes: ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"],
  depth = 0,
): Array<ActionCenterTodayDto["shortcutOptions"]["syllabusNodes"][number] & { depth: number }> {
  return nodes.flatMap((node) => [
    { ...node, depth },
    ...flattenShortcutNodes(node.children, depth + 1),
  ]);
}

export function QueueList(props: {
  items: Array<{ id: string; title: string; reason: string; href: string; softDependencyHint: string | null }>;
  actionLabel: string;
}) {
  if (props.items.length === 0) {
    return (
      <div className="rounded-[var(--af-radius-control)] border border-dashed border-[var(--af-border)] px-4 py-6 text-sm text-zinc-500">
        当前推荐之外没有待办
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/10 border-y border-white/10">
      {props.items.map((item) => (
        <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-white">{item.title}</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{item.reason}</p>
            {item.softDependencyHint ? <p className="mt-1 text-xs text-amber-200">{item.softDependencyHint}</p> : null}
          </div>
          <Link href={withTodayReturnTo(item.href)} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            {props.actionLabel}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TodayMetric(props: { label: string; value: string }) {
  return <Metric {...props} layout="compact" valueSize="sm" className="first:pl-0 last:pr-0" />;
}
