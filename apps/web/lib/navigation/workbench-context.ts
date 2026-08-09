import { getCanonicalRoute } from "@/lib/navigation/app-navigation";

export interface WorkbenchFallback {
  href: string;
  label: string;
}

const FALLBACK_LABELS: Record<string, string> = {
  "/focus": "返回开始学习",
  "/today": "返回今日",
  "/knowledge": "返回知识工作台",
  "/test/retests": "返回检验工作台",
  "/roadmap": "返回路线总览",
  "/roadmap/allocation": "返回投入安排",
  "/roadmap/allocation/drafts": "返回收件箱",
  "/roadmap/stages": "返回阶段工作台",
  "/roadmap/reviews": "返回周期复盘",
  "/roadmap/reviews/daily": "返回复盘工作台",
  "/confirmations": "返回确认中心",
  "/settings": "返回设置",
};

export function getWorkbenchFallback(pathname: string | null | undefined): WorkbenchFallback {
  const path = normalizePathname(pathname);
  const route = getCanonicalRoute(path);
  const href = route?.shell === "app" ? route.returnFallback : "/focus";
  return { href, label: FALLBACK_LABELS[href] ?? "返回开始学习" };
}

function normalizePathname(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return new URL(value, "https://areaforge.invalid").pathname;
  } catch {
    return value.split("?", 1)[0]?.split("#", 1)[0] ?? "";
  }
}
