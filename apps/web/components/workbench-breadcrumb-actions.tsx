"use client";

import { Button } from "@/components/ui/button";
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
  Route,
  Settings,
  Sparkles,
  TestTube2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { APP_NAVIGATION_ITEMS } from "@/lib/navigation/app-navigation";

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
    { href: "/settings/profile", label: "个人与恢复", description: "查看档案、动机和恢复内容", icon: UserRound },
  ],
  "/settings/profile": [
    { href: "/settings/exams", label: "考试与科目", description: "管理考试目标与科目", icon: BriefcaseBusiness },
    { href: "/settings/ai", label: "AI 设置", description: "管理 Provider 和数据边界", icon: Sparkles },
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
  ],
  "/settings/learning": [
    { href: "/settings/profile", label: "档案与动机", description: "管理恢复内容和提醒来源", icon: UserRound },
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
  ],
  "/settings/ai": [
    { href: "/settings/profile", label: "档案与动机", description: "查看 AI 不默认读取的内容边界", icon: UserRound },
    { href: "/settings/system", label: "系统", description: "查看版本与运行状态", icon: Settings },
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
  ],
  "/settings/data": [
    { href: "/settings/system", label: "系统与更新", description: "查看版本和运行状态", icon: Settings },
  ],
  "/settings/system": [
    { href: "/settings/exams", label: "考试与科目", description: "管理考试目标与科目", icon: BriefcaseBusiness },
    { href: "/today", label: "今日行动", description: "返回当前学习闭环", icon: CalendarPlus },
  ],
  "/roadmap": [
    { href: "/focus", label: "开始学习", description: "进入当前科目的专注计时", icon: Route },
    { href: "/roadmap/allocation", label: "投入安排", description: "查看接下来七天的学习投入", icon: ClipboardCheck },
    { href: "/roadmap/reviews", label: "周期复盘", description: "用周期事实判断下一步", icon: BarChart3 },
  ],
};

export function WorkbenchBreadcrumbActions({ currentHref, pathname }: { currentHref: string; pathname: string }) {
  const actions = getWorkbenchBreadcrumbActions(pathname, currentHref);
  if (actions.length === 0) return null;
  return <ResponsiveBreadcrumbActionGroup actions={actions} contextLabel={getContextLabel(pathname)} />;
}

function getContextLabel(pathname: string): string {
  return APP_NAVIGATION_ITEMS.find((item) => item.match(pathname))?.label
    ?? (pathname.startsWith("/confirmations") ? "确认中心" : "当前工作台");
}

function ResponsiveBreadcrumbActionGroup(props: { actions: readonly BreadcrumbAction[]; contextLabel: string }) {
  const groupRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const moreMenuId = useId();
  const [visibleCount, setVisibleCount] = useState(props.actions.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const actionSignature = props.actions.map((action) => `${action.href}:${action.label}`).join("|");

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && moreRef.current?.contains(target)) return;
      setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMoreOpen(false);
        moreTriggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const firstItem = moreRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus({ preventScroll: true });
  }, [moreOpen]);

  useEffect(() => {
    const measurement = measureRef.current;
    const update = () => {
      if (!measurement) return;
      const widths = Array.from(measurement.querySelectorAll<HTMLElement>("[data-page-action-measure]")).map((item) => item.getBoundingClientRect().width);
      if (widths.length !== props.actions.length) return;
      const moreWidth = measurement.querySelector<HTMLElement>("[data-page-action-more-measure]")?.getBoundingClientRect().width ?? 78;
      const availableWidth = groupRef.current?.clientWidth ?? 0;
      setVisibleCount(calculateVisibleActionCount(availableWidth, widths, moreWidth));
    };
    update();
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (groupRef.current) observer?.observe(groupRef.current);
    if (measurement) observer?.observe(measurement);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [actionSignature, props.actions.length]);

  const visibleActions = props.actions.slice(0, visibleCount);
  const overflowActions = props.actions.slice(visibleCount);

  return (
    <div ref={groupRef} className="relative flex min-w-0 max-w-full flex-nowrap items-center justify-end gap-1.5" data-global-ai-ui="true">
      <div ref={measureRef} className="pointer-events-none invisible absolute left-0 top-0 flex h-0 w-max gap-1.5 overflow-hidden" aria-hidden="true">
        {props.actions.map((action) => <InlineActionLink key={`${action.href}:${action.label}`} action={action} measure />)}
        <span data-page-action-more-measure className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs"><MoreHorizontal size={16} aria-hidden="true" /><span className="hidden sm:inline">更多</span></span>
      </div>
      {visibleActions.map((action) => <InlineActionLink key={`${action.href}:${action.label}`} action={action} />)}
      {overflowActions.length > 0 ? (
        <div ref={moreRef} className="relative shrink-0">
          <Button
            ref={moreTriggerRef}
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:bg-white/[0.06]"
            aria-label={`打开更多${props.contextLabel}功能`}
            title={`更多${props.contextLabel}功能`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreMenuId}
            onClick={() => setMoreOpen((current) => !current)}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
            <span className="hidden sm:inline">更多</span>
          </Button>
          {moreOpen ? (
            <div
              id={moreMenuId}
              role="menu"
              aria-label={`更多${props.contextLabel}功能`}
              className="absolute right-0 top-[calc(100%+0.5rem)] z-[var(--af-layer-page-popover)] w-72 min-w-0 max-w-[calc(100vw-2rem)] rounded-md border border-white/10 bg-[#101419] p-2 shadow-xl"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMoreOpen(false);
                  moreTriggerRef.current?.focus({ preventScroll: true });
                  return;
                }
                if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                const items = Array.from(moreRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
                if (items.length === 0) return;
                event.preventDefault();
                const currentIndex = items.indexOf(document.activeElement as HTMLElement);
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
                items[nextIndex]?.focus({ preventScroll: true });
              }}
            >
              <p className="px-2 py-1 text-xs text-zinc-500">更多{props.contextLabel}功能</p>
              <div className="mt-1 grid gap-1">
                {overflowActions.map((action) => <OverflowActionLink key={`${action.href}:${action.label}`} action={action} onNavigate={() => setMoreOpen(false)} />)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function calculateVisibleActionCount(
  availableWidth: number,
  itemWidths: readonly number[],
  moreWidth: number,
  gap = 6,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0 || itemWidths.length === 0) return 0;
  const allWidth = itemWidths.reduce((sum, width) => sum + Math.max(0, width), 0)
    + gap * Math.max(0, itemWidths.length - 1);
  if (allWidth <= availableWidth) return itemWidths.length;
  let used = 0;
  let visible = 0;
  for (const width of itemWidths) {
    const next = used + (visible > 0 ? gap : 0) + Math.max(0, width);
    const hidden = itemWidths.length - visible - 1;
    const reserveMore = hidden > 0 ? gap + Math.max(0, moreWidth) : 0;
    if (next + reserveMore > availableWidth) break;
    used = next;
    visible += 1;
  }
  return visible;
}

export function getWorkbenchBreadcrumbActions(pathname: string, currentHref?: string): readonly BreadcrumbAction[] {
  const routeKey = resolveRouteKey(pathname);
  if (!routeKey) return [];
  if (routeKey === "/knowledge/imports") {
    const mode = readQueryParam(currentHref, "mode");
    if (mode === "import") {
      return [
        { href: "/knowledge/imports", label: "导入历史", description: "回到已确认的学习树批次", icon: Archive },
        { href: "/knowledge/imports?mode=export", label: "导出学习树", description: "生成当前学习结构的本地副本", icon: Archive },
      ];
    }
    if (mode === "export") {
      return [
        { href: "/knowledge/imports", label: "导入历史", description: "回到已确认的学习树批次", icon: Archive },
        { href: "/knowledge/imports?mode=import", label: "开始导入", description: "预览结构差异后再确认写入", icon: FileInput },
      ];
    }
    return [
      { href: "/knowledge/imports?mode=import", label: "开始导入", description: "预览结构差异后再确认写入", icon: FileInput },
      { href: "/knowledge/imports?mode=export", label: "导出学习树", description: "生成当前学习结构的本地副本", icon: Archive },
    ];
  }
  const actions = ACTIONS_BY_ROUTE[routeKey] ?? [];
  const primary = APP_NAVIGATION_ITEMS.find((item) => item.match(pathname));
  const secondaryHrefs = new Set(primary?.children?.map((item) => item.href) ?? []);
  return actions.filter((action) => action.href.includes("?") || !secondaryHrefs.has(action.href));
}

function InlineActionLink({ action, measure = false }: { action: BreadcrumbAction; measure?: boolean }) {
  const Icon = action.icon;
  return (
    <Link
      href={action.href}
      aria-label={`${action.label}：${action.description}`}
      title={`${action.label}：${action.description}`}
      className={`inline-flex h-9 min-w-0 max-w-[min(12rem,42vw)] shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-zinc-300 hover:border-teal-300/40 hover:bg-teal-300/[0.06] hover:text-teal-100 sm:max-w-[16rem] ${measure ? "pointer-events-none" : ""}`}
      data-page-action-measure={measure ? "true" : undefined}
      aria-hidden={measure ? true : undefined}
    >
      <Icon size={15} className="shrink-0 text-teal-300" aria-hidden="true" />
      <span className="truncate">{action.label}</span>
    </Link>
  );
}

function OverflowActionLink({ action, onNavigate }: { action: BreadcrumbAction; onNavigate?: () => void }) {
  const Icon = action.icon;
  return (
    <Link href={action.href} role="menuitem" tabIndex={0} onClick={onNavigate} className="flex min-w-0 items-start gap-3 rounded-md px-2 py-2.5 text-left hover:bg-white/[0.06]">
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
  // Low-frequency tools such as imports and canvas are intentionally not
  // secondary-nav entries, but they still own their page-level commands. Pick
  // the longest explicit route key before falling back to the workbench home;
  // otherwise /knowledge/imports would incorrectly inherit /knowledge actions.
  const explicitRouteKey = Object.keys(ACTIONS_BY_ROUTE)
    .filter((key) => pathname === key || pathname.startsWith(`${key}/`))
    .sort((left, right) => right.length - left.length)[0];
  if (explicitRouteKey) return explicitRouteKey;

  const primary = APP_NAVIGATION_ITEMS.find((item) => item.match(pathname));
  const secondary = primary?.children?.find((item) => item.match(pathname));
  if (secondary && ACTIONS_BY_ROUTE[secondary.href]) return secondary.href;
  if (primary && ACTIONS_BY_ROUTE[primary.href]) return primary.href;
  return null;
}

function readQueryParam(value: string | undefined, key: string): string | null {
  if (!value) return null;
  try {
    return new URL(value, "https://areaforge.invalid").searchParams.get(key);
  } catch {
    return null;
  }
}
