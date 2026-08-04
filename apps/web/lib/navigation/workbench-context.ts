export interface WorkbenchFallback {
  href: string;
  label: string;
}

export function getWorkbenchFallback(pathname: string | null | undefined): WorkbenchFallback {
  const path = normalizePathname(pathname);
  if (isPathUnder(path, "/knowledge")) {
    return { href: "/knowledge", label: "返回知识工作台" };
  }
  if (isPathUnder(path, "/roadmap/reviews/daily")) return { href: "/roadmap/reviews/daily", label: "返回复盘工作台" };
  if (isPathUnder(path, "/roadmap/reviews")) return { href: "/roadmap/reviews", label: "返回周期复盘" };
  if (isPathUnder(path, "/test")) return { href: "/test/retests", label: "返回检验工作台" };
  if (isPathUnder(path, "/roadmap/stages")) return { href: "/roadmap/stages", label: "返回阶段工作台" };
  if (isPathUnder(path, "/settings")) return { href: "/settings/exams", label: "返回设置" };
  if (isPathUnder(path, "/roadmap/allocation/drafts")) return { href: "/roadmap/allocation/drafts", label: "返回收件箱" };
  if (isPathUnder(path, "/roadmap/allocation")) return { href: "/roadmap/allocation", label: "返回投入安排" };
  if (path === "/today") return { href: "/today", label: "返回今日" };
  if (isPathUnder(path, "/confirmations")) return { href: "/confirmations", label: "返回确认中心" };
  return { href: "/focus", label: "返回开始学习" };
}

function isPathUnder(pathname: string, root: string): boolean {
  return pathname === root || pathname?.startsWith(`${root}/`) === true;
}

function normalizePathname(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value, "https://areaforge.invalid").pathname;
  } catch {
    return value.split("?", 1)[0]?.split("#", 1)[0] ?? "";
  }
}
