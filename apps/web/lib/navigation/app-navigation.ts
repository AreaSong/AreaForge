import {
  CANONICAL_ROUTES,
  createCanonicalRoutePattern,
  type AppWorkbenchId,
  type CanonicalRouteDefinition,
} from "@/lib/navigation/canonical-routes";
import { WORKBENCH_ROOT_ROUTES } from "@/lib/navigation/route-helpers";

export interface AppNavigationItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  children?: readonly AppNavigationItem[];
}

interface NavigationTab {
  id: string;
  href: string;
  label: string;
}

export const KNOWLEDGE_TAB_ITEMS = [
  { id: "overview", href: "/knowledge", label: "概览" },
  { id: "points", href: "/knowledge/points", label: "知识点" },
  { id: "syllabi", href: "/knowledge/syllabi", label: "考纲" },
  { id: "resources", href: "/knowledge/resources", label: "学习资料" },
  { id: "cards", href: "/knowledge/cards", label: "知识卡片" },
  { id: "mistakes", href: "/knowledge/mistakes", label: "错题" },
  { id: "reviews", href: "/knowledge/reviews", label: "复习" },
] as const satisfies readonly NavigationTab[];

export const SETTINGS_TAB_ITEMS = [
  { id: "overview", href: "/settings", label: "设置总览" },
  { id: "account", href: "/settings/account", label: "账户安全" },
  { id: "workspaces", href: "/settings/workspaces", label: "工作区与成员" },
  { id: "exams", href: "/settings/exams", label: "考试与科目" },
  { id: "profile", href: "/settings/profile", label: "个人与恢复" },
  { id: "learning", href: "/settings/learning", label: "学习与提醒" },
  { id: "ai", href: "/settings/ai", label: "AI 与隐私" },
  { id: "data", href: "/settings/data", label: "数据与安全" },
  { id: "system", href: "/settings/system", label: "系统与更新" },
] as const satisfies readonly NavigationTab[];

const ROADMAP_TAB_ITEMS = [
  { id: "overview", href: "/roadmap", label: "路线总览" },
  { id: "allocation", href: "/roadmap/allocation", label: "投入安排" },
  { id: "stages", href: "/roadmap/stages", label: "阶段" },
  { id: "reviews", href: "/roadmap/reviews", label: "周期复盘" },
] as const satisfies readonly NavigationTab[];

const TEST_TAB_ITEMS = [
  { id: "retests", href: "/test/retests", label: "专项复测" },
  { id: "simulations", href: "/test/simulations", label: "模拟考试" },
] as const satisfies readonly NavigationTab[];

export const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  createWorkbenchItem("focus", "/focus", "开始学习"),
  createWorkbenchItem("today", "/today", "今日"),
  createWorkbenchItem("knowledge", "/knowledge", "知识", KNOWLEDGE_TAB_ITEMS),
  createWorkbenchItem("test", "/test/retests", "检验", TEST_TAB_ITEMS),
  createWorkbenchItem("roadmap", "/roadmap", "路线", ROADMAP_TAB_ITEMS),
  createWorkbenchItem("settings", "/settings", "设置", SETTINGS_TAB_ITEMS),
] as const;

export const PRIMARY_WORKBENCH_ITEMS = APP_NAVIGATION_ITEMS.filter((item) => item.label !== "设置");
export const UTILITY_NAV_ITEM = APP_NAVIGATION_ITEMS.find((item) => item.label === "设置")!;

const REGISTERED_ROUTES = CANONICAL_ROUTES.map((route) => ({
  route,
  pattern: createCanonicalRoutePattern(route.path),
}));

export function getCanonicalRoute(pathname: string): CanonicalRouteDefinition | null {
  return REGISTERED_ROUTES.find((entry) => entry.pattern.test(pathname))?.route ?? null;
}

export function getRouteTitle(pathname: string): string {
  return getCanonicalRoute(pathname)?.title ?? "页面不存在";
}

export function isContentDetailPath(pathname: string): boolean {
  const route = getCanonicalRoute(pathname);
  return route?.shell === "app" && route.navigationLevel === "content";
}

export function getNavigationTrail(pathname: string): Array<{ href: string; label: string }> {
  const route = getCanonicalRoute(pathname);
  if (!route || route.shell === "public") return [{ href: pathname, label: route?.title ?? "页面不存在" }];

  if (route.workbench === "confirmations") {
    const trail: Array<{ href: string; label: string }> = [{ href: "/confirmations", label: "确认中心" }];
    if (pathname === "/confirmations/history") trail.push({ href: pathname, label: "已处理" });
    else if (pathname !== "/confirmations") trail.push({ href: pathname, label: route.title });
    return trail;
  }

  const primary = APP_NAVIGATION_ITEMS.find((item) => item.match(pathname));
  if (!primary) return [{ href: pathname, label: route.title }];
  const trail: Array<{ href: string; label: string }> = [{ href: primary.href, label: primary.label }];
  const secondary = primary.children?.find((item) => item.match(pathname));
  if (secondary && secondary.label !== primary.label) trail.push({ href: secondary.href, label: secondary.label });
  if (route.navigationLevel === "content" && route.title !== secondary?.label) trail.push({ href: pathname, label: route.title });
  if (!secondary && pathname !== primary.href && route.title !== primary.label) trail.push({ href: pathname, label: route.title });
  return trail;
}

export function getRouteMetadata(pathname: string): { title: string } {
  return { title: getRouteTitle(pathname) };
}

export function sanitizeReturnPath(
  value: string | null | undefined,
  fallback: string = WORKBENCH_ROOT_ROUTES.focus,
): string {
  return normalizeReturnPath(value, 3, fallback);
}

export function withReturnTo(href: string, returnTo: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent(sanitizeReturnPath(returnTo))}`;
}

export function isAppShellPath(pathname: string): boolean {
  return getCanonicalRoute(pathname)?.shell === "app";
}

function createWorkbenchItem(
  workbench: AppWorkbenchId,
  href: string,
  label: string,
  tabs: readonly NavigationTab[] = [],
): AppNavigationItem {
  return {
    href,
    label,
    match: (path) => {
      const route = getCanonicalRoute(path);
      return route?.shell === "app" && route.workbench === workbench;
    },
    children: tabs.length > 0
      ? tabs.map((tab) => ({
          href: tab.href,
          label: tab.label,
          match: (path: string) => {
            const route = getCanonicalRoute(path);
            return route?.shell === "app" && route.workbench === workbench && route.secondary === tab.id;
          },
        }))
      : undefined,
  };
}

function normalizeReturnPath(
  value: string | null | undefined,
  remainingReturnDepth: number,
  fallback: string,
): string {
  if (!value || value.length > 2_048 || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const url = new URL(value, "https://areaforge.invalid");
    if (url.origin !== "https://areaforge.invalid" || url.hash) return fallback;
    const route = getCanonicalRoute(url.pathname);
    if (!route || route.path === "/login") return fallback;

    const allowedKeys = new Set(route.returnQueryKeys ?? []);
    const normalized = new URLSearchParams();
    for (const key of allowedKeys) {
      const entry = url.searchParams.get(key);
      if (entry === null || entry.length > 512) continue;
      if (key === "returnTo") {
        if (remainingReturnDepth > 0) {
          normalized.set(key, normalizeReturnPath(entry, remainingReturnDepth - 1, fallback));
        }
        continue;
      }
      normalized.set(key, entry);
    }
    const query = normalized.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return fallback;
  }
}
