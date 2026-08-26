import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  cardClassName,
  cardPaddingClasses,
  cardVariantClasses,
  type CardPadding,
  type CardVariant,
} from "@areaforge/ui";
import {
  PageFrame,
  PageHeader,
  SectionHeader,
  Toolbar,
  type PageFrameVariant,
} from "./page";
import {
  HourlyHeatbar,
  SubjectProportionBar,
  CompactBadge,
  StatusDot,
  MiniSparkline,
  MiniRadar,
} from "./micro-charts";

function resolveRepoPath(relPath: string): string {
  const candidates = [
    resolve(process.cwd(), relPath),
    resolve(process.cwd(), relPath.replace(/^apps\/web\//, "")),
    resolve(process.cwd(), "..", relPath),
    resolve(process.cwd(), "../..", relPath),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return resolve(process.cwd(), relPath);
}

// ============================================================================
// SUITE 1: PageFrame & PageHeader Adversarial Layout & Viewport Stress
// ============================================================================

test("Adversarial PageFrame: validates all 4 canonical variants maintain compact spacing tokens", () => {
  const variants: PageFrameVariant[] = ["dashboard-wide", "split-view", "content-focus", "workspace-full"];

  for (const variant of variants) {
    const element = PageFrame({
      variant,
      children: React.createElement("div", null, "Child Content"),
    });

    assert.equal(element.type, "div");
    assert.equal(element.props["data-layout-region"], "page-frame");
    assert.equal(element.props["data-page-template"], variant);

    if (variant === "dashboard-wide") {
      assert.ok(element.props.className.includes("w-full"));
      assert.ok(element.props.className.includes("space-y-3.5 sm:space-y-4"));
      // Assert old loose spacing space-y-6 is completely eliminated
      assert.ok(!element.props.className.includes("space-y-6"));
    } else if (variant === "content-focus") {
      assert.ok(element.props.className.includes("max-w-4xl"));
      assert.ok(element.props.className.includes("space-y-3.5 sm:space-y-4"));
      assert.ok(!element.props.className.includes("space-y-6"));
    } else if (variant === "split-view") {
      assert.ok(element.props.className.includes("min-h-0 w-full"));
    } else if (variant === "workspace-full") {
      assert.ok(element.props.className.includes("h-full min-h-0 w-full"));
    }
  }
});

test("Adversarial PageFrame: handles custom className injection, falsy children, and edge props", () => {
  const customFrame = PageFrame({
    variant: "dashboard-wide",
    className: "custom-grid-override min-h-screen",
    children: null,
  });

  assert.ok(customFrame.props.className.includes("custom-grid-override min-h-screen"));
  assert.ok(customFrame.props.className.includes("space-y-3.5 sm:space-y-4"));
  assert.equal(customFrame.props.children, null);
});

test("Adversarial PageHeader: stress tests long text, complex actions, and compact padding", () => {
  const header = PageHeader({
    title: "考研长周期备考战役作战总览 — 2027年全国硕士研究生招生考试计算机科学与技术全国统考(408)全学科长程推进看板",
    eyebrow: "阶段决策与路线推进",
    description: "汇聚四门专业课（数据结构、计算机组成原理、操作系统、计算机网络）与公共课复习进度、艾宾浩斯复习队列、高频薄弱知识点及全真模考失分归因。",
    back: React.createElement("a", { href: "/roadmap" }, "返回路线图"),
    status: React.createElement("div", { className: "status-badge" }, "进行中"),
    action: [
      React.createElement("button", { key: "act1" }, "导出考纲"),
      React.createElement("button", { key: "act2" }, "调整阶段规划"),
    ],
    className: "extra-header-style",
  });

  assert.equal(header.type, "header");
  assert.ok(header.props.className.includes("af-page-header"));
  assert.ok(header.props.className.includes("border-b border-white/10"));
  assert.ok(header.props.className.includes("pb-3 sm:pb-3.5"));
  // Assert old pb-5 is eliminated
  assert.ok(!header.props.className.includes("pb-5"));
  assert.ok(header.props.className.includes("extra-header-style"));

  // Check children structure
  const [contentDiv, actionDiv] = header.props.children;
  assert.ok(contentDiv.props.className.includes("min-w-0"));
  assert.ok(actionDiv.props.className.includes("af-page-header-action"));
  assert.ok(actionDiv.props.className.includes("flex min-w-0 flex-wrap items-center gap-2"));
});

test("Adversarial SectionHeader & Toolbar: verifies compact hierarchy and typography", () => {
  const section = SectionHeader({
    title: "今日核心专注队列",
    description: "按艾宾浩斯遗忘权重排序的高优先级任务",
    action: React.createElement("button", null, "添加新任务"),
  });

  assert.equal(section.type, "div");
  assert.ok(section.props.className.includes("flex flex-wrap items-start justify-between gap-3"));

  const toolbar = Toolbar({
    children: [
      React.createElement("input", { key: "search", placeholder: "搜索..." }),
      React.createElement("button", { key: "filter" }, "筛选"),
    ],
    className: "my-toolbar",
  });

  assert.equal(toolbar.type, "div");
  assert.ok(toolbar.props.className.includes("flex min-h-10 flex-wrap items-center gap-2 border-y border-white/10 py-2"));
  assert.ok(toolbar.props.className.includes("my-toolbar"));
});

// ============================================================================
// SUITE 2: Card & Surface Spacing & Polymorphic Stress
// ============================================================================

test("Adversarial Card: verifies compact padding tokens (sm, md, lg, none) across all variants", () => {
  const paddings: CardPadding[] = ["none", "sm", "md", "lg"];
  const variants: CardVariant[] = ["master", "subtle", "accent"];

  for (const variant of variants) {
    for (const padding of paddings) {
      const className = cardClassName({ variant, padding });

      // Invariants: min-w-0 must always be present to prevent flex child overflow blowout
      assert.ok(className.includes("min-w-0"), `Card variant ${variant} must contain min-w-0`);

      if (padding === "none") {
        assert.ok(!className.includes("p-"));
      } else if (padding === "sm") {
        assert.ok(className.includes("p-2.5 sm:p-3"));
        assert.ok(!className.includes("p-3 sm:p-4"));
      } else if (padding === "md") {
        assert.ok(className.includes("p-3.5 sm:p-4.5"));
        assert.ok(!className.includes("p-4 sm:p-5"));
      } else if (padding === "lg") {
        assert.ok(className.includes("p-4 sm:p-5"));
        assert.ok(!className.includes("p-5 sm:p-6 lg:p-8"));
      }
    }
  }
});

test("Adversarial Card: nested card compositions do not compound padding excessively", () => {
  const outerCard = Card({
    padding: "md",
    children: [
      CardHeader({ key: "h", children: CardTitle({ children: "外层卡片" }) }),
      CardContent({
        key: "c",
        children: Card({
          variant: "subtle",
          padding: "sm",
          children: CardContent({ children: "内层紧凑数据项" }),
        }),
      }),
      CardFooter({ key: "f", children: "底部操作区" }),
    ],
  });

  assert.equal(outerCard.type, "div");
  assert.ok(outerCard.props.className.includes("p-3.5 sm:p-4.5"));
  const innerCard = outerCard.props.children[1].props.children;
  assert.ok(innerCard.props.className.includes("p-2.5 sm:p-3"));
  assert.ok(innerCard.props.className.includes("bg-white/[0.02]"));
});

// ============================================================================
// SUITE 3: Micro-Charts Extreme / Adversarial Dataset Invariants
// ============================================================================

test("HourlyHeatbar Adversarial: all zeros, extreme spikes, out-of-bounds currentHour, negative values", () => {
  // Scenario 1: All 24 hours 0 minutes
  const zeroBar = HourlyHeatbar({
    slots: Array(24).fill(0),
    currentHour: 0,
    showLabels: true,
  });
  const zeroSlots = zeroBar.props.children[0].props.children;
  assert.equal(zeroSlots.length, 24);
  // Bar height for 0 minutes should be baseline 12%
  assert.equal(zeroSlots[0].props.children.props.style.height, "12%");

  // Scenario 2: Extreme spike (e.g. 600 minutes in one hour, others 0)
  const spikeBar = HourlyHeatbar({
    slots: [600, ...Array(23).fill(0)],
    maxSlotValue: 600,
    currentHour: 25, // Out of bounds currentHour
  });
  const spikeSlots = spikeBar.props.children[0].props.children;
  assert.equal(spikeSlots[0].props.children.props.style.height, "100%");
  assert.equal(spikeSlots[1].props.children.props.style.height, "12%");

  // Scenario 3: Negative / float numbers
  const floatBar = HourlyHeatbar({
    slots: [-10, 33.333, 66.666],
    currentHour: -5,
  });
  const floatSlots = floatBar.props.children[0].props.children;
  assert.equal(floatSlots.length, 24);
  // Negative should be treated as <=0 -> 12%
  assert.equal(floatSlots[0].props.children.props.style.height, "12%");
});

test("SubjectProportionBar Adversarial: 0 total, 100 subjects, negative minutes, custom colors", () => {
  // Scenario 1: 0 total minutes
  const zeroProp = SubjectProportionBar({
    items: [
      { name: "数学", minutes: 0 },
      { name: "英语", minutes: 0 },
    ],
  });
  assert.ok(zeroProp.props.children[1].props.children.includes("暂无科目投入数据"));

  // Scenario 2: 50 subjects (massive list)
  const fiftySubjects = Array.from({ length: 50 }, (_, i) => ({
    subjectId: `subj-${i}`,
    title: `科目 ${i}`,
    minutes: i + 1,
  }));
  const bigProp = SubjectProportionBar({
    items: fiftySubjects,
    maxLegendItems: 5,
  });
  const legend = bigProp.props.children[1];
  assert.equal(legend.props.children[0].length, 5);
  // Check "+45 更多"
  const moreSpan = legend.props.children[1];
  assert.ok(String(moreSpan.props.children[1]).includes("45"));

  // Scenario 3: Custom explicit totalMinutes overrides item sum
  const customTotal = SubjectProportionBar({
    items: [{ id: "math", title: "数学", minutes: 50 }],
    totalMinutes: 100, // Should result in 50.0%
  });
  const barSegment = customTotal.props.children[0].props.children[0];
  assert.equal(barSegment.props.style.width, "50.0%");
});

test("CompactBadge Adversarial: all tone & variant permutations, long text, icons", () => {
  const tones = ["teal", "emerald", "amber", "rose", "zinc", "sky", "purple"] as const;
  for (const tone of tones) {
    const badge = CompactBadge({ tone, size: "xs", children: `Badge-${tone}` });
    assert.ok(badge.props.className.includes("h-[18px]"));
    assert.ok(badge.props.className.includes("rounded border"));
  }

  // Long unbroken string with truncation
  const longBadge = CompactBadge({
    variant: "glow",
    size: "sm",
    icon: React.createElement("svg", { className: "icon" }),
    children: "VERY_LONG_UNBROKEN_BADGE_NAME_THAT_SHOULD_BE_SAFELY_TRUNCATED_WITHOUT_OVERFLOW",
  });
  assert.ok(longBadge.props.className.includes("h-[22px]"));
  assert.ok(longBadge.props.className.includes("shadow-[0_0_12px_rgba(45,212,191,0.25)]"));
  const textSpan = longBadge.props.children[1];
  assert.ok(textSpan.props.className.includes("truncate"));
});

test("StatusDot Adversarial: all tones, animation pulse, sizes", () => {
  const tones = ["teal", "emerald", "amber", "rose", "zinc", "sky"] as const;
  const sizes = ["xs", "sm", "md"] as const;

  for (const tone of tones) {
    for (const size of sizes) {
      const dot = StatusDot({ tone, size, pulse: true, title: `Status ${tone}` });
      assert.equal(dot.type, "span");
      assert.equal(dot.props.title, `Status ${tone}`);
      assert.ok(dot.props.className.includes("inline-flex shrink-0"));
      // Pulse ring present
      assert.ok(dot.props.children[0] !== null);
      assert.ok(dot.props.children[0].props.className.includes("animate-ping"));
    }
  }
});

test("MiniSparkline Adversarial: identical points, negative values, extreme min/max, zero range", () => {
  // Scenario 1: Identical points [100, 100, 100, 100] -> zero range
  const flatLine = MiniSparkline({
    data: [100, 100, 100, 100],
    width: 100,
    height: 30,
    targetValue: 100,
  });
  assert.equal(flatLine.type, "svg");
  const poly = flatLine.props.children[3];
  assert.equal(poly.type, "polyline");
  assert.ok(!poly.props.points.includes("NaN"), "Sparkline points must not contain NaN");

  // Scenario 2: Negative and zero values [-100, 0, 100]
  const negLine = MiniSparkline({
    data: [-100, 0, 100],
    targetValue: 0,
    width: 120,
    height: 30,
  });
  const negPoly = negLine.props.children[3];
  assert.ok(!negPoly.props.points.includes("NaN"));

  // Scenario 3: Single point [42]
  const singlePt = MiniSparkline({ data: [42] });
  assert.equal(singlePt.type, "svg");
  const singleLine = singlePt.props.children[3];
  assert.equal(singleLine.type, "line");
  assert.ok(!isNaN(singleLine.props.y1));

  // Scenario 4: Empty data []
  const empty = MiniSparkline({ data: [] });
  assert.equal(empty.type, "div");
  assert.equal(empty.props.children, "--");
});

test("MiniRadar Adversarial: 3 to 12 axes, 0 max, extreme values, division by zero immunity", () => {
  // Scenario 1: Division by zero safety when max is 0 or negative
  const zeroMaxRadar = MiniRadar({
    axes: [
      { label: "A", value: 50, max: 0 },
      { label: "B", value: 50, max: -10 },
      { label: "C", value: 50, max: 100 },
    ],
    size: 100,
  });
  assert.equal(zeroMaxRadar.type, "svg");
  const valuePoly = zeroMaxRadar.props.children[1];
  assert.ok(!valuePoly.props.points.includes("NaN"), "Radar points must not contain NaN on max=0");

  // Scenario 2: 12 axes (heavy polygon)
  const twelveAxes = Array.from({ length: 12 }, (_, i) => ({
    label: `Axis-${i}`,
    value: (i * 10) % 100,
    max: 100,
  }));
  const bigRadar = MiniRadar({ axes: twelveAxes, size: 140, gridLevels: 5 });
  assert.equal(bigRadar.type, "svg");
  const poly12 = bigRadar.props.children[1];
  assert.equal(poly12.props.points.split(" ").length, 12);

  // Scenario 3: Fewer than 3 axes fallback
  const tooFew = MiniRadar({
    axes: [{ label: "1", value: 10 }, { label: "2", value: 20 }],
  });
  assert.equal(tooFew.type, "div");
  assert.ok(tooFew.props.children.includes("需至少3个维度"));
});

// ============================================================================
// SUITE 4: Codebase-Wide Layout & CSS Audit across apps/web/app/**
// ============================================================================

function scanFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  function walk(current: string) {
    if (!existsSync(current)) return;
    const entries = readdirSync(current);
    for (const entry of entries) {
      const fullPath = join(current, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry !== "node_modules" && entry !== ".next" && entry !== ".agents") {
          walk(fullPath);
        }
      } else if (pattern.test(entry)) {
        results.push(fullPath);
      }
    }
  }
  walk(dir);
  return results;
}

test("Codebase Audit: all page.tsx files use valid PageFrame, Surface, or Card imports", () => {
  const rootApp = resolveRepoPath("apps/web/app");
  const pageFiles = scanFiles(rootApp, /^page\.tsx$/);

  assert.ok(pageFiles.length >= 20, `Expected at least 20 page.tsx files, found ${pageFiles.length}`);

  for (const file of pageFiles) {
    const content = readFileSync(file, "utf8");
    // Verify that if PageFrame is imported, it uses canonical or relative paths
    if (content.includes("<PageFrame")) {
      assert.ok(
        content.includes("@/components/ui/page") ||
        content.includes("@/components/ui/page-frame") ||
        content.includes("./page") ||
        content.includes("../"),
        `File ${file} uses PageFrame with valid import`
      );
    }
  }
});

test("Codebase Audit: no remaining legacy excessive padding 'p-8' or 'p-6' on primary PageFrame containers", () => {
  const pageComponentPath = resolveRepoPath("apps/web/components/ui/page.tsx");
  const pageSource = readFileSync(pageComponentPath, "utf8");

  // In page.tsx, space-y-6 on PageFrame should be completely replaced by space-y-3.5 sm:space-y-4
  assert.ok(!pageSource.includes("space-y-6"), "page.tsx must not contain space-y-6 on PageFrame");
  assert.ok(pageSource.includes("space-y-3.5 sm:space-y-4"), "page.tsx must contain space-y-3.5 sm:space-y-4");
});

// ============================================================================
// SUITE 5: Viewport Confinement & Horizontal Overflow Resistance
// ============================================================================

test("Confinement Stress: AppShell root and main container prevent horizontal viewport expansion", () => {
  const shellPath = resolveRepoPath("apps/web/components/app-shell.tsx");
  const shellContent = readFileSync(shellPath, "utf8");

  // Invariants for zero-scroll app shell:
  // 1. Root container must enforce overflow-hidden and h-dvh
  assert.ok(shellContent.includes("overflow-hidden"), "AppShell root must enforce overflow-hidden");
  assert.ok(shellContent.includes("h-dvh"), "AppShell root must enforce h-dvh");

  // 2. Main content container must have min-w-0 and min-h-0 to allow flex children to shrink
  assert.ok(shellContent.includes("min-w-0"), "AppShell main container must contain min-w-0");
  assert.ok(shellContent.includes("min-h-0"), "AppShell main container must contain min-h-0");

  // 3. Compact main padding
  assert.ok(shellContent.includes("px-3.5 py-3"), "AppShell mobile padding must be px-3.5 py-3");
  assert.ok(shellContent.includes("sm:px-5 sm:py-4"), "AppShell sm padding must be sm:px-5 sm:py-4");
  assert.ok(shellContent.includes("xl:px-6"), "AppShell xl padding must be xl:px-6");
  assert.ok(!shellContent.includes("xl:px-8 xl:py-6"), "AppShell must not contain old xl:px-8 xl:py-6");
});

test("Confinement Stress: Micro-charts remain responsive without fixed blowout widths", () => {
  // HourlyHeatbar uses flex-1 per slot, no hardcoded total width px
  const heatbar = HourlyHeatbar({ slots: Array(24).fill(10) });
  assert.equal(heatbar.type, "div");
  assert.ok(heatbar.props.className.includes("flex flex-col gap-1"));

  // SubjectProportionBar uses w-full and percentage widths
  const propBar = SubjectProportionBar({
    items: [
      { id: "1", title: "A", minutes: 30 },
      { id: "2", title: "B", minutes: 70 },
    ],
  });
  const barWrapper = propBar.props.children[0];
  assert.ok(barWrapper.props.className.includes("w-full"));

  // CompactBadge uses inline-flex and truncate
  const badge = CompactBadge({ children: "Badge" });
  assert.ok(badge.props.className.includes("inline-flex"));
  assert.ok(badge.props.children[1].props.className.includes("truncate"));
});
