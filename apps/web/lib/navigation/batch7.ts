export interface AppNavigationItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  children?: readonly AppNavigationItem[];
}

const PLAN_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/plan", label: "长期计划", match: (path: string) => path === "/plan" || path.startsWith("/plan/tasks") },
  { href: "/plan/inbox", label: "任务收件箱", match: (path: string) => path.startsWith("/plan/inbox") },
] as const;

const TEST_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/test/retests", label: "专项复测", match: (path: string) => path.startsWith("/test/retests") },
  { href: "/test/simulations", label: "模拟考试", match: (path: string) => path.startsWith("/test/simulations") },
] as const;

const CONFIRMATION_NAV_ITEMS: readonly AppNavigationItem[] = [
  {
    href: "/confirmations",
    label: "待确认",
    match: (path: string) => path === "/confirmations" || (path.startsWith("/confirmations/") && !path.startsWith("/confirmations/history")),
  },
  { href: "/confirmations/history", label: "已处理", match: (path: string) => path.startsWith("/confirmations/history") },
] as const;

export const KNOWLEDGE_TAB_ITEMS = [
  { href: "/knowledge/overview", label: "概览" },
  { href: "/knowledge/points", label: "知识点" },
  { href: "/knowledge/syllabus", label: "考纲" },
  { href: "/knowledge/resources", label: "学习资料" },
  { href: "/knowledge/notes", label: "笔记" },
  { href: "/knowledge/mistakes", label: "错题" },
  { href: "/knowledge/reviews", label: "复习" },
  { href: "/knowledge/canvas", label: "关联图谱" },
  { href: "/knowledge/imports", label: "学习树导入" },
] as const;

export const REVIEW_TAB_ITEMS = [
  { href: "/review/daily", label: "今日复盘" },
  { href: "/review/reports", label: "周期报告" },
] as const;

export const STAGE_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/plan/stages", label: "阶段总览", match: (path: string) => path === "/plan/stages" },
  { href: "/plan/stages/analytics", label: "阶段趋势", match: (path: string) => path.startsWith("/plan/stages/analytics") },
] as const;

export const SETTINGS_TAB_ITEMS = [
  { href: "/settings/workspace", label: "工作区" },
  { href: "/settings/profile", label: "档案" },
  { href: "/settings/notifications", label: "通知" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/experience", label: "体验" },
  { href: "/settings/system", label: "系统" },
] as const;

export const BATCH10_NAV_ITEMS: readonly AppNavigationItem[] = [
  { href: "/focus", label: "开始学习", match: (path: string) => path === "/focus" || path.startsWith("/focus/") },
  {
    href: "/today",
    label: "今日",
    match: (path: string) => path === "/today",
  },
  {
    href: "/plan",
    label: "计划",
    match: (path: string) => PLAN_NAV_ITEMS.some((item) => item.match(path)),
    children: PLAN_NAV_ITEMS,
  },
  {
    href: "/knowledge/overview",
    label: "知识",
    match: (path: string) => path === "/knowledge" || path.startsWith("/knowledge/") || path.startsWith("/quick-review/"),
    children: KNOWLEDGE_TAB_ITEMS.map((item) => ({
      ...item,
      match: (path: string) => item.href === "/knowledge/reviews"
        ? path === item.href || path.startsWith(`${item.href}/`) || path.startsWith("/quick-review/")
        : path === item.href || path.startsWith(`${item.href}/`),
    })),
  },
  {
    href: "/test",
    label: "检验",
    match: (path: string) => path === "/test" || TEST_NAV_ITEMS.some((item) => item.match(path)),
    children: TEST_NAV_ITEMS,
  },
  {
    href: "/plan/stages",
    label: "阶段",
    match: (path: string) => STAGE_NAV_ITEMS.some((item) => item.match(path)),
    children: STAGE_NAV_ITEMS,
  },
  {
    href: "/review/daily",
    label: "复盘",
    match: (path: string) => path === "/review" || path.startsWith("/review/"),
    children: REVIEW_TAB_ITEMS.map((item) => ({ ...item, match: (path: string) => path === item.href || path.startsWith(`${item.href}/`) })),
  },
  {
    href: "/confirmations",
    label: "确认中心",
    match: (path: string) => path === "/confirmations" || path.startsWith("/confirmations/"),
    children: CONFIRMATION_NAV_ITEMS,
  },
  {
    href: "/settings/workspace",
    label: "设置",
    match: (path: string) => path === "/settings" || path.startsWith("/settings/"),
    children: SETTINGS_TAB_ITEMS.map((item) => ({ ...item, match: (path: string) => path === item.href || path.startsWith(`${item.href}/`) })),
  },
] as const;

export const BATCH8_NAV_ITEMS = BATCH10_NAV_ITEMS;

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
  { pattern: /^\/plan$/, title: "长期计划", returnQueryKeys: ["date", "subjectId", "status", "q", "createMinimum", "resourceId", "syllabusNodeId", "taskId"] },
  { pattern: /^\/plan\/stages$/, title: "阶段总览" },
  { pattern: /^\/plan\/stages\/analytics$/, title: "阶段趋势" },
  { pattern: /^\/plan\/inbox$/, title: "计划收件箱", returnQueryKeys: ["status", "stableRef", "returnTo"] },
  { pattern: /^\/plan\/inbox\/[^/]+$/, title: "计划草稿详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/plan\/tasks\/[^/]+$/, title: "任务详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/test$/, title: "检验中心" },
  { pattern: /^\/test\/retests$/, title: "专项复测" },
  { pattern: /^\/test\/retests\/new$/, title: "安排专项复测" },
  { pattern: /^\/test\/retests\/[^/]+$/, title: "专项复测详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/test\/simulations$/, title: "模拟考试" },
  { pattern: /^\/test\/simulations\/[^/]+$/, title: "模拟考试详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/confirmations$/, title: "确认中心" },
  { pattern: /^\/confirmations\/history$/, title: "确认记录" },
  { pattern: /^\/confirmations\/[^/]+$/, title: "确认事项详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/focus\/[^/]+$/, title: "专注计时", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/quick-review\/[^/]+$/, title: "快速复习", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge$/, title: "知识工作台" },
  { pattern: /^\/knowledge\/points$/, title: "知识点", returnQueryKeys: ["subjectId", "q", "masteryStatus", "masteryState"] },
  { pattern: /^\/knowledge\/points\/[^/]+$/, title: "知识点详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/canvas$/, title: "关联画布", returnQueryKeys: ["workspaceId", "subjectId", "syllabusNodeId", "focus", "q"] },
  { pattern: /^\/knowledge\/overview$/, title: "知识概览", returnQueryKeys: ["q"] },
  { pattern: /^\/knowledge\/imports$/, title: "学习树导入", returnQueryKeys: ["mode"] },
  { pattern: /^\/knowledge\/imports\/[^/]+$/, title: "导入批次", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/syllabus$/, title: "考纲", returnQueryKeys: ["subjectId", "q", "status", "map", "action"] },
  { pattern: /^\/knowledge\/syllabus\/[^/]+$/, title: "考纲节点详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/notes$/, title: "知识卡片", returnQueryKeys: ["subjectId", "syllabusNodeId", "taskId", "q", "mastery", "review"] },
  { pattern: /^\/knowledge\/notes\/[^/]+$/, title: "知识卡片详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/mistakes$/, title: "错题", returnQueryKeys: ["subjectId", "syllabusNodeId", "q", "cause", "review"] },
  { pattern: /^\/knowledge\/mistakes\/[^/]+$/, title: "错题详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/resources$/, title: "资料", returnQueryKeys: ["subjectId", "q", "create"] },
  { pattern: /^\/knowledge\/resources\/[^/]+\/preview$/, title: "资料预览", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/resources\/[^/]+$/, title: "资料详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/knowledge\/reviews$/, title: "统一复习", returnQueryKeys: ["status", "q"] },
  { pattern: /^\/knowledge\/reviews\/[^/]+$/, title: "复习排期详情", returnQueryKeys: ["returnTo"] },
  { pattern: /^\/review$/, title: "复盘" },
  { pattern: /^\/review\/daily$/, title: "晚间复盘" },
  { pattern: /^\/review\/reports$/, title: "周期报告", returnQueryKeys: ["tab", "period"] },
  { pattern: /^\/review\/reports\/history\/[^/]+$/, title: "冻结报告", returnQueryKeys: ["period"] },
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

/**
 * Detail pages are the third navigation level: the current object is the
 * content, so rendering the workbench's secondary rail again only duplicates
 * the breadcrumb context. List/workbench pages continue to render the rail.
 */
export function isContentDetailPath(pathname: string): boolean {
  return [
    /^\/plan\/tasks\/[^/]+$/,
    /^\/plan\/inbox\/[^/]+$/,
    /^\/knowledge\/points\/[^/]+$/,
    /^\/knowledge\/syllabus\/[^/]+$/,
    /^\/knowledge\/resources\/[^/]+(?:\/preview)?$/,
    /^\/knowledge\/notes\/[^/]+$/,
    /^\/knowledge\/mistakes\/[^/]+$/,
    /^\/knowledge\/reviews\/[^/]+$/,
    /^\/knowledge\/imports\/[^/]+$/,
    /^\/test\/retests\/new$/,
    /^\/test\/retests\/[^/]+$/,
    /^\/test\/simulations\/[^/]+$/,
    /^\/review\/reports\/history\/[^/]+$/,
    // `/confirmations/history` is the confirmation center's secondary view,
    // not an object detail page. Keep this explicit exclusion next to the
    // generic detail matcher so future route additions do not hide its rail.
    /^\/confirmations\/(?!history$)[^/]+$/,
  ].some((pattern) => pattern.test(pathname));
}

export function isWorkbenchHomePath(pathname: string): boolean {
  return pathname === "/today"
    || pathname === "/plan"
    || pathname === "/knowledge"
    || pathname === "/knowledge/overview"
    || pathname === "/test"
    || pathname === "/plan/stages"
    || pathname === "/review"
    || pathname === "/review/daily"
    || pathname === "/confirmations"
    || pathname === "/settings"
    || pathname === "/settings/workspace";
}

/**
 * Resolve the visible three-level trail from the canonical navigation tree.
 * List pages end at the secondary item; object/detail routes add one content
 * segment so the shell never invents a fourth navigation rail.
 */
export function getNavigationTrail(pathname: string): Array<{ href: string; label: string }> {
  const primary = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  if (!primary) return [{ href: "/focus", label: "开始学习" }, { href: pathname, label: getRouteTitle(pathname) }];

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
  // /plan and /confirmations). Keep its label so the visible hierarchy still
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
    pathname.startsWith("/focus/") ||
    pathname === "/plan" ||
    pathname.startsWith("/plan/") ||
    pathname === "/test" ||
    pathname.startsWith("/test/") ||
    pathname === "/confirmations" ||
    pathname.startsWith("/confirmations/") ||
    pathname.startsWith("/quick-review/") ||
    pathname === "/knowledge" ||
    pathname.startsWith("/knowledge/") ||
    pathname.startsWith("/settings")
    || pathname.startsWith("/review/")
  );
}

/** @deprecated Use isBatch8OpenPath */
export function isBatch7OpenPath(pathname: string): boolean {
  return isBatch8OpenPath(pathname);
}
