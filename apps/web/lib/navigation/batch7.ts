export interface AppNavigationItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  children?: readonly AppNavigationItem[];
}

const ROADMAP_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/roadmap", label: "路线总览", match: (path: string) => path === "/roadmap" },
  { href: "/roadmap/allocation", label: "投入安排", match: (path: string) => path.startsWith("/roadmap/allocation") },
  { href: "/roadmap/stages", label: "阶段", match: (path: string) => path.startsWith("/roadmap/stages") },
  { href: "/roadmap/reviews", label: "周期复盘", match: (path: string) => path.startsWith("/roadmap/reviews") },
] as const;

const TEST_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/test/retests", label: "专项复测", match: (path: string) => path.startsWith("/test/retests") },
  { href: "/test/simulations", label: "模拟考试", match: (path: string) => path.startsWith("/test/simulations") },
] as const;

export const KNOWLEDGE_TAB_ITEMS = [
  { href: "/knowledge", label: "概览" },
  { href: "/knowledge/points", label: "知识点" },
  { href: "/knowledge/syllabi", label: "考纲" },
  { href: "/knowledge/resources", label: "学习资料" },
  { href: "/knowledge/cards", label: "知识卡片" },
  { href: "/knowledge/mistakes", label: "错题" },
  { href: "/knowledge/reviews", label: "复习" },
] as const;

export const SETTINGS_TAB_ITEMS = [
  { href: "/settings/exams", label: "考试与科目" },
  { href: "/settings/profile", label: "个人与恢复" },
  { href: "/settings/learning", label: "学习与提醒" },
  { href: "/settings/ai", label: "AI 与隐私" },
  { href: "/settings/data", label: "数据与安全" },
  { href: "/settings/system", label: "系统与更新" },
] as const;

export const BATCH10_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/focus", label: "开始学习", match: (path: string) => path === "/focus" },
  {
    href: "/today",
    label: "今日",
    match: (path: string) => path === "/today",
  },
  {
    href: "/knowledge",
    label: "知识",
    match: (path: string) => path === "/knowledge" || path.startsWith("/knowledge/"),
    children: KNOWLEDGE_TAB_ITEMS.map((item) => ({
      ...item,
      match: (path: string) => item.href === "/knowledge/reviews"
        ? path === item.href || path.startsWith(`${item.href}/`)
        : item.href === "/knowledge"
          ? path === "/knowledge"
          : path === item.href || path.startsWith(`${item.href}/`),
    })),
  },
  {
    href: "/test/retests",
    label: "检验",
    match: (path: string) => TEST_NAV_ITEMS.some((item) => item.match(path)),
    children: TEST_NAV_ITEMS,
  },
  {
    href: "/roadmap",
    label: "路线",
    match: (path: string) => path === "/roadmap" || ROADMAP_NAV_ITEMS.some((item) => item.match(path)),
    children: ROADMAP_NAV_ITEMS,
  },
  {
    href: "/settings/exams",
    label: "设置",
    match: (path: string) => path === "/settings" || path.startsWith("/settings/"),
    children: SETTINGS_TAB_ITEMS.map((item) => ({ ...item, match: (path: string) => path === item.href || path.startsWith(`${item.href}/`) })),
  },
] as const;

export const BATCH8_NAV_ITEMS = BATCH10_NAV_ITEMS;

export const PRIMARY_WORKBENCH_ITEMS = BATCH10_NAV_ITEMS.filter((item) => item.label !== "设置");
export const UTILITY_NAV_ITEM = BATCH10_NAV_ITEMS.find((item) => item.label === "设置")!;

/** @deprecated Use BATCH8_NAV_ITEMS */
export const BATCH7_NAV_ITEMS = BATCH8_NAV_ITEMS;

interface RegisteredRoute {
  pattern: RegExp;
  title: string;
  returnQueryKeys?: readonly string[];
}

const REGISTERED_ROUTES: readonly RegisteredRoute[] = [
  { pattern: /^\/$/, title: "AreaForge" },
  { pattern: /^\/login$/, title: "登录" },
  { pattern: /^\/setup$/, title: "初始化" },
  { pattern: /^\/today$/, title: "今日行动中心", returnQueryKeys: ["date"] },
  { pattern: /^\/focus$/, title: "开始学习" },
  { pattern: /^\/roadmap$/, title: "路线总览" },
  { pattern: /^\/roadmap\/allocation$/, title: "投入安排", returnQueryKeys: ["date", "subjectId", "status", "q", "createMinimum", "resourceId", "syllabusNodeId", "taskId"] },
  { pattern: /^\/roadmap\/allocation\/drafts$/, title: "投入草稿", returnQueryKeys: ["status", "stableRef", "returnTo"] },
  { pattern: /^\/roadmap\/allocation\/drafts\/[^/]+$/, title: "投入草稿详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/roadmap\/allocation\/tasks\/[^/]+$/, title: "行动详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/roadmap\/stages$/, title: "阶段", returnQueryKeys: ["createMilestone", "returnTo"] },
  { pattern: /^\/roadmap\/stages\/trend$/, title: "阶段趋势", returnQueryKeys: ["window", "returnTo"] },
  { pattern: /^\/roadmap\/reviews$/, title: "周期复盘", returnQueryKeys: ["tab", "period"] },
  { pattern: /^\/roadmap\/reviews\/daily$/, title: "每日复盘" },
  { pattern: /^\/roadmap\/reviews\/history\/[^/]+$/, title: "冻结报告", returnQueryKeys: ["period"] },
  { pattern: /^\/test\/retests$/, title: "专项复测" },
  { pattern: /^\/test\/retests\/new$/, title: "安排专项复测" },
  { pattern: /^\/test\/retests\/[^/]+$/, title: "专项复测详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/test\/simulations$/, title: "模拟考试" },
  { pattern: /^\/test\/simulations\/[^/]+$/, title: "模拟考试详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/confirmations$/, title: "确认中心" },
  { pattern: /^\/confirmations\/history$/, title: "确认记录" },
  { pattern: /^\/confirmations\/[^/]+$/, title: "确认事项详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/reviews\/[^/]+\/run$/, title: "快速复习", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge$/, title: "知识工作台" },
  { pattern: /^\/knowledge\/points$/, title: "知识点", returnQueryKeys: ["subjectId", "q", "masteryStatus", "masteryState"] },
  { pattern: /^\/knowledge\/points\/[^/]+$/, title: "知识点详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/canvas$/, title: "关联画布", returnQueryKeys: ["workspaceId", "subjectId", "syllabusNodeId", "focus", "q"] },
  { pattern: /^\/knowledge\/imports$/, title: "学习树导入", returnQueryKeys: ["mode"] },
  { pattern: /^\/knowledge\/imports\/[^/]+$/, title: "导入批次", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/syllabi$/, title: "考纲", returnQueryKeys: ["subjectId", "q", "status", "map", "action"] },
  { pattern: /^\/knowledge\/syllabi\/[^/]+$/, title: "考纲节点详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/cards$/, title: "知识卡片", returnQueryKeys: ["subjectId", "syllabusNodeId", "taskId", "q", "mastery", "review"] },
  { pattern: /^\/knowledge\/cards\/[^/]+$/, title: "知识卡片详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/mistakes$/, title: "错题", returnQueryKeys: ["subjectId", "syllabusNodeId", "q", "cause", "review"] },
  { pattern: /^\/knowledge\/mistakes\/[^/]+$/, title: "错题详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/resources$/, title: "资料", returnQueryKeys: ["subjectId", "q", "create"] },
  { pattern: /^\/knowledge\/resources\/[^/]+\/preview$/, title: "资料预览", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/resources\/[^/]+$/, title: "资料详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/reviews$/, title: "复习", returnQueryKeys: ["status", "q"] },
  { pattern: /^\/knowledge\/reviews\/[^/]+$/, title: "复习排期详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/settings$/, title: "设置" },
  { pattern: /^\/settings\/exams$/, title: "考试与科目", returnQueryKeys: ["setup"] },
  { pattern: /^\/settings\/profile$/, title: "个人与恢复" },
  { pattern: /^\/settings\/learning$/, title: "学习与提醒" },
  { pattern: /^\/settings\/ai$/, title: "AI 与隐私" },
  { pattern: /^\/settings\/data$/, title: "数据与安全" },
  { pattern: /^\/settings\/system$/, title: "系统与更新" },
] as const;

export function getRouteTitle(pathname: string): string {
  return REGISTERED_ROUTES.find((route) => route.pattern.test(pathname))?.title ?? "页面不存在";
}

/**
 * Detail pages are the third navigation level: the current object is the
 * content area, while the shared secondary rail remains the active
 * workbench's context. The content page must not invent another navigation
 * rail that duplicates the secondary labels.
 */
export function isContentDetailPath(pathname: string): boolean {
  return [
    /^\/roadmap\/allocation\/drafts\/[^/]+$/,
    /^\/roadmap\/allocation\/tasks\/[^/]+$/,
    /^\/roadmap\/reviews\/[^/]+$/,
    /^\/roadmap\/reviews\/history\/[^/]+$/,
    /^\/knowledge\/points\/[^/]+$/,
    /^\/knowledge\/syllabi\/[^/]+$/,
    /^\/knowledge\/resources\/[^/]+(?:\/preview)?$/,
    /^\/knowledge\/cards\/[^/]+$/,
    /^\/knowledge\/mistakes\/[^/]+$/,
    /^\/knowledge\/reviews\/[^/]+$/,
    /^\/knowledge\/reviews\/[^/]+\/run$/,
    /^\/knowledge\/imports\/[^/]+$/,
    /^\/test\/retests\/[^/]+$/,
    /^\/test\/simulations\/[^/]+$/,
    // `/confirmations/history` is the confirmation center's secondary view,
    // not an object detail page. Keep this explicit exclusion next to the
    // generic detail matcher so future route additions do not hide its rail.
    /^\/confirmations\/(?!history$)[^/]+$/,
  ].some((pattern) => pattern.test(pathname));
}

export function isWorkbenchHomePath(pathname: string): boolean {
  return pathname === "/today"
    || pathname === "/roadmap"
    || pathname === "/roadmap/allocation"
    || pathname === "/roadmap/stages"
    || pathname === "/roadmap/reviews"
    || pathname === "/knowledge"
    || pathname === "/test/retests"
    || pathname === "/confirmations"
    || pathname === "/settings"
    || pathname === "/settings/exams";
}

/**
 * Resolve the visible three-level trail from the canonical navigation tree.
 * List pages end at the secondary item; object/detail routes add one content
 * segment so the shell never invents a fourth navigation rail.
 */
export function getNavigationTrail(pathname: string): Array<{ href: string; label: string }> {
  if (pathname.startsWith("/confirmations")) {
    const trail: Array<{ href: string; label: string }> = [{ href: "/confirmations", label: "确认中心" }];
    if (pathname === "/confirmations/history") trail.push({ href: pathname, label: "已处理" });
    else if (pathname !== "/confirmations") trail.push({ href: pathname, label: getRouteTitle(pathname) });
    return trail;
  }
  const primary = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  if (!primary) return [{ href: pathname, label: getRouteTitle(pathname) }];

  const trail: Array<{ href: string; label: string }> = [{ href: primary.href, label: primary.label }];
  const secondary = primary.children?.find((item) => item.match(pathname));
  if (!secondary) {
    const routeTitle = getRouteTitle(pathname);
    if (pathname !== primary.href && routeTitle && routeTitle !== primary.label) {
      trail.push({ href: pathname, label: routeTitle });
    }
    return trail;
  }

  // A secondary item may intentionally reuse the primary route (for example
  // A reused secondary route keeps its label so the visible hierarchy still
  // communicates the business area and the current view.
  if (secondary.label !== primary.label) trail.push({ href: secondary.href, label: secondary.label });
  const routeTitle = getRouteTitle(pathname);
  const isSecondaryPage = pathname === secondary.href;
  if (!isSecondaryPage && routeTitle && routeTitle !== secondary.label) {
    trail.push({ href: pathname, label: routeTitle });
  }
  return trail;
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
  if (!value || value.length > 2_048 || !value.startsWith("/") || value.startsWith("//")) return "/focus";
  try {
    const url = new URL(value, "https://areaforge.invalid");
    if (url.origin !== "https://areaforge.invalid" || url.hash) return "/focus";
    const pathname = url.pathname;
    const route = REGISTERED_ROUTES.find((candidate) => candidate.pattern.test(pathname));
    if (!route || pathname === "/login" || pathname === "/setup") return "/focus";

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
    return `${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return "/focus";
  }
}

export function isBatch8OpenPath(pathname: string): boolean {
  return (
    pathname === "/today" ||
    pathname === "/focus" ||
    pathname === "/roadmap" ||
    pathname.startsWith("/roadmap/") ||
    pathname === "/test/retests" ||
    pathname.startsWith("/test/") ||
    pathname === "/confirmations" ||
    pathname.startsWith("/confirmations/") ||
    pathname === "/knowledge" ||
    pathname.startsWith("/knowledge/") ||
    pathname.startsWith("/settings")
  );
}

/** @deprecated Use isBatch8OpenPath */
export function isBatch7OpenPath(pathname: string): boolean {
  return isBatch8OpenPath(pathname);
}
