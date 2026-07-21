export const BATCH7_NAV_ITEMS = [
  { href: "/today", label: "今日", match: (path: string) => path === "/today" || path.startsWith("/today?") },
  { href: "/today/plan", label: "计划", match: (path: string) => path.startsWith("/today/plan") || path.startsWith("/today/tasks") },
  { href: "/today/inbox", label: "收件箱", match: (path: string) => path.startsWith("/today/inbox") },
  { href: "/settings/workspace", label: "设置", match: (path: string) => path.startsWith("/settings") },
] as const;

export const SAFE_RETURN_PATHS = [
  "/today",
  "/today/plan",
  "/today/inbox",
  "/settings",
  "/settings/workspace",
  "/settings/profile",
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
  if (SAFE_RETURN_PATHS.some((allowed) => path === allowed || path.startsWith(`${allowed}/`))) {
    return value;
  }
  if (path === "/today" || path.startsWith("/today/")) return value;
  return "/today";
}

export function isBatch7OpenPath(pathname: string): boolean {
  return (
    pathname === "/today" ||
    pathname.startsWith("/today/") ||
    pathname.startsWith("/focus/") ||
    pathname.startsWith("/quick-review/") ||
    pathname.startsWith("/settings")
  );
}
