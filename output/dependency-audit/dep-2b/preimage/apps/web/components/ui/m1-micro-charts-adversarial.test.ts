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
// 1. HOURLY HEATBAR ADVERSARIAL & STRESS SUITE
// ============================================================================

test("HourlyHeatbar Adversarial: Handles empty array, missing props, and irregular array lengths", () => {
  // Case A: Completely empty props
  const elEmpty = HourlyHeatbar({});
  assert.equal(elEmpty.type, "div");
  const containerEmpty = elEmpty.props.children[0];
  assert.equal(containerEmpty.props.children.length, 24);

  // Case B: Array with length 0
  const elLen0 = HourlyHeatbar({ slots: [] });
  const containerLen0 = elLen0.props.children[0];
  assert.equal(containerLen0.props.children.length, 24);
  for (let i = 0; i < 24; i++) {
    const slot = containerLen0.props.children[i];
    assert.equal(slot.props.title, `${String(i).padStart(2, "0")}:00 - 0 分钟`);
  }

  // Case C: Array shorter than 24 (length = 7)
  const shortData = [10, 20, 30, 40, 50, 60, 70];
  const elShort = HourlyHeatbar({ slots: shortData });
  const containerShort = elShort.props.children[0];
  assert.equal(containerShort.props.children.length, 24);
  assert.equal(containerShort.props.children[6].props.title, "06:00 - 70 分钟");
  assert.equal(containerShort.props.children[7].props.title, "07:00 - 0 分钟");
  assert.equal(containerShort.props.children[23].props.title, "23:00 - 0 分钟");

  // Case D: Array longer than 24 (length = 48) - should strictly normalize to 24 slots
  const longData = Array.from({ length: 48 }, (_, i) => (i + 1) * 10);
  const elLong = HourlyHeatbar({ slots: longData });
  const containerLong = elLong.props.children[0];
  assert.equal(containerLong.props.children.length, 24);
  assert.equal(containerLong.props.children[0].props.title, "00:00 - 10 分钟");
  assert.equal(containerLong.props.children[23].props.title, "23:00 - 240 分钟");
});

test("HourlyHeatbar Adversarial: All zeros, extreme spikes, and scale normalization", () => {
  // Case A: All zeros (Math.max(1, ...allZeros) = 1)
  const allZeros = Array(24).fill(0);
  const elZeros = HourlyHeatbar({ slots: allZeros });
  const containerZeros = elZeros.props.children[0];
  for (let i = 0; i < 24; i++) {
    const bar = containerZeros.props.children[i].props.children;
    // When minutes === 0, heightPct is 12%
    assert.equal(bar.props.style.height, "12%");
    assert.ok(bar.props.className.includes("bg-white/[0.05]"));
  }

  // Case B: Extreme spike (one slot has 1,000,000 minutes)
  const spikeData = Array(24).fill(0);
  spikeData[10] = 1_000_000;
  spikeData[11] = 500_000;
  spikeData[12] = 1; // 1 minute vs 1M
  const elSpike = HourlyHeatbar({ slots: spikeData });
  const containerSpike = elSpike.props.children[0];

  // Slot 10 (100% max)
  const bar10 = containerSpike.props.children[10].props.children;
  assert.equal(bar10.props.style.height, "100%");

  // Slot 11 (50% of max)
  const bar11 = containerSpike.props.children[11].props.children;
  assert.equal(bar11.props.style.height, "50%");

  // Slot 12 (1 minute -> min clamp 20%)
  const bar12 = containerSpike.props.children[12].props.children;
  assert.equal(bar12.props.style.height, "20%");
});

test("HourlyHeatbar Adversarial: Slot click events, currentHour highlighting, and label toggling", () => {
  const events: Array<{ hour: number; min: number }> = [];
  const testData = Array.from({ length: 24 }, (_, i) => i * 5);

  const el = HourlyHeatbar({
    slots: testData,
    currentHour: 15,
    showLabels: false,
    onSlotClick: (h, m) => events.push({ hour: h, min: m }),
  });

  // Check no labels rendered
  assert.equal(el.props.children[1], null);

  const container = el.props.children[0];
  // Click slot 5
  container.props.children[5].props.onClick();
  assert.deepEqual(events, [{ hour: 5, min: 25 }]);

  // Check current hour 15 active styling
  const slot15 = container.props.children[15];
  const bar15 = slot15.props.children;
  assert.ok(bar15.props.className.includes("bg-teal-300"));
  assert.ok(bar15.props.className.includes("ring-teal-200"));
});

// ============================================================================
// 2. SUBJECT PROPORTION BAR ADVERSARIAL & STRESS SUITE
// ============================================================================

test("SubjectProportionBar Adversarial: Empty list, zero totals, and negative totals", () => {
  // Case A: Empty items
  const elEmpty = SubjectProportionBar({ items: [] });
  assert.equal(elEmpty.type, "div");
  const fallbackText = elEmpty.props.children[1];
  assert.ok(fallbackText.props.children.includes("暂无科目投入数据"));

  // Case B: Total minutes explicitly 0
  const elZero = SubjectProportionBar({
    items: [{ name: "数学", minutes: 0 }, { name: "英语", minutes: 0 }],
    totalMinutes: 0,
  });
  const fallbackZero = elZero.props.children[1];
  assert.ok(fallbackZero.props.children.includes("暂无科目投入数据"));

  // Case C: Negative calculated total
  const elNegative = SubjectProportionBar({
    items: [{ name: "异常科目", minutes: -50 }],
  });
  const fallbackNeg = elNegative.props.children[1];
  assert.ok(fallbackNeg.props.children.includes("暂无科目投入数据"));

  // Case D: showLegend false on zero data
  const elNoLegend = SubjectProportionBar({ items: [], showLegend: false });
  assert.equal(elNoLegend.props.children[1], null);
});

test("SubjectProportionBar Adversarial: Single 100% item, 10+ items, and tiny fractional values", () => {
  // Case A: Single 100% item
  const elSingle = SubjectProportionBar({
    items: [{ id: "math", name: "高等数学", minutes: 180 }],
  });
  const barContainer = elSingle.props.children[0];
  assert.equal(barContainer.props.children.length, 1);
  const seg0 = barContainer.props.children[0];
  assert.equal(seg0.props.style.width, "100.0%");
  assert.ok(seg0.props.title.includes("高等数学: 180分钟 (100.0%)"));

  // Case B: 12 subjects (stress overflow beyond maxLegendItems = 4)
  const twelveSubjects = Array.from({ length: 12 }, (_, i) => ({
    id: `subject-${i + 1}`,
    name: `科目-${i + 1}`,
    minutes: 10 * (i + 1),
  }));
  const elTwelve = SubjectProportionBar({
    items: twelveSubjects,
    maxLegendItems: 4,
  });
  const barTwelve = elTwelve.props.children[0];
  assert.equal(barTwelve.props.children.length, 12);

  const legendTwelve = elTwelve.props.children[1];
  assert.equal(legendTwelve.props.children[0].length, 4); // 4 visible legend items
  const overflowSpan = legendTwelve.props.children[1];
  const overflowText = Array.isArray(overflowSpan.props.children)
    ? overflowSpan.props.children.join("")
    : String(overflowSpan.props.children);
  assert.ok(overflowText.includes("+8 更多"));

  // Case C: Tiny fractional minute vs large total
  const elFractional = SubjectProportionBar({
    items: [
      { name: "微量投入", minutes: 0.005 },
      { name: "主要投入", minutes: 999.995 },
    ],
    totalMinutes: 1000,
  });
  const barFrac = elFractional.props.children[0];
  const segFrac0 = barFrac.props.children[0];
  assert.equal(segFrac0.props.style.width, "0.0%"); // (0.005 / 1000 * 100).toFixed(1) => "0.0%"
  const segFrac1 = barFrac.props.children[1];
  assert.equal(segFrac1.props.style.width, "100.0%");
});

test("SubjectProportionBar Adversarial: Property aliases fallback check", () => {
  // Test combinations of subjectId/id, title/name, durationMinutes/minutes/value, colorClass/color
  const el = SubjectProportionBar({
    items: [
      { subjectId: "s1", title: "Title 1", durationMinutes: 45, colorClass: "bg-red-500" },
      { id: "s2", name: "Name 2", value: 55, color: "bg-blue-500" },
    ],
  });

  const bar = el.props.children[0];
  assert.equal(bar.props.children[0].props.className.includes("bg-red-500"), true);
  assert.equal(bar.props.children[1].props.className.includes("bg-blue-500"), true);
  assert.equal(bar.props.children[0].props.style.width, "45.0%");
  assert.equal(bar.props.children[1].props.style.width, "55.0%");
});

// ============================================================================
// 3. MINI SPARKLINE ADVERSARIAL & STRESS SUITE
// ============================================================================

test("MiniSparkline Adversarial: Empty data, single point, flat line, negative values, and spikes", () => {
  // Case A: Empty data
  const elEmpty = MiniSparkline({ data: [] });
  assert.equal(elEmpty.type, "div");
  assert.equal(elEmpty.props.children, "--");

  // Case B: Single data point
  const elSingle = MiniSparkline({ data: [42], width: 100, height: 40 });
  assert.equal(elSingle.type, "svg");
  const singleLine = elSingle.props.children[3];
  assert.equal(singleLine.type, "line");
  assert.equal(singleLine.props.x1, 3);
  assert.equal(singleLine.props.x2, 97);
  // Last point
  const dotSingle = elSingle.props.children[4];
  assert.equal(dotSingle.props.children[0].props.cx, 50); // width / 2

  // Case C: Flat line (all identical values) -> Range is 1, no divide-by-zero NaN
  const elFlat = MiniSparkline({ data: [50, 50, 50, 50], width: 100, height: 40 });
  const polyFlat = elFlat.props.children[3];
  assert.equal(polyFlat.type, "polyline");
  const pointsFlat = polyFlat.props.points;
  assert.ok(!pointsFlat.includes("NaN"));
  assert.ok(!pointsFlat.includes("Infinity"));
  // All Y values must be equal
  const coords = pointsFlat.split(" ").map((p: string) => p.split(",").map(Number));
  const yVals = coords.map((c: number[]) => c[1]);
  assert.equal(new Set(yVals).size, 1);

  // Case D: Strictly negative values
  const elNeg = MiniSparkline({ data: [-100, -80, -20, -50], width: 120, height: 30 });
  const polyNeg = elNeg.props.children[3];
  const ptsNeg = polyNeg.props.points.split(" ").map((p: string) => p.split(",").map(Number));
  // minVal = -100 (bottom, y = 27), maxVal = -20 (top, y = 3)
  assert.equal(ptsNeg[0][1], 27); // -100 is min
  assert.equal(ptsNeg[2][1], 3);  // -20 is max
  for (const [, y] of ptsNeg) {
    assert.ok(y >= 3 && y <= 27, `Y coordinate ${y} must be strictly within [3, 27]`);
    assert.ok(!Number.isNaN(y));
  }

  // Case E: Extreme spike (1e9)
  const elSpike = MiniSparkline({ data: [0, 1e9, 0], width: 100, height: 30 });
  const polySpike = elSpike.props.children[3];
  const ptsSpike = polySpike.props.points.split(" ").map((p: string) => p.split(",").map(Number));
  assert.equal(ptsSpike[1][1], 3); // Peak at top
  assert.equal(ptsSpike[0][1], 27); // Baseline at bottom
  assert.ok(!Number.isNaN(ptsSpike[1][1]));
});

test("MiniSparkline Adversarial: Target baseline scaling and area fill syntax", () => {
  // Target value outside data range expands the coordinate space
  const elTarget = MiniSparkline({
    data: [10, 20, 30],
    targetValue: 100, // higher than max data (30)
    width: 100,
    height: 40,
    fill: true,
  });

  const targetLine = elTarget.props.children[1];
  assert.equal(targetLine.type, "line");
  assert.equal(targetLine.props.y1, 3); // target 100 is the max value, so y = 3
  assert.equal(targetLine.props.y2, 3);

  // Area path verification
  const areaPath = elTarget.props.children[2];
  assert.equal(areaPath.type, "path");
  assert.ok(areaPath.props.d.startsWith("M 3,"));
  assert.ok(areaPath.props.d.endsWith(" L 3,40 Z"));
  assert.ok(!areaPath.props.d.includes("NaN"));
});

// ============================================================================
// 4. MINI RADAR ADVERSARIAL & STRESS SUITE
// ============================================================================

test("MiniRadar Adversarial: Degenerate axes counts (<3 axes)", () => {
  // Case A: 0 axes
  const el0 = MiniRadar({ axes: [] });
  assert.equal(el0.type, "div");
  assert.ok(el0.props.children.includes("需至少3个维度"));

  // Case B: 1 axis
  const el1 = MiniRadar({ axes: [{ label: "单轴", value: 50 }] });
  assert.equal(el1.type, "div");
  assert.ok(el1.props.children.includes("需至少3个维度"));

  // Case C: 2 axes
  const el2 = MiniRadar({
    axes: [
      { label: "维度A", value: 50 },
      { label: "维度B", value: 80 },
    ],
  });
  assert.equal(el2.type, "div");
  assert.ok(el2.props.children.includes("需至少3个维度"));
});

test("MiniRadar Adversarial: All 0 values, max=0 edge cases, and value clamping", () => {
  // Case A: All 0 values -> all polygon vertices must be exact center (cx, cy)
  const size = 120;
  const cx = (size / 2).toFixed(1); // "60.0"
  const cy = (size / 2).toFixed(1); // "60.0"

  const elZeros = MiniRadar({
    axes: [
      { label: "A", value: 0 },
      { label: "B", value: 0 },
      { label: "C", value: 0 },
    ],
    size,
  });

  assert.equal(elZeros.type, "svg");
  const valuePolyZeros = elZeros.props.children[1];
  const ptsZeros = valuePolyZeros.props.points.split(" ");
  assert.equal(ptsZeros.length, 3);
  for (const pt of ptsZeros) {
    assert.equal(pt, `${cx},${cy}`);
  }

  // Case B: max = 0 edge case (must normalize to 0, not Infinity or NaN)
  const elMaxZero = MiniRadar({
    axes: [
      { label: "A", value: 50, max: 0 },
      { label: "B", value: 100, max: 0 },
      { label: "C", value: 0, max: 0 },
    ],
    size,
  });

  const valuePolyMaxZero = elMaxZero.props.children[1];
  const ptsMaxZero = valuePolyMaxZero.props.points.split(" ");
  for (const pt of ptsMaxZero) {
    assert.equal(pt, `${cx},${cy}`);
    assert.ok(!pt.includes("NaN"));
    assert.ok(!pt.includes("Infinity"));
  }

  // Case C: Over-100% and negative values (clamping between 0 and 1)
  const elClamped = MiniRadar({
    axes: [
      { label: "Over", value: 150, max: 100 }, // should clamp to 1.0 (perimeter)
      { label: "Under", value: -50, max: 100 }, // should clamp to 0.0 (center)
      { label: "Normal", value: 50, max: 100 },
    ],
    size,
  });

  const valuePolyClamped = elClamped.props.children[1];
  const ptsClamped = valuePolyClamped.props.points.split(" ");
  assert.equal(ptsClamped.length, 3);
  // Vertex 1 (Under) should be at center
  assert.equal(ptsClamped[1], `${cx},${cy}`);
  for (const pt of ptsClamped) {
    assert.ok(!pt.includes("NaN"));
  }
});

test("MiniRadar Adversarial: High axis counts (12 axes) and text anchor calculations", () => {
  const twelveAxes = Array.from({ length: 12 }, (_, i) => ({
    label: `Dim-${i + 1}`,
    value: 50 + (i % 5) * 10,
    max: 100,
  }));

  const el = MiniRadar({
    axes: twelveAxes,
    size: 150,
    showGrid: true,
    showLabels: true,
    gridLevels: 4,
  });

  assert.equal(el.type, "svg");
  // Grid levels count
  const gridContainer = el.props.children[0];
  const gridPolygons = gridContainer.props.children[0];
  assert.equal(gridPolygons.length, 4);

  // Spoke lines count
  const spokeLines = gridContainer.props.children[1];
  assert.equal(spokeLines.length, 12);

  // Vertex dots
  const vertexDots = el.props.children[2];
  assert.equal(vertexDots.length, 12);

  // Labels & text anchors
  const labels = el.props.children[3];
  assert.equal(labels.length, 12);

  for (let i = 0; i < 12; i++) {
    const textEl = labels[i];
    const anchor = textEl.props.textAnchor;
    assert.ok(
      anchor === "middle" || anchor === "start" || anchor === "end",
      `Text anchor must be valid: ${anchor}`
    );
    assert.ok(!Number.isNaN(textEl.props.x));
    assert.ok(!Number.isNaN(textEl.props.y));
  }
});

// ============================================================================
// 5. COMPACT BADGE & STATUS DOT ADVERSARIAL SUITE
// ============================================================================

test("CompactBadge & StatusDot Adversarial: Undefined tone/variant fallbacks and size permutations", () => {
  // CompactBadge fallbacks
  const badgeEmpty = CompactBadge({ children: "Default" });
  assert.ok(badgeEmpty.props.className.includes("text-zinc-400")); // neutral
  assert.ok(badgeEmpty.props.className.includes("h-[18px]")); // xs

  const badgeAllTones = ["teal", "emerald", "amber", "rose", "zinc", "sky", "purple"] as const;
  for (const tone of badgeAllTones) {
    const b = CompactBadge({ tone, size: "sm", children: tone });
    assert.ok(!b.props.className.includes("undefined"));
    assert.ok(b.props.className.includes("h-[22px]"));
  }

  // StatusDot fallbacks
  const dotEmpty = StatusDot({});
  assert.ok(dotEmpty.props.className.includes("size-2.5")); // sm
  assert.equal(dotEmpty.props.title, "idle");

  const dotAllTones = ["teal", "emerald", "amber", "rose", "zinc", "sky"] as const;
  for (const tone of dotAllTones) {
    const d = StatusDot({ tone, size: "md", pulse: true });
    assert.ok(d.props.className.includes("size-3.5"));
    assert.ok(d.props.children[0] !== null); // pulse ping
    assert.ok(d.props.children[0].props.className.includes("animate-ping"));
  }
});
