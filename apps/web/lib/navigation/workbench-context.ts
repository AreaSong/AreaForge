export interface WorkbenchFallback {
  href: string;
  label: string;
}

export function getWorkbenchFallback(pathname: string | null | undefined): WorkbenchFallback {
  const path = normalizePathname(pathname);
  if (isPathUnder(path, "/knowledge")) {
    return { href: "/knowledge", label: "返回知识工作台" };
  }
  if (isPathUnder(path, "/roadmap/reports/daily")) return { href: "/roadmap/reports/daily", label: "返回复盘工作台" };
  if (isPathUnder(path, "/roadmap/reports")) return { href: "/roadmap/reports", label: "返回周期复盘" };
  if (isPathUnder(path, "/test")) return { href: "/test", label: "返回检验工作台" };
  if (isPathUnder(path, "/roadmap/stages")) return { href: "/roadmap/stages", label: "返回阶段工作台" };
  if (isPathUnder(path, "/settings")) return { href: "/settings", label: "返回设置总览" };
  if (isPathUnder(path, "/roadmap/arrangements/drafts")) return { href: "/roadmap/arrangements/drafts", label: "返回收件箱" };
  if (isPathUnder(path, "/roadmap/arrangements")) return { href: "/roadmap/arrangements", label: "返回学习安排" };
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
