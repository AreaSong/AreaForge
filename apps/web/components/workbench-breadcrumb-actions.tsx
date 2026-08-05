"use client";

import {
  Archive,
  BarChart3,
  BookOpen,
  BriefcaseBusiness,
  CalendarPlus,
  ClipboardCheck,
  FileInput,
  FilePlus2,
  Flag,
  Goal,
  Inbox,
  LayoutDashboard,
  ListTree,
  Milestone,
  MoreHorizontal,
  Network,
  NotebookPen,
  Plus,
  Repeat2,
  Settings,
  Sparkles,
  TestTube2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { BATCH10_NAV_ITEMS } from "@/lib/navigation/batch7";

interface BreadcrumbAction {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const ACTIONS_BY_ROUTE: Record<string, readonly BreadcrumbAction[]> = {
  "/roadmap/allocation": [
    { href: "/roadmap/allocation?createMinimum=1", label: "新建投入", description: "把下一步行动放入长期计划", icon: Plus },
    { href: "/roadmap/allocation/drafts", label: "投入草稿", description: "处理待确认的计划草稿", icon: Inbox },
  ],
  "/roadmap/allocation/drafts": [
    { href: "/roadmap/allocation?createMinimum=1", label: "新建投入", description: "直接创建一个正式投入", icon: Plus },
    { href: "/roadmap/allocation", label: "投入安排", description: "回到滚动投入与欠账", icon: Goal },
  ],
  "/knowledge": [
    { href: "/knowledge/cards?create=1", label: "新建卡片", description: "留下可复核的学习证据", icon: NotebookPen },
    { href: "/knowledge/canvas", label: "打开关联图谱", description: "查看知识点之间的关系", icon: Network },
  ],
  "/knowledge/points": [
    { href: "/test/retests/new", label: "安排专项复测", description: "选择知识点并检查是否稳定掌握", icon: Repeat2 },
    { href: "/knowledge/syllabi", label: "查看考纲", description: "从考试范围定位知识点", icon: ListTree },
  ],
  "/knowledge/syllabi": [
    { href: "/knowledge/syllabi?create=1", label: "新建考纲节点", description: "补充当前学习范围", icon: Plus },
    { href: "/knowledge/imports?mode=import", label: "导入学习树", description: "预览并确认一批学习结构", icon: FileInput },
  ],
  "/knowledge/resources": [
    { href: "/knowledge/resources?create=1", label: "添加学习资料", description: "上传文件或保存外部资料", icon: FilePlus2 },
    { href: "/knowledge/imports?mode=import", label: "导入学习树", description: "从结构化内容建立知识范围", icon: FileInput },
  ],
  "/knowledge/cards": [
    { href: "/knowledge/cards?create=1", label: "新建卡片", description: "记录理解、边界和例子", icon: NotebookPen },
    { href: "/knowledge/reviews", label: "打开统一复习", description: "处理已经到期的复习证据", icon: ClipboardCheck },
  ],
  "/knowledge/mistakes": [
    { href: "/knowledge/mistakes?create=1", label: "新建错题", description: "留下错因和下一次复习依据", icon: TriangleAlert },
    { href: "/knowledge/reviews", label: "打开统一复习", description: "处理已经到期的复习证据", icon: ClipboardCheck },
  ],
  "/knowledge/reviews": [
    { href: "/knowledge", label: "知识概览", description: "回到当前最重要的知识行动", icon: LayoutDashboard },
    { href: "/test/retests/new", label: "安排专项复测", description: "把稳定掌握交给检验证据", icon: Repeat2 },
  ],
  "/knowledge/canvas": [
    { href: "/knowledge", label: "知识概览", description: "回到当前最重要的知识行动", icon: LayoutDashboard },
    { href: "/knowledge/points", label: "知识点", description: "打开独立知识点对象库", icon: BookOpen },
  ],
  "/knowledge/imports": [
    { href: "/knowledge/imports?mode=import", label: "开始导入", description: "预览结构差异后再确认写入", icon: FileInput },
    { href: "/knowledge/imports?mode=export", label: "导出学习树", description: "生成当前学习结构的本地副本", icon: Archive },
  ],
  "/test/retests": [
    { href: "/test/retests/new", label: "安排专项复测", description: "选择知识点并记录复测计划", icon: Repeat2 },
    { href: "/knowledge/reviews", label: "统一复习", description: "先处理已经到期的复习证据", icon: ClipboardCheck },
  ],
  "/test/simulations": [
    { href: "/test/retests", label: "检验中心", description: "查看两条检验路径", icon: TestTube2 },
    { href: "/roadmap/stages", label: "阶段总览", description: "把考试结果放回长期阶段", icon: Milestone },
  ],
  "/roadmap/stages": [
    { href: "/roadmap/stages?createMilestone=1", label: "新建里程碑", description: "为长期计划建立可观察节点", icon: CalendarPlus },
    { href: "/roadmap/stages/trend", label: "阶段趋势", description: "查看风险和投入变化", icon: BarChart3 },
  ],
  "/roadmap/stages/trend": [
    { href: "/roadmap/stages", label: "阶段总览", description: "回到当前计划与里程碑", icon: Flag },
    { href: "/roadmap/reviews", label: "周期复盘", description: "用周期事实重新判断下一步", icon: BarChart3 },
  ],
  "/roadmap/reviews/daily": [
    { href: "/roadmap/reviews", label: "周期复盘", description: "把每日事实放进周/月判断", icon: BarChart3 },
    { href: "/today", label: "今日行动", description: "回到今天的下一步", icon: CalendarPlus },
  ],
  "/roadmap/reviews": [
    { href: "/today", label: "今日行动", description: "回到今天的下一步", icon: CalendarPlus },
    { href: "/roadmap/allocation/drafts", label: "投入草稿", description: "处理确认后生成的投入草稿", icon: Inbox },
  ],
  "/confirmations": [
    { href: "/confirmations/history", label: "已处理记录", description: "回放已经冻结的决定", icon: Archive },
    { href: "/roadmap/reviews", label: "周期复盘", description: "回到复盘来源核对事实", icon: BarChart3 },
  ],
  "/confirmations/history": [
    { href: "/confirmations", label: "待确认", description: "处理仍需要你决定的事项", icon: ClipboardCheck },
    { href: "/roadmap/reviews", label: "周期复盘", description: "回到复盘来源核对事实", icon: BarChart3 },
  ],
  "/settings/exams": [
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
    { href: "/settings", label: "设置总览", description: "查看其他配置状态", icon: Settings },
  ],
  "/settings/profile": [
    { href: "/settings/exams", label: "考试与科目", description: "管理考试目标与科目", icon: BriefcaseBusiness },
    { href: "/settings/ai", label: "AI 设置", description: "管理 Provider 和数据边界", icon: Sparkles },
  ],
  "/settings/learning": [
    { href: "/settings/profile", label: "档案与动机", description: "管理恢复内容和提醒来源", icon: UserRound },
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
  ],
  "/settings/ai": [
    { href: "/settings/profile", label: "档案与动机", description: "查看 AI 不默认读取的内容边界", icon: UserRound },
    { href: "/settings/system", label: "系统", description: "查看版本与运行状态", icon: Settings },
  ],
  "/settings/system": [
    { href: "/settings/exams", label: "考试与科目", description: "管理考试目标与科目", icon: BriefcaseBusiness },
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
  ],
};

const INLINE_ACTION_LIMIT = 3;

export function WorkbenchBreadcrumbActions({ pathname }: { pathname: string }) {
  const actions = getWorkbenchBreadcrumbActions(pathname);
  if (actions.length === 0) return null;
  const contextLabel = BATCH10_NAV_ITEMS.find((item) => item.match(pathname))?.label
    ?? (pathname.startsWith("/confirmations") ? "确认中心" : "当前工作台");
  const inlineActions = actions.slice(0, INLINE_ACTION_LIMIT);
  const overflowActions = actions.slice(INLINE_ACTION_LIMIT);

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5" data-global-ai-ui="true">
      {inlineActions.map((action) => <InlineActionLink key={`${action.href}:${action.label}`} action={action} />)}
      {overflowActions.length > 0 ? (
        <details className="relative shrink-0">
          <summary
            className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 marker:hidden hover:bg-white/[0.06] [&::-webkit-details-marker]:hidden"
            aria-label={`打开更多${contextLabel}功能`}
            title={`更多${contextLabel}功能`}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
            <span className="hidden sm:inline">更多</span>
          </summary>
          <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 rounded-md border border-white/10 bg-[#101419] p-2 shadow-xl">
            <p className="px-2 py-1 text-xs text-zinc-500">更多{contextLabel}功能</p>
            <div className="mt-1 grid gap-1">
              {overflowActions.map((action) => <OverflowActionLink key={`${action.href}:${action.label}`} action={action} />)}
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function getWorkbenchBreadcrumbActions(pathname: string): readonly BreadcrumbAction[] {
  const routeKey = resolveRouteKey(pathname);
  if (!routeKey) return [];
  const actions = ACTIONS_BY_ROUTE[routeKey] ?? [];
  const primary = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  const secondaryHrefs = new Set(primary?.children?.map((item) => item.href) ?? []);
  return actions.filter((action) => action.href.includes("?") || !secondaryHrefs.has(action.href));
}

function InlineActionLink({ action }: { action: BreadcrumbAction }) {
  const Icon = action.icon;
  return (
    <Link
      href={action.href}
      aria-label={`${action.label}：${action.description}`}
      title={`${action.label}：${action.description}`}
      className="inline-flex h-9 min-w-0 max-w-[min(12rem,42vw)] shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:border-teal-300/40 hover:bg-teal-300/[0.06] hover:text-teal-100 sm:max-w-[16rem]"
    >
      <Icon size={15} className="shrink-0 text-teal-300" aria-hidden="true" />
      <span className="truncate">{action.label}</span>
    </Link>
  );
}

function OverflowActionLink({ action }: { action: BreadcrumbAction }) {
  const Icon = action.icon;
  return (
    <Link href={action.href} className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-white/[0.06]">
      <Icon size={16} className="mt-0.5 shrink-0 text-teal-300" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate text-sm text-zinc-200">{action.label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{action.description}</span>
      </span>
    </Link>
  );
}

function resolveRouteKey(pathname: string): string | null {
  if (pathname.startsWith("/confirmations")) {
    return pathname === "/confirmations/history" ? "/confirmations/history" : "/confirmations";
  }
  const primary = BATCH10_NAV_ITEMS.find((item) => item.match(pathname));
  const secondary = primary?.children?.find((item) => item.match(pathname));
  if (secondary && ACTIONS_BY_ROUTE[secondary.href]) return secondary.href;
  if (primary && ACTIONS_BY_ROUTE[primary.href]) return primary.href;
  return null;
}
