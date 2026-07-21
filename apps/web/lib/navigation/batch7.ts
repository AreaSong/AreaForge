export const BATCH10_NAV_ITEMS = [
  { href: "/today", label: "今日", match: (path: string) => path === "/today" || path.startsWith("/today?") },
  { href: "/today/plan", label: "计划", match: (path: string) => path.startsWith("/today/plan") || path.startsWith("/today/tasks") },
  {
    href: "/knowledge/canvas",
    label: "知识",
    match: (path: string) => path === "/knowledge" || path.startsWith("/knowledge/"),
  },
  { href: "/review/reports", label: "复盘", match: (path: string) => path.startsWith("/review/") },
  { href: "/stage/overview", label: "阶段", match: (path: string) => path.startsWith("/stage/") },
  { href: "/settings/workspace", label: "设置", match: (path: string) => path.startsWith("/settings") },
] as const;

export const BATCH8_NAV_ITEMS = BATCH10_NAV_ITEMS;

/** @deprecated Use BATCH8_NAV_ITEMS */
export const BATCH7_NAV_ITEMS = BATCH8_NAV_ITEMS;

export const KNOWLEDGE_TAB_ITEMS = [
  { href: "/knowledge/canvas", label: "画布" },
  { href: "/knowledge/overview", label: "概览" },
  { href: "/knowledge/imports", label: "导入" },
  { href: "/knowledge/syllabus", label: "考纲" },
  { href: "/knowledge/notes", label: "卡片" },
  { href: "/knowledge/mistakes", label: "错题" },
  { href: "/knowledge/resources", label: "资料" },
  { href: "/knowledge/reviews", label: "复习" },
] as const;

export const SETTINGS_TAB_ITEMS = [
  { href: "/settings/workspace", label: "工作区" },
  { href: "/settings/profile", label: "档案" },
  { href: "/settings/notifications", label: "通知" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/experience", label: "体验" },
  { href: "/settings/system", label: "系统" },
] as const;

export const SAFE_RETURN_PATHS = [
  "/today",
  "/today/plan",
  "/today/inbox",
  "/knowledge",
  "/knowledge/canvas",
  "/knowledge/overview",
  "/knowledge/syllabus",
  "/knowledge/notes",
  "/knowledge/mistakes",
  "/knowledge/resources",
  "/knowledge/imports",
  "/knowledge/reviews",
  "/review/reports",
  "/stage/overview",
  "/stage/simulation",
  "/stage/analytics",
  "/settings",
  "/settings/workspace",
  "/settings/profile",
  "/settings/notifications",
  "/settings/ai",
  "/settings/experience",
  "/settings/system",
] as const;

export function sanitizeReturnPath(value: string | null | undefined): string {
  if (!value) return "/today";
  if (!value.startsWith("/") || value.startsWith("//")) return "/today";
  const path = value.split("?")[0] ?? value;
  if (path.startsWith("/today/tasks/")) return value;
  if (path.startsWith("/focus/")) return value;
  if (path.startsWith("/quick-review/")) return value;
  if (path.startsWith("/knowledge/")) return value;
  if (SAFE_RETURN_PATHS.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
    return value;
  }
  if (path === "/today" || path.startsWith("/today/")) return value;
  return "/today";
}

export function isBatch8OpenPath(pathname: string): boolean {
  return (
    pathname === "/today" ||
    pathname.startsWith("/today/") ||
    pathname.startsWith("/focus/") ||
    pathname.startsWith("/quick-review/") ||
    pathname === "/knowledge" ||
    pathname.startsWith("/knowledge/") ||
    pathname.startsWith("/settings")
    || pathname.startsWith("/review/")
    || pathname.startsWith("/stage/")
  );
}

/** @deprecated Use isBatch8OpenPath */
export function isBatch7OpenPath(pathname: string): boolean {
  return isBatch8OpenPath(pathname);
}
