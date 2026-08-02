export interface WorkbenchFallback {
  href: string;
  label: string;
}

export function getWorkbenchFallback(pathname: string | null | undefined): WorkbenchFallback {
  if (pathname?.startsWith("/knowledge")) return { href: "/knowledge/overview", label: "返回知识工作台" };
  if (pathname?.startsWith("/review")) return { href: "/review/daily", label: "返回复盘工作台" };
  if (pathname?.startsWith("/plan/stages") || pathname?.startsWith("/test/simulations")) return { href: "/plan/stages", label: "返回阶段工作台" };
  if (pathname?.startsWith("/settings")) return { href: "/settings", label: "返回设置总览" };
  if (pathname?.startsWith("/plan/inbox")) return { href: "/plan/inbox", label: "返回收件箱" };
  if (pathname?.startsWith("/plan")) return { href: "/plan", label: "返回计划" };
  return { href: "/today", label: "返回今日行动" };
}
