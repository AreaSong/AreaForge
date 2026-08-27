import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/app-navigation";
import { formatClockDuration } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { filterGlobalCommands, clampCommandIndex, GLOBAL_COMMANDS } from "@/lib/navigation/command-palette";

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
// SUITE 1: App Shell Architecture & Data Layout Regions
// ============================================================================

test("AppShell Architecture: root container enforces h-dvh and zero-scroll canvas confinement", () => {
  const shellSource = loadSource("components/app-shell.tsx");

  // 1. Root container tokens
  assert.match(shellSource, /className="[^"]*af-app-shell/);
  assert.match(shellSource, /className="[^"]*h-dvh/);
  assert.match(shellSource, /className="[^"]*overflow-hidden/);
  assert.match(shellSource, /className="[^"]*bg-\[var\(--af-canvas\)\]/);
  assert.match(shellSource, /data-layout-region="app-shell"/);

  // 2. Accessibility skip link
  assert.match(shellSource, /<a[\s\S]*href="#main-content"/);
  assert.match(shellSource, /sr-only focus:not-sr-only/);
  assert.match(shellSource, /focus:bg-teal-300/);

  // 3. Main content landmark and isolation
  assert.match(shellSource, /<main[\s\S]*id="main-content"/);
  assert.match(shellSource, /data-layout-region="page-content"/);
  assert.match(shellSource, /data-ai-page-context="true"/);
  assert.match(shellSource, /className=\{`af-shell-main min-h-0 min-w-0 flex-1/);
});

test("AppShell Architecture: semantic layout regions are comprehensively registered", () => {
  const shellSource = loadSource("components/app-shell.tsx");
  const topbarSource = loadSource("components/global-top-bar.tsx");
  const navSource = loadSource("components/primary-navigation.tsx");
  const toolbarSource = loadSource("components/shared-study-toolbar.tsx");

  assert.match(shellSource, /data-layout-region="app-shell"/);
  assert.match(navSource, /data-layout-region="primary-navigation"/);
  assert.match(topbarSource, /data-layout-region="global-top-bar"/);
  assert.match(shellSource, /data-layout-region="secondary-mobile-navigation"/);
  assert.match(shellSource, /data-layout-region="page-content"/);
  assert.match(toolbarSource, /data-layout-region="global-context-status-bar"/);
});

// ============================================================================
// SUITE 2: Primary Navigation Rail & Responsive Collapsing
// ============================================================================

test("PrimaryNavigation: rail width transitions and dark surface tokens", () => {
  const navSource = loadSource("components/primary-navigation.tsx");

  // Expanded vs collapsed widths
  assert.match(navSource, /props\.collapsed \? "w-\[60px\]" : "w-\[184px\]"/);
  assert.match(navSource, /border-r border-white\/10/);
  assert.match(navSource, /bg-\[var\(--af-surface-subtle\)\]/);
  assert.match(navSource, /transition-\[width\]/);
  assert.match(navSource, /border-t border-white\/10/);

  // Collapse toggle button uses canonical IconButton
  assert.match(navSource, /<IconButton[\s\S]*label=\{props\.collapsed \? "展开一级导航" : "收起一级导航"\}/);
  assert.match(navSource, /PanelLeftOpen/);
  assert.match(navSource, /PanelLeftClose/);
});

test("PrimaryNavigation: active links render glowing teal indicator and gradient background", () => {
  const navSource = loadSource("components/primary-navigation.tsx");

  // Active state tokens
  assert.match(navSource, /border-teal-300/);
  assert.match(navSource, /shadow-\[-2px_0_12px_rgba\(45,212,191,0\.25\)\]/);
  assert.match(navSource, /bg-gradient-to-r from-teal-400\/\[0\.08\] to-transparent/);
  assert.match(navSource, /text-white/);

  // Inactive state tokens
  assert.match(navSource, /border-transparent text-zinc-400 hover:bg-white\/5 hover:text-zinc-100/);
});

test("PrimaryNavigation: all canonical workbenches are registered with dedicated icons", () => {
  assert.equal(PRIMARY_WORKBENCH_ITEMS.length, 5);
  assert.equal(PRIMARY_WORKBENCH_ITEMS[0].href, "/focus");
  assert.equal(PRIMARY_WORKBENCH_ITEMS[1].href, "/today");
  assert.equal(PRIMARY_WORKBENCH_ITEMS[2].href, "/knowledge");
  assert.equal(PRIMARY_WORKBENCH_ITEMS[3].href, "/test/retests");
  assert.equal(PRIMARY_WORKBENCH_ITEMS[4].href, "/roadmap");
  assert.equal(UTILITY_NAV_ITEM.href, "/settings");
});

// ============================================================================
// SUITE 3: Global Top Bar 3-Column Grid Distribution
// ============================================================================

test("GlobalTopBar: 3-column responsive grid layout prevents content collision", () => {
  const topbarSource = loadSource("components/global-top-bar.tsx");

  // Header container tokens
  assert.match(topbarSource, /af-shell-header/);
  assert.match(topbarSource, /shrink-0/);
  assert.match(topbarSource, /border-b border-white\/10/);
  assert.match(topbarSource, /bg-\[color:var\(--af-canvas\)\]\/75/);
  assert.match(topbarSource, /backdrop-blur-md/);

  // Responsive grid definitions
  assert.match(topbarSource, /grid grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(topbarSource, /lg:grid-cols-\[minmax\(13rem,1fr\)_minmax\(14rem,42rem\)_minmax\(13rem,1fr\)\]/);
});

test("GlobalTopBar: controls and tool actions are correctly distributed", () => {
  const topbarSource = loadSource("components/global-top-bar.tsx");

  // Left segment: menu trigger, brand mark, today status button
  assert.match(topbarSource, /af-tablet-navigation-trigger/);
  assert.match(topbarSource, /BrandMark/);
  assert.match(topbarSource, /今日状态/);

  // Center segment: DynamicIsland
  assert.match(topbarSource, /<DynamicIsland/);

  // Right segment: Confirmation center, Global AI, motivation help, quick create
  assert.match(topbarSource, /<GlobalConfirmationCenter/);
  assert.match(topbarSource, /<GlobalAiAssistant/);
  assert.match(topbarSource, /我学不下去了/);
  assert.match(topbarSource, /<GlobalQuickCreate/);
});

// ============================================================================
// SUITE 4: Dynamic Focus Island Morphing Stopwatch & Interaction
// ============================================================================

test("DynamicIsland: 60fps silky smooth transition tokens and obsidian glass body", () => {
  const islandSource = loadSource("components/dynamic-island.tsx");

  // Morphing transitions
  assert.match(islandSource, /transition-\[border-radius,box-shadow,border-color,background-color\]/);
  assert.match(islandSource, /duration-300/);
  assert.match(islandSource, /ease-\[cubic-bezier\(0\.16,1,0\.3,1\)\]/);
  assert.match(islandSource, /bg-\[#090e12\]\/98/);
  assert.match(islandSource, /backdrop-blur-2xl/);

  // Closed vs open container radii & shadows
  assert.match(islandSource, /isOpen[\s\S]*\? "rounded-\[20px\] border-teal-500\/40 shadow-\[0_0_32px_rgba\(45,212,191,0\.18\)\]/);
  assert.match(islandSource, /: `rounded-\[18px\]/);
});

test("DynamicIsland: session status badges and pulse animations", () => {
  const islandSource = loadSource("components/dynamic-island.tsx") + loadSource("components/dynamic-island-segments.tsx");

  assert.match(islandSource, /session\.status === "running"[\s\S]*\? "bg-teal-400 animate-pulse"/);
  assert.match(islandSource, /: session\.status === "closing"[\s\S]*\? "bg-emerald-400"/);
  assert.match(islandSource, /: "bg-amber-400"/);
});

test("DynamicIsland: timer duration calculation formats correctly under active session", () => {
  const started = new Date("2026-08-26T05:00:00Z");
  const now = new Date("2026-08-26T05:25:30Z");
  const elapsed = getTimerElapsedSeconds({
    status: "running",
    startedAt: started,
    accumulatedPauseSeconds: 0,
    now,
  });
  assert.equal(elapsed, 1530);
  assert.equal(formatClockDuration(elapsed), "00:25:30");
});

test("DynamicIsland: command palette query filtering and index clamping", () => {
  const commands = filterGlobalCommands("复习", GLOBAL_COMMANDS);
  assert.ok(commands.length > 0);
  assert.equal(clampCommandIndex(0, commands.length), 0);
  assert.equal(clampCommandIndex(99, commands.length), commands.length - 1);
  assert.equal(clampCommandIndex(-5, commands.length), 0);
});

// ============================================================================
// SUITE 5: Global Context Status Bar & Window Dock
// ============================================================================

test("GlobalContextStatusBar: docked footer status bar tokens and millisecond clock", () => {
  const statusSource = loadSource("components/shared-study-toolbar.tsx");

  assert.match(statusSource, /data-layout-region="global-context-status-bar"/);
  assert.match(statusSource, /formatClockTimeMillis/);
  assert.match(statusSource, /<WindowDock/);
});

// ============================================================================
// SUITE 6: Multi-Viewport Zero-Scroll Layout Constraints
// ============================================================================

test("Zero-Scroll Viewport: main container isolates overflow while shell headers stay pinned", () => {
  const shellSource = loadSource("components/app-shell.tsx");

  // Full canvas pages vs standard scrollable pages
  assert.match(shellSource, /fullCanvasPage \? "overflow-y-auto" : "overflow-y-auto px-3\.5 py-3/);
  assert.match(shellSource, /min-h-0 min-w-0 flex-1/);
});
