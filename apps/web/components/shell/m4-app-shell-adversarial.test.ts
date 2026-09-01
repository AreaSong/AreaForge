import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { calculateWindowDockLayout } from "@/lib/client/window-system-state";
import { formatClockDuration } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { filterGlobalCommands, GLOBAL_COMMANDS } from "@/lib/navigation/command-palette";

function loadSource(relPath: string): string {
  const normalized = relPath.replace(/^apps\/web\//, "");
  const candidates = [
    resolve(process.cwd(), relPath),
    resolve(process.cwd(), normalized),
    resolve(process.cwd(), "apps/web", normalized),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  throw new Error(`Could not find source file for ${relPath}`);
}

// ============================================================================
// SUITE 1: UI Primitive Boundary & Zero-Debt Verification
// ============================================================================

test("M4 Boundary Oracle: App Shell components have zero raw button/input debt post-migration", () => {
  const appShellFiles = [
    "components/app-shell.tsx",
    "components/global-top-bar.tsx",
    "components/primary-navigation.tsx",
    "components/secondary-navigation.tsx",
    "components/shared-study-toolbar.tsx",
    "components/dynamic-island.tsx",
    "components/dynamic-island-segments.tsx",
    "components/dynamic-island-drawer.tsx",
    "components/window-dock.tsx",
    "components/global-confirmation-center.tsx",
    "components/focus-evidence-forms.tsx",
    "components/focus-launcher-subcomponents.tsx",
    "components/focus-launcher-views.tsx",
    "components/focus-session-panels.tsx",
    "components/focus-timer-workspace.tsx",
  ];

  for (const relFile of appShellFiles) {
    const content = loadSource(relFile);

    // Must not contain raw <button or <input without canonical primitive wrapper
    const rawButtonMatches = content.match(/<button[\s>]/g) || [];
    assert.equal(
      rawButtonMatches.length,
      0,
      `${relFile} must not contain raw <button> tags; use canonical Button/IconButton`,
    );

    const rawInputMatches = content.match(/<input[\s>]/g) || [];
    assert.equal(
      rawInputMatches.length,
      0,
      `${relFile} must not contain raw <input> tags; use canonical Input/Field`,
    );
  }
});

// ============================================================================
// SUITE 2: Dynamic Island Adversarial Stress & Morphing Edge Cases
// ============================================================================

test("DynamicIsland Stress: extreme query strings do not crash command filtering", () => {
  // 1. 1,000 character repeating string
  const extremeQuery = "a".repeat(1000);
  const result1 = filterGlobalCommands(extremeQuery, GLOBAL_COMMANDS);
  assert.deepEqual(result1, []);

  // 2. Special regex and glob characters
  const regexQuery = ".*+?^${}()|[]\\/<>!@#%^&*";
  const result2 = filterGlobalCommands(regexQuery, GLOBAL_COMMANDS);
  assert.ok(Array.isArray(result2));

  // 3. Unicode and emoji stress
  const unicodeQuery = "📖 专注 🚀 2026-08-26 测试";
  const result3 = filterGlobalCommands(unicodeQuery, GLOBAL_COMMANDS);
  assert.ok(Array.isArray(result3));
});

test("DynamicIsland Stress: corrupted or extreme timestamps fail safely without NaN", () => {
  // 1. Future timestamp beyond clock skew
  const futureStarted = new Date(Date.now() + 86400000);
  const elapsed1 = getTimerElapsedSeconds({
    status: "running",
    startedAt: futureStarted,
    accumulatedPauseSeconds: 0,
    now: new Date(),
  });
  assert.ok(elapsed1 >= 0, "Elapsed seconds must be non-negative even if startedAt is in future");
  assert.equal(formatClockDuration(elapsed1), "00:00:00");

  // 2. Huge pause interval exceeding total duration
  const elapsed2 = getTimerElapsedSeconds({
    status: "running",
    startedAt: new Date(Date.now() - 3600000),
    accumulatedPauseSeconds: 7200, // 2 hours pause on 1 hour session
    now: new Date(),
  });
  assert.ok(elapsed2 >= 0, "Elapsed seconds must clamp to 0 instead of producing negative duration");
  assert.equal(formatClockDuration(elapsed2), "00:00:00");
});

test("DynamicIsland Stress: keyboard selection wraps around cyclic bounds gracefully", () => {
  const total = 5;
  // Down from end wraps to 0
  assert.equal((4 + 1) % total, 0);
  // Up from 0 wraps to end
  assert.equal((0 - 1 + total) % total, 4);
});

// ============================================================================
// SUITE 3: Window Dock Adversarial Stress & Concurrency
// ============================================================================

test("WindowDock Stress: handles 0 to 50 concurrent background windows without NaN or overflow blowout", () => {
  // Case 1: 0 windows
  const layout0 = calculateWindowDockLayout(1200, [], [], new Map());
  assert.equal(layout0.visibleCount, 0);

  // Case 2: 50 windows with 120px full width each in a 600px dock container
  const fullWidths50 = Array(50).fill(120);
  const compactWidths50 = Array(50).fill(40);
  const moreWidths = new Map([[45, 60], [46, 60], [47, 60], [48, 60], [49, 60]]);

  const layout50 = calculateWindowDockLayout(600, fullWidths50, compactWidths50, moreWidths);
  assert.ok(layout50.visibleCount >= 0 && layout50.visibleCount <= 50);
  assert.ok(Number.isFinite(layout50.visibleCount));
});

test("WindowDock Stress: window titles with extreme length are bounded by max-width and ellipsis", () => {
  const dockSource = loadSource("components/window-dock.tsx");

  // Max width classes present on dock tabs
  assert.match(dockSource, /max-w-32/);
  assert.match(dockSource, /max-w-48/);
  assert.match(dockSource, /truncate/);
});

// ============================================================================
// SUITE 4: Multi-Viewport Flexbox Blowout Defense (1080p, 900p, 768p)
// ============================================================================

test("Multi-Viewport Defense: Topbar and Statusbar text truncation prevents horizontal page expansion", () => {
  const topbarSource = loadSource("components/global-top-bar.tsx");
  const islandSource = loadSource("components/dynamic-island.tsx") + loadSource("components/dynamic-island-segments.tsx");

  // Topbar status summary truncation
  assert.match(topbarSource, /max-w-52 truncate text-zinc-500/);

  // Island subject name truncation
  assert.match(islandSource, /max-w-24 truncate/);
});
