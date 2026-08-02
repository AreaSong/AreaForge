const RETURN_CONTEXTS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "/today/plan", label: "返回计划" },
  { prefix: "/today/inbox", label: "返回收件箱" },
  { prefix: "/today/tasks", label: "返回任务详情" },
  { prefix: "/focus", label: "返回专注计时" },
  { prefix: "/quick-review", label: "返回快速复习" },
  { prefix: "/knowledge/overview", label: "返回知识概览" },
  { prefix: "/knowledge/reviews", label: "返回复习队列" },
  { prefix: "/knowledge/notes", label: "返回知识卡片" },
  { prefix: "/knowledge/mistakes", label: "返回错题" },
  { prefix: "/knowledge/resources", label: "返回资料" },
  { prefix: "/knowledge/syllabus", label: "返回考纲" },
  { prefix: "/knowledge/imports", label: "返回导入工作台" },
  { prefix: "/knowledge/canvas", label: "返回关联画布" },
  { prefix: "/review/daily", label: "返回晚间复盘" },
  { prefix: "/review/reports", label: "返回周期报告" },
  { prefix: "/stage/overview", label: "返回阶段概览" },
  { prefix: "/stage/simulation", label: "返回模拟考试" },
  { prefix: "/stage/analytics", label: "返回阶段趋势" },
  { prefix: "/settings", label: "返回设置" },
] as const;

export function getReturnContextLabel(returnTo: string | undefined, fallbackLabel: string): string {
  if (!returnTo) return fallbackLabel;
  const pathname = returnTo.split("?", 1)[0] ?? returnTo;
  if (pathname === "/today") return "返回今日行动";
  if (pathname === "/knowledge") return "返回知识工作台";
  if (pathname === "/review") return "返回复盘";
  if (pathname === "/stage") return "返回阶段";

  return RETURN_CONTEXTS.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.label
    ?? fallbackLabel;
}

export function getCompletionReturnLabel(returnTo: string, fallbackLabel = "返回原位置"): string {
  return returnTo === "/today"
    ? "回到今日，查看下一行动"
    : getReturnContextLabel(returnTo, fallbackLabel);
}
