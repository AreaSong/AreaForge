import {
  DYNAMIC_ROUTE_PATTERNS,
  ROOT_ROUTES,
  WORKBENCH_ROOT_ROUTES,
  type AppWorkbenchId,
} from "@/lib/navigation/route-helpers";

export type { AppWorkbenchId } from "@/lib/navigation/route-helpers";

export type CanonicalPageTemplate = "dashboard-wide" | "split-view" | "content-focus" | "workspace-full";

export type CanonicalNavigationLevel = "primary" | "secondary" | "content";

export type CanonicalToolbar = "standard" | "none";

interface PublicRouteDefinition {
  path: string;
  title: string;
  shell: "public";
  returnQueryKeys?: readonly string[];
}

interface AppRouteDefinition {
  path: string;
  title: string;
  shell: "app";
  workbench: AppWorkbenchId;
  secondary?: string;
  navigationLevel: CanonicalNavigationLevel;
  template: CanonicalPageTemplate;
  toolbar: CanonicalToolbar;
  returnFallback: string;
  returnQueryKeys?: readonly string[];
}

export type CanonicalRouteDefinition = PublicRouteDefinition | AppRouteDefinition;

export const CANONICAL_ROUTES = [
  { path: ROOT_ROUTES.public, title: "AreaForge", shell: "public" },
  { path: ROOT_ROUTES.login, title: "登录", shell: "public", returnQueryKeys: ["returnTo"] },

  appRoute(WORKBENCH_ROOT_ROUTES.today, "今日行动中心", "today", "primary", "dashboard-wide", WORKBENCH_ROOT_ROUTES.today, {
    toolbar: "none",
    returnQueryKeys: ["date"],
  }),
  appRoute(WORKBENCH_ROOT_ROUTES.focus, "开始学习", "focus", "primary", "workspace-full", WORKBENCH_ROOT_ROUTES.focus, {
    toolbar: "none",
    returnQueryKeys: ["returnTo"],
  }),

  appRoute(WORKBENCH_ROOT_ROUTES.roadmap, "路线总览", "roadmap", "secondary", "dashboard-wide", WORKBENCH_ROOT_ROUTES.roadmap, { secondary: "overview" }),
  appRoute("/roadmap/allocation", "投入安排", "roadmap", "secondary", "dashboard-wide", "/roadmap/allocation", {
    secondary: "allocation",
    returnQueryKeys: ["date", "subjectId", "status", "q", "createMinimum", "resourceId", "syllabusNodeId", "taskId"],
  }),
  appRoute("/roadmap/allocation/drafts", "投入草稿", "roadmap", "secondary", "split-view", "/roadmap/allocation/drafts", {
    secondary: "allocation",
    returnQueryKeys: ["status", "stableRef", "returnTo"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.planInboxItem, "投入草稿详情", "roadmap", "content", "content-focus", "/roadmap/allocation/drafts", {
    secondary: "allocation",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.studyTaskDetail, "行动详情", "roadmap", "content", "content-focus", "/roadmap/allocation", {
    secondary: "allocation",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/roadmap/stages", "阶段", "roadmap", "secondary", "dashboard-wide", "/roadmap/stages", {
    secondary: "stages",
    returnQueryKeys: ["createMilestone", "returnTo"],
  }),
  appRoute("/roadmap/stages/trend", "阶段趋势", "roadmap", "content", "dashboard-wide", "/roadmap/stages", {
    secondary: "stages",
    returnQueryKeys: ["window", "returnTo"],
  }),
  appRoute("/roadmap/reviews", "周期复盘", "roadmap", "secondary", "dashboard-wide", "/roadmap/reviews", {
    secondary: "reviews",
    returnQueryKeys: ["tab", "period"],
  }),
  appRoute("/roadmap/reviews/daily", "每日复盘", "roadmap", "content", "content-focus", "/roadmap/reviews/daily", { secondary: "reviews" }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.periodicReportHistory, "冻结报告", "roadmap", "content", "content-focus", "/roadmap/reviews", {
    secondary: "reviews",
    returnQueryKeys: ["period"],
  }),

  appRoute("/test", "检验中心", "test", "secondary", "dashboard-wide", "/test/retests"),
  appRoute(WORKBENCH_ROOT_ROUTES.test, "专项复测", "test", "secondary", "dashboard-wide", WORKBENCH_ROOT_ROUTES.test, { secondary: "retests" }),
  appRoute("/test/retests/new", "安排专项复测", "test", "content", "content-focus", "/test/retests", {
    secondary: "retests",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.knowledgeRetestDetail, "专项复测详情", "test", "content", "content-focus", WORKBENCH_ROOT_ROUTES.test, {
    secondary: "retests",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/test/simulations", "模拟考试", "test", "secondary", "dashboard-wide", "/test/retests", { secondary: "simulations" }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.simulationExamDetail, "模拟考试详情", "test", "content", "dashboard-wide", WORKBENCH_ROOT_ROUTES.test, {
    secondary: "simulations",
    returnQueryKeys: ["returnTo"],
  }),

  appRoute(WORKBENCH_ROOT_ROUTES.confirmations, "确认中心", "confirmations", "secondary", "content-focus", WORKBENCH_ROOT_ROUTES.today, { toolbar: "none", returnQueryKeys: ["returnTo"] }),
  appRoute("/confirmations/history", "确认记录", "confirmations", "secondary", "content-focus", "/today", { toolbar: "none", returnQueryKeys: ["returnTo"] }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.confirmationDetail, "确认事项详情", "confirmations", "content", "content-focus", WORKBENCH_ROOT_ROUTES.today, {
    toolbar: "none",
    returnQueryKeys: ["returnTo"],
  }),

  appRoute(DYNAMIC_ROUTE_PATTERNS.quickReviewRun, "快速复习", "knowledge", "content", "workspace-full", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "reviews",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute(WORKBENCH_ROOT_ROUTES.knowledge, "知识工作台", "knowledge", "secondary", "dashboard-wide", WORKBENCH_ROOT_ROUTES.knowledge, { secondary: "overview" }),
  appRoute("/knowledge/points", "知识点", "knowledge", "secondary", "split-view", "/knowledge", {
    secondary: "points",
    returnQueryKeys: ["subjectId", "q", "masteryStatus", "masteryState"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.knowledgePointDetail, "知识点详情", "knowledge", "content", "content-focus", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "points",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/knowledge/canvas", "关联画布", "knowledge", "content", "workspace-full", "/knowledge", {
    returnQueryKeys: ["workspaceId", "subjectId", "syllabusNodeId", "focus", "q"],
  }),
  appRoute("/knowledge/imports", "学习树导入", "knowledge", "secondary", "dashboard-wide", "/knowledge", { returnQueryKeys: ["mode"] }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.learningTreeImportDetail, "导入批次", "knowledge", "content", "dashboard-wide", WORKBENCH_ROOT_ROUTES.knowledge, { returnQueryKeys: ["returnTo"] }),
  appRoute("/knowledge/syllabi", "考纲", "knowledge", "secondary", "split-view", "/knowledge", {
    secondary: "syllabi",
    returnQueryKeys: ["subjectId", "q", "status", "map", "action"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.syllabusNodeDetail, "考纲节点详情", "knowledge", "content", "content-focus", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "syllabi",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/knowledge/cards", "知识卡片", "knowledge", "secondary", "split-view", "/knowledge", {
    secondary: "cards",
    returnQueryKeys: ["subjectId", "syllabusNodeId", "taskId", "q", "mastery", "review"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.knowledgeCardDetail, "知识卡片详情", "knowledge", "content", "content-focus", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "cards",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/knowledge/mistakes", "错题", "knowledge", "secondary", "split-view", "/knowledge", {
    secondary: "mistakes",
    returnQueryKeys: ["subjectId", "syllabusNodeId", "q", "cause", "review"],
  }),
  appRoute("/knowledge/mistakes/practice", "错题练习", "knowledge", "content", "workspace-full", "/knowledge/mistakes", {
    secondary: "mistakes",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.mistakeDetail, "错题详情", "knowledge", "content", "content-focus", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "mistakes",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/knowledge/resources", "资料", "knowledge", "secondary", "dashboard-wide", "/knowledge", {
    secondary: "resources",
    returnQueryKeys: ["subjectId", "q", "create"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.studyResourcePreview, "资料预览", "knowledge", "content", "workspace-full", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "resources",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.studyResourceDetail, "资料详情", "knowledge", "content", "content-focus", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "resources",
    returnQueryKeys: ["returnTo"],
  }),
  appRoute("/knowledge/reviews", "复习", "knowledge", "secondary", "split-view", "/knowledge", {
    secondary: "reviews",
    returnQueryKeys: ["status", "q"],
  }),
  appRoute(DYNAMIC_ROUTE_PATTERNS.reviewScheduleDetail, "复习排期详情", "knowledge", "content", "content-focus", WORKBENCH_ROOT_ROUTES.knowledge, {
    secondary: "reviews",
    returnQueryKeys: ["returnTo"],
  }),

  appRoute(WORKBENCH_ROOT_ROUTES.settings, "设置总览", "settings", "secondary", "dashboard-wide", WORKBENCH_ROOT_ROUTES.settings, { secondary: "overview" }),
  appRoute("/settings/exams", "考试与科目", "settings", "secondary", "dashboard-wide", "/settings", {
    secondary: "exams",
    returnQueryKeys: ["setup"],
  }),
  appRoute("/settings/profile", "个人与恢复", "settings", "secondary", "dashboard-wide", "/settings", { secondary: "profile" }),
  appRoute("/settings/learning", "学习与提醒", "settings", "secondary", "dashboard-wide", "/settings", { secondary: "learning" }),
  appRoute("/settings/ai", "AI 与隐私", "settings", "secondary", "dashboard-wide", "/settings", { secondary: "ai" }),
  appRoute("/settings/data", "数据与安全", "settings", "secondary", "dashboard-wide", "/settings", { secondary: "data" }),
  appRoute("/settings/system", "系统与更新", "settings", "secondary", "dashboard-wide", "/settings", { secondary: "system" }),
] as const satisfies readonly CanonicalRouteDefinition[];

export function createCanonicalRoutePattern(routePath: string): RegExp {
  if (routePath === "/") return /^\/$/;
  const source = routePath
    .split("/")
    .filter(Boolean)
    .map((segment) => /^\[[^/]+\]$/.test(segment) ? "[^/]+" : escapeRegExp(segment))
    .join("\\/");
  return new RegExp(`^\\/${source}$`);
}

function appRoute(
  path: string,
  title: string,
  workbench: AppWorkbenchId,
  navigationLevel: CanonicalNavigationLevel,
  template: CanonicalPageTemplate,
  returnFallback: string,
  options: {
    secondary?: string;
    toolbar?: CanonicalToolbar;
    returnQueryKeys?: readonly string[];
  } = {},
): AppRouteDefinition {
  return {
    path,
    title,
    shell: "app",
    workbench,
    navigationLevel,
    template,
    returnFallback,
    ...options,
    toolbar: options.toolbar ?? "standard",
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
