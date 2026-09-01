import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {
  HourlyHeatbar,
  SubjectProportionBar,
  CompactBadge,
  StatusDot,
  MiniSparkline,
  MiniRadar,
} from "./micro-charts";

// ============================================================================
// 1. HourlyHeatbar Unit & Boundary Tests
// ============================================================================

test("HourlyHeatbar: renders 24 hourly slots and handles max scaling gracefully", () => {
  const hourlyData = [
    0, 0, 0, 0, 0, 0,
    15, 45, 60, 30, 0, 0,
    0, 20, 50, 0, 0, 0,
    30, 60, 45, 10, 0, 0,
  ];

  let clickedHour = -1;
  let clickedMinutes = -1;

  const element = HourlyHeatbar({
    slots: hourlyData,
    currentHour: 14,
    height: 24,
    showLabels: true,
    onSlotClick: (hour, min) => {
      clickedHour = hour;
      clickedMinutes = min;
    },
  });

  assert.equal(element.type, "div");
  assert.equal(element.props.role, "region");
  assert.ok(element.props["aria-label"].includes("24小时"));

  // Check slot container
  const container = element.props.children[0];
  assert.equal(container.props.children.length, 24);

  // Check slot 8 (60 mins, max value)
  const slot8 = container.props.children[8];
  assert.equal(slot8.props.title, "08:00 - 60 分钟");
  slot8.props.onClick();
  assert.equal(clickedHour, 8);
  assert.equal(clickedMinutes, 60);

  // Check slot 14 (current hour)
  const slot14 = container.props.children[14];
  const bar14 = slot14.props.children;
  assert.ok(bar14.props.className.includes("bg-teal-300"));
  assert.ok(bar14.props.className.includes("ring-1"));

  // Check labels container
  const labels = element.props.children[1];
  const labelChildren = labels.props.children as Array<React.ReactElement<{ children: string }>>;
  assert.ok(labelChildren.some((c) => c.props.children === "00:00"));
  assert.ok(labelChildren.some((c) => c.props.children === "23:00"));
});

test("HourlyHeatbar: handles empty, undefined, or missing slots without NaN or crashes", () => {
  const element1 = HourlyHeatbar({});
  assert.equal(element1.type, "div");
  const container1 = element1.props.children[0];
  assert.equal(container1.props.children.length, 24);

  // Using hourlyMinutes alias
  const element2 = HourlyHeatbar({
    hourlyMinutes: [10, 20],
    showLabels: false,
  });
  const container2 = element2.props.children[0];
  assert.equal(container2.props.children.length, 24);
  assert.equal(element2.props.children[1], null);
});

// ============================================================================
// 2. SubjectProportionBar Unit & Boundary Tests
// ============================================================================

test("SubjectProportionBar: computes segment percentages and renders legend items", () => {
  const subjects = [
    { subjectId: "math", title: "高等数学", minutes: 120, colorClass: "bg-teal-400" },
    { subjectId: "cs", title: "数据结构", minutes: 60, colorClass: "bg-sky-400" },
    { subjectId: "en", title: "考研英语", minutes: 60, colorClass: "bg-amber-400" },
  ];

  const element = SubjectProportionBar({
    items: subjects,
    totalMinutes: 240,
    height: 8,
    showLegend: true,
    maxLegendItems: 4,
  });

  assert.equal(element.type, "div");
  assert.equal(element.props.role, "region");

  // Bar container
  const bar = element.props.children[0];
  assert.equal(bar.props.style.height, "8px");
  assert.equal(bar.props.children.length, 3);

  // Math segment: 120 / 240 = 50.0%
  const mathSeg = bar.props.children[0];
  assert.equal(mathSeg.props.style.width, "50.0%");
  assert.ok(mathSeg.props.title.includes("高等数学: 120分钟 (50.0%)"));

  // Legend
  const legend = element.props.children[1];
  assert.ok(legend !== null);
  assert.equal(legend.props.children[0].length, 3);
});

test("SubjectProportionBar: handles 0 total minutes or empty list safely", () => {
  const emptyElement = SubjectProportionBar({ items: [] });
  assert.equal(emptyElement.type, "div");

  const zeroElement = SubjectProportionBar({
    items: [{ id: "math", name: "数学", durationMinutes: 0 }],
  });
  assert.equal(zeroElement.type, "div");
});

test("SubjectProportionBar: handles overflow beyond maxLegendItems", () => {
  const manySubjects = Array.from({ length: 8 }, (_, i) => ({
    id: `sub-${i}`,
    title: `科目${i + 1}`,
    minutes: 30,
  }));

  const element = SubjectProportionBar({
    items: manySubjects,
    maxLegendItems: 3,
  });

  const legend = element.props.children[1];
  assert.equal(legend.props.children[0].length, 3);
  const moreIndicator = legend.props.children[1];
  const moreText = Array.isArray(moreIndicator.props.children)
    ? moreIndicator.props.children.join("")
    : String(moreIndicator.props.children);
  assert.ok(moreText.includes("+5 更多"));
});

// ============================================================================
// 3. CompactBadge Unit & Styling Tests
// ============================================================================

test("CompactBadge: supports all variants, tone aliases, and sizes", () => {
  // Primary variant
  const primaryBadge = CompactBadge({
    variant: "primary",
    size: "xs",
    children: "高优先级",
  });
  assert.ok(primaryBadge.props.className.includes("text-teal-300"));
  assert.ok(primaryBadge.props.className.includes("h-[18px]"));

  // Glow variant
  const glowBadge = CompactBadge({
    variant: "glow",
    size: "sm",
    children: "今日核心",
  });
  assert.ok(glowBadge.props.className.includes("shadow-[0_0_12px_rgba(45,212,191,0.25)]"));
  assert.ok(glowBadge.props.className.includes("h-[22px]"));

  // Success / Amber / Danger / Info / Neutral
  const successBadge = CompactBadge({ variant: "success", children: "已通过" });
  assert.ok(successBadge.props.className.includes("text-emerald-300"));

  const warningBadge = CompactBadge({ variant: "warning", children: "遗忘预警" });
  assert.ok(warningBadge.props.className.includes("text-amber-300"));

  const dangerBadge = CompactBadge({ variant: "danger", children: "严重逾期" });
  assert.ok(dangerBadge.props.className.includes("text-rose-300"));

  const infoBadge = CompactBadge({ variant: "info", children: "待同步" });
  assert.ok(infoBadge.props.className.includes("text-sky-300"));

  const neutralBadge = CompactBadge({ variant: "neutral", children: "默认" });
  assert.ok(neutralBadge.props.className.includes("text-zinc-400"));

  // Tone alias support
  const toneBadge = CompactBadge({ tone: "amber", children: "Amber Tone" });
  assert.ok(toneBadge.props.className.includes("text-amber-300"));
});

// ============================================================================
// 4. StatusDot Unit & Animation Tests
// ============================================================================

test("StatusDot: renders pulsing and static status indicators", () => {
  // Active pulsing dot
  const activeDot = StatusDot({
    status: "active",
    pulse: true,
    size: "sm",
    title: "正在学习",
  });
  assert.equal(activeDot.type, "span");
  assert.ok(activeDot.props.className.includes("size-2.5"));
  assert.equal(activeDot.props.title, "正在学习");
  // Has pulse ring
  assert.ok(activeDot.props.children[0] !== null);
  assert.ok(activeDot.props.children[0].props.className.includes("animate-ping"));
  // Core dot
  const coreDot = activeDot.props.children[1];
  assert.ok(coreDot.props.className.includes("bg-teal-400"));

  // Idle static dot
  const idleDot = StatusDot({ status: "idle", pulse: false });
  assert.equal(idleDot.props.children[0], null); // No ping
  assert.ok(idleDot.props.children[1].props.className.includes("bg-zinc-600"));

  // Tone alias support
  const emeraldDot = StatusDot({ tone: "emerald" });
  assert.ok(emeraldDot.props.children[1].props.className.includes("bg-emerald-400"));
});

// ============================================================================
// 5. MiniSparkline Unit & SVG Tests
// ============================================================================

test("MiniSparkline: generates valid SVG coordinates, area path, and target line", () => {
  const trendData = [65, 70, 68, 85, 92, 88, 95];
  const element = MiniSparkline({
    data: trendData,
    targetValue: 80,
    width: 120,
    height: 28,
    fill: true,
    showLastPoint: true,
    showTarget: true,
  });

  assert.equal(element.type, "svg");
  assert.equal(element.props.width, 120);
  assert.equal(element.props.height, 28);
  assert.equal(element.props.role, "img");

  // Defs & gradient
  const defs = element.props.children[0];
  assert.equal(defs.type, "defs");

  // Target line
  const targetLine = element.props.children[1];
  assert.ok(targetLine !== null);
  assert.equal(targetLine.type, "line");
  assert.equal(targetLine.props.stroke, "#fbbf24");

  // Area path
  const areaPath = element.props.children[2];
  assert.ok(areaPath !== null);
  assert.equal(areaPath.type, "path");
  assert.ok(areaPath.props.d.startsWith("M "));
  assert.ok(areaPath.props.d.endsWith(" Z"));

  // Polyline
  const polyline = element.props.children[3];
  assert.equal(polyline.type, "polyline");
  const pts = polyline.props.points.split(" ");
  assert.equal(pts.length, 7);

  // Terminal glowing dot
  const lastDotGroup = element.props.children[4];
  assert.ok(lastDotGroup !== null);
});

test("MiniSparkline: handles empty array and 1-element edge cases safely", () => {
  const empty = MiniSparkline({ data: [] });
  assert.equal(empty.type, "div");
  assert.equal(empty.props.children, "--");

  const single = MiniSparkline({ data: [50] });
  assert.equal(single.type, "svg");
  const singleLine = single.props.children[3];
  assert.equal(singleLine.type, "line");
});

// ============================================================================
// 6. MiniRadar Unit & Geometry Tests
// ============================================================================

test("MiniRadar: computes polygonal vertices and spoke lines for multi-axis data", () => {
  const axes = [
    { label: "高数", value: 85, max: 100 },
    { label: "线代", value: 70, max: 100 },
    { label: "概统", value: 60, max: 100 },
    { label: "数据结构", value: 90, max: 100 },
    { label: "计组", value: 75, max: 100 },
  ];

  const element = MiniRadar({
    axes,
    size: 120,
    showGrid: true,
    showLabels: true,
    gridLevels: 3,
  });

  assert.equal(element.type, "svg");
  assert.equal(element.props.width, 120);
  assert.equal(element.props.height, 120);

  // Grid container
  const grid = element.props.children[0];
  assert.ok(grid !== null);

  // Value polygon
  const valuePoly = element.props.children[1];
  assert.equal(valuePoly.type, "polygon");
  const valuePoints = valuePoly.props.points.split(" ");
  assert.equal(valuePoints.length, 5);

  // Vertex dots
  const vertexDots = element.props.children[2];
  assert.equal(vertexDots.length, 5);

  // Labels
  const labels = element.props.children[3];
  assert.equal(labels.length, 5);
  assert.equal(labels[0].props.children, "高数");
});

test("MiniRadar: handles fewer than 3 dimensions safely without NaN", () => {
  const element = MiniRadar({
    axes: [
      { label: "高数", value: 85 },
      { label: "线代", value: 70 },
    ],
  });

  assert.equal(element.type, "div");
  assert.ok(element.props.children.includes("需至少3个维度"));
});
