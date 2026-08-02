export interface AppNavigationItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  children?: readonly AppNavigationItem[];
}

export const BATCH10_NAV_ITEMS: readonly AppNavigationItem[] = [
  {
    href: "/today",
    label: "今日",
    match: (path: string) => path === "/today" || path.startsWith("/today/inbox"),
  },
  {
    href: "/today/plan",
    label: "计划",
    match: (path: string) => path.startsWith("/today/plan") || path.startsWith("/today/tasks"),
  },
  {
    href: "/knowledge/overview",
    label: "知识",
    match: (path: string) => path === "/knowledge" || path.startsWith("/knowledge/"),
  },
  { href: "/review/daily", label: "复盘", match: (path: string) => path === "/review" || path.startsWith("/review/") },
  { href: "/stage/overview", label: "阶段", match: (path: string) => path.startsWith("/stage/") },
] as const;

export const BATCH8_NAV_ITEMS = BATCH10_NAV_ITEMS;

/** @deprecated Use BATCH8_NAV_ITEMS */
export const BATCH7_NAV_ITEMS = BATCH8_NAV_ITEMS;

export const KNOWLEDGE_TAB_ITEMS = [
  { href: "/knowledge/overview", label: "概览" },
  { href: "/knowledge/syllabus", label: "考纲" },
  { href: "/knowledge/notes", label: "卡片" },
  { href: "/knowledge/mistakes", label: "错题" },
  { href: "/knowledge/resources", label: "资料" },
  { href: "/knowledge/reviews", label: "复习" },
] as const;

export const KNOWLEDGE_TOOL_ITEMS = [
  { href: "/knowledge/canvas", label: "画布" },
  { href: "/knowledge/imports", label: "导入" },
] as const;

export const REVIEW_TAB_ITEMS = [
  { href: "/review/daily", label: "今日复盘" },
  { href: "/review/reports", label: "周期报告" },
] as const;

export const STAGE_TAB_ITEMS = [
  { href: "/stage/overview", label: "概览" },
  { href: "/stage/simulation", label: "模拟考试" },
  { href: "/stage/analytics", label: "趋势" },
] as const;

export const SETTINGS_TAB_ITEMS = [
  { href: "/settings/workspace", label: "工作区" },
  { href: "/settings/profile", label: "档案" },
  { href: "/settings/notifications", label: "通知" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/experience", label: "体验" },
  { href: "/settings/system", label: "系统" },
] as const;

interface RegisteredRoute {
  pattern: RegExp;
  title: string;
  returnQueryKeys?: readonly string[];
}

const REGISTERED_ROUTES: readonly RegisteredRoute[] = [
  { pattern: /^\/$/, title: "AreaForge" },
  { pattern: /^\/login$/, title: "登录" },
  { pattern: /^\/setup$/, title: "初始化" },
  { pattern: /^\/today$/, title: "今日行动中心" },
  { pattern: /^\/today\/plan$/, title: "计划", returnQueryKeys: ["date", "subjectId", "status", "q", "createMinimum", "resourceId", "taskId"] },
  { pattern: /^\/today\/inbox$/, title: "收件箱", returnQueryKeys: ["status", "stableRef", "returnTo"] },
  { pattern: /^\/today\/inbox\/[^/]+$/, title: "收件箱详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/today\/tasks\/[^/]+$/, title: "任务详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/focus\/[^/]+$/, title: "专注计时", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/quick-review\/[^/]+$/, title: "快速复习", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge$/, title: "知识工作台" },
  { pattern: /^\/knowledge\/canvas$/, title: "关联画布", returnQueryKeys: ["workspaceId", "subjectId", "syllabusNodeId", "focus", "q"] },
  { pattern: /^\/knowledge\/overview$/, title: "知识概览" },
  { pattern: /^\/knowledge\/imports$/, title: "学习树导入", returnQueryKeys: ["mode"] },
  { pattern: /^\/knowledge\/imports\/[^/]+$/, title: "导入批次" },
  { pattern: /^\/knowledge\/syllabus$/, title: "考纲", returnQueryKeys: ["subjectId", "q", "status", "map", "action"] },
  { pattern: /^\/knowledge\/syllabus\/[^/]+$/, title: "考纲节点详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/notes$/, title: "知识卡片", returnQueryKeys: ["subjectId", "syllabusNodeId", "taskId", "q", "mastery", "review"] },
  { pattern: /^\/knowledge\/notes\/[^/]+$/, title: "知识卡片详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/mistakes$/, title: "错题", returnQueryKeys: ["subjectId", "syllabusNodeId", "q", "cause", "review"] },
  { pattern: /^\/knowledge\/mistakes\/[^/]+$/, title: "错题详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/resources$/, title: "资料", returnQueryKeys: ["subjectId", "q", "create"] },
  { pattern: /^\/knowledge\/resources\/[^/]+\/preview$/, title: "资料预览", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/resources\/[^/]+$/, title: "资料详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/reviews$/, title: "统一复习" },
  { pattern: /^\/knowledge\/reviews\/[^/]+$/, title: "复习排期详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/review$/, title: "复盘" },
  { pattern: /^\/review\/daily$/, title: "晚间复盘" },
  { pattern: /^\/review\/reports$/, title: "周期报告", returnQueryKeys: ["tab", "period"] },
  { pattern: /^\/review\/reports\/history\/[^/]+$/, title: "冻结报告", returnQueryKeys: ["period"] },
  { pattern: /^\/stage$/, title: "阶段" },
  { pattern: /^\/stage\/overview$/, title: "阶段概览", returnQueryKeys: ["createMilestone", "returnTo"] },
  { pattern: /^\/stage\/simulation$/, title: "模拟考试" },
  { pattern: /^\/stage\/simulation\/[^/]+$/, title: "模拟考试详情" },
  { pattern: /^\/stage\/analytics$/, title: "阶段趋势", returnQueryKeys: ["window"] },
  { pattern: /^\/settings$/, title: "设置" },
  { pattern: /^\/settings\/workspace$/, title: "工作区设置", returnQueryKeys: ["setup"] },
  { pattern: /^\/settings\/profile$/, title: "个人档案与动机" },
  { pattern: /^\/settings\/notifications$/, title: "通知偏好" },
  { pattern: /^\/settings\/ai$/, title: "AI 设置" },
  { pattern: /^\/settings\/experience$/, title: "体验设置" },
  { pattern: /^\/settings\/system$/, title: "系统设置" },
] as const;

export function getRouteTitle(pathname: string): string {
  return REGISTERED_ROUTES.find((route) => route.pattern.test(pathname))?.title ?? "页面不存在";
}

export function getRouteMetadata(pathname: string): { title: string } {
  return { title: getRouteTitle(pathname) };
}

export function sanitizeReturnPath(value: string | null | undefined): string {
  return normalizeReturnPath(value, 3);
}

export function withReturnTo(href: string, returnTo: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent(sanitizeReturnPath(returnTo))}`;
}

function normalizeReturnPath(value: string | null | undefined, remainingReturnDepth: number): string {
  if (!value || value.length > 2_048 || !value.startsWith("/") || value.startsWith("//")) return "/today";
  try {
    const url = new URL(value, "https://areaforge.invalid");
    if (url.origin !== "https://areaforge.invalid" || url.hash) return "/today";
    const route = REGISTERED_ROUTES.find((candidate) => candidate.pattern.test(url.pathname));
    if (!route || url.pathname === "/login" || url.pathname === "/setup") return "/today";

    const allowedKeys = new Set(route.returnQueryKeys ?? []);
    const normalized = new URLSearchParams();
    for (const key of allowedKeys) {
      const entry = url.searchParams.get(key);
      if (entry === null || entry.length > 512) continue;
      if (key === "returnTo") {
        if (remainingReturnDepth > 0) normalized.set(key, normalizeReturnPath(entry, remainingReturnDepth - 1));
        continue;
      }
      normalized.set(key, entry);
    }
    const query = normalized.toString();
    return `${url.pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "/today";
  }
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
