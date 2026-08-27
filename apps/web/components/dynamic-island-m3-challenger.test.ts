import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import {
  DYNAMIC_ISLAND_AURA_THEMES,
  getAuraStyles,
  getAuraThemeForStateKind,
  getDefaultTabForStateKind,
  getExpandedHubAuraClass,
  getSatelliteBubbleGlowClass,
} from "./dynamic-island-glow";
import {
  HubViewModeTabs,
  HubSupervisionOverview,
  HubFlowStopwatchPanel,
  HubConfirmationClosureGuide,
  HubCommandPaletteList,
  DynamicIslandHub,
  MorphingFloatingHub,
  normalizeHubTab,
  type HubViewMode,
} from "./dynamic-island-hub";
import type {
  DynamicIslandCapsuleKind,
  DynamicIslandStateKind,
  DynamicIslandAuraTheme,
  DynamicIslandActiveItem,
} from "./dynamic-island-types";
import { GLOBAL_COMMANDS } from "@/lib/navigation/command-palette";

function loadSource(relativePath: string): string {
  const candidates = [
    path.resolve(__dirname, relativePath),
    path.resolve(__dirname, "..", relativePath),
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), "apps/web", relativePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf-8");
    }
  }
  throw new Error(`Could not find source file for ${relativePath}`);
}

// ============================================================================
// SUITE 1: 100% Chromatic Aura Token Purity & Zero Cross-Contamination
// ============================================================================

test("Empirical Challenger: 4 Chromatic Aura Themes have 100% pure tokens with zero mismatch", () => {
  const themes: DynamicIslandAuraTheme[] = ["indigo", "amber", "teal", "silver"];

  for (const theme of themes) {
    const styles = DYNAMIC_ISLAND_AURA_THEMES[theme];
    assert.ok(styles, `Theme ${theme} must exist in DYNAMIC_ISLAND_AURA_THEMES`);
    assert.equal(styles.theme, theme);

    // Verify primary color hex format
    assert.match(styles.primaryColor, /^#[0-9a-fA-F]{6}$/, `${theme} primaryColor must be valid hex`);
    // Verify primary rgba format
    assert.match(styles.primaryRgba, /^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/, `${theme} primaryRgba format`);
    // Verify glow rgba format
    assert.match(styles.glowRgba, /^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/, `${theme} glowRgba format`);

    // Verify token purity against other chromatic themes
    if (theme === "indigo") {
      assert.match(styles.borderClass, /indigo/, "indigo borderClass must be indigo");
      assert.match(styles.hubBorderClass, /indigo/, "indigo hubBorderClass must be indigo");
      assert.match(styles.shadowClass, /99,\s*102,\s*241/, "indigo shadowClass must use indigo RGB");
      assert.match(styles.tabActiveClass, /indigo/, "indigo tabActiveClass must be indigo");
      assert.match(styles.buttonClass, /indigo/, "indigo buttonClass must be indigo");
      assert.match(styles.dotClass, /indigo/, "indigo dotClass must be indigo");
      assert.match(styles.satelliteGlowClass, /indigo/, "indigo satelliteGlowClass must be indigo");

      // Purity: No teal, amber, emerald, or rose contamination
      assert.doesNotMatch(styles.tabActiveClass, /teal|amber|emerald|rose/, "indigo tabActiveClass must not leak other colors");
      assert.doesNotMatch(styles.hubBorderClass, /teal|amber|emerald|rose/, "indigo hubBorderClass must not leak other colors");
      assert.doesNotMatch(styles.buttonClass, /teal|amber|emerald|rose/, "indigo buttonClass must not leak other colors");
    } else if (theme === "amber") {
      assert.match(styles.borderClass, /amber/, "amber borderClass must be amber");
      assert.match(styles.hubBorderClass, /amber/, "amber hubBorderClass must be amber");
      assert.match(styles.shadowClass, /245,\s*158,\s*11/, "amber shadowClass must use amber RGB");
      assert.match(styles.tabActiveClass, /amber/, "amber tabActiveClass must be amber");
      assert.match(styles.buttonClass, /amber/, "amber buttonClass must be amber");
      assert.match(styles.dotClass, /amber/, "amber dotClass must be amber");
      assert.match(styles.satelliteGlowClass, /amber/, "amber satelliteGlowClass must be amber");

      // Purity: No teal, indigo, emerald, or rose contamination
      assert.doesNotMatch(styles.tabActiveClass, /teal|indigo|emerald|rose/, "amber tabActiveClass must not leak other colors");
      assert.doesNotMatch(styles.hubBorderClass, /teal|indigo|emerald|rose/, "amber hubBorderClass must not leak other colors");
      assert.doesNotMatch(styles.buttonClass, /teal|indigo|emerald|rose/, "amber buttonClass must not leak other colors");
    } else if (theme === "teal") {
      assert.match(styles.borderClass, /teal/, "teal borderClass must be teal");
      assert.match(styles.hubBorderClass, /teal/, "teal hubBorderClass must be teal");
      assert.match(styles.shadowClass, /20,\s*184,\s*166/, "teal shadowClass must use teal RGB");
      assert.match(styles.tabActiveClass, /teal/, "teal tabActiveClass must be teal");
      assert.match(styles.buttonClass, /teal/, "teal buttonClass must be teal");
      assert.match(styles.dotClass, /teal/, "teal dotClass must be teal");
      assert.match(styles.satelliteGlowClass, /teal/, "teal satelliteGlowClass must be teal");

      // Purity: No indigo, amber, emerald, or rose contamination
      assert.doesNotMatch(styles.tabActiveClass, /indigo|amber|rose/, "teal tabActiveClass must not leak other colors");
      assert.doesNotMatch(styles.hubBorderClass, /indigo|amber|rose/, "teal hubBorderClass must not leak other colors");
      assert.doesNotMatch(styles.buttonClass, /indigo|amber|rose/, "teal buttonClass must not leak other colors");
    } else if (theme === "silver") {
      assert.match(styles.borderClass, /white/, "silver borderClass must be white/neutral");
      assert.match(styles.hubBorderClass, /white/, "silver hubBorderClass must be white/neutral");
      assert.match(styles.tabActiveClass, /white/, "silver tabActiveClass must be white/neutral");
      assert.match(styles.buttonClass, /white/, "silver buttonClass must be white/neutral");

      // Purity: No chromatic color contamination
      assert.doesNotMatch(styles.tabActiveClass, /indigo|amber|teal|rose|emerald/, "silver tabActiveClass must not leak chromatic colors");
      assert.doesNotMatch(styles.hubBorderClass, /indigo|amber|teal|rose|emerald/, "silver hubBorderClass must not leak chromatic colors");
      assert.doesNotMatch(styles.buttonClass, /indigo|amber|teal|rose|emerald/, "silver buttonClass must not leak chromatic colors");
    }
  }
});

// ============================================================================
// SUITE 2: Default Tab & Aura Theme Resolution Across All 8 State Kinds
// ============================================================================

test("Empirical Challenger: Default tab and Aura theme resolution for all 8 state kinds + edge cases", () => {
  const stateKindMatrix: Array<{
    kind: DynamicIslandStateKind | null | undefined | string;
    expectedTheme: DynamicIslandAuraTheme;
    expectedTab: string;
  }> = [
    // 8 Canonical Capsule Kinds
    { kind: "live_session_running", expectedTheme: "teal", expectedTab: "stopwatch" },
    { kind: "live_session_closing", expectedTheme: "teal", expectedTab: "stopwatch" },
    { kind: "activity_paused", expectedTheme: "teal", expectedTab: "stopwatch" },
    { kind: "recovery_active", expectedTheme: "amber", expectedTab: "status" },
    { kind: "evening_review_due", expectedTheme: "indigo", expectedTab: "evening" },
    { kind: "sync_issue", expectedTheme: "amber", expectedTab: "status" },
    { kind: "confirmations_pending", expectedTheme: "amber", expectedTab: "status" },
    { kind: "idle", expectedTheme: "silver", expectedTab: "search" },
    // Command Search
    { kind: "command_search", expectedTheme: "silver", expectedTab: "search" },
    // Edge Cases / Nullish / Unknown
    { kind: null, expectedTheme: "silver", expectedTab: "search" },
    { kind: undefined, expectedTheme: "silver", expectedTab: "search" },
    { kind: "", expectedTheme: "silver", expectedTab: "search" },
    { kind: "non_existent_kind", expectedTheme: "silver", expectedTab: "search" },
  ];

  for (const { kind, expectedTheme, expectedTab } of stateKindMatrix) {
    const resolvedTheme = getAuraThemeForStateKind(kind as DynamicIslandStateKind);
    const resolvedTab = getDefaultTabForStateKind(kind as DynamicIslandStateKind);

    assert.equal(
      resolvedTheme,
      expectedTheme,
      `State kind "${kind}" must resolve to theme "${expectedTheme}", got "${resolvedTheme}"`
    );
    assert.equal(
      resolvedTab,
      expectedTab,
      `State kind "${kind}" must resolve to default tab "${expectedTab}", got "${resolvedTab}"`
    );
  }
});

// ============================================================================
// SUITE 3: Tab Normalization Comprehensive Matrix
// ============================================================================

test("Empirical Challenger: normalizeHubTab handles canonical, legacy, and edge-case inputs", () => {
  const normalizationMatrix: Array<{ input: string | null | undefined; expected: string }> = [
    // Canonical tabs
    { input: "status", expected: "overview" },
    { input: "stopwatch", expected: "focus" },
    { input: "evening", expected: "closure" },
    { input: "search", expected: "search" },
    // Legacy tabs
    { input: "overview", expected: "overview" },
    { input: "focus", expected: "focus" },
    { input: "closure", expected: "closure" },
    // Nullish & empty
    { input: null, expected: "search" },
    { input: undefined, expected: "search" },
    { input: "", expected: "search" },
    // Unknown inputs
    { input: "settings", expected: "search" },
    { input: "help", expected: "search" },
  ];

  for (const { input, expected } of normalizationMatrix) {
    const result = normalizeHubTab(input);
    assert.equal(result, expected, `normalizeHubTab("${input}") must return "${expected}", got "${result}"`);
  }
});

// ============================================================================
// SUITE 4: HubViewModeTabs Rendering & Active Pill Chromatic Synced Tests
// ============================================================================

test("Empirical Challenger: HubViewModeTabs renders active tab pill strictly synced with auraTheme", () => {
  const themes: DynamicIslandAuraTheme[] = ["indigo", "amber", "teal", "silver"];
  const modes: HubViewMode[] = ["search", "overview", "focus", "closure"];

  for (const theme of themes) {
    const expectedStyles = getAuraStyles(theme);

    for (const mode of modes) {
      const element = HubViewModeTabs({
        viewMode: mode,
        onViewModeChange: () => {},
        activeStatesCount: 2,
        hasRunningSession: true,
        pendingConfirmationsCount: 1,
        eveningDue: true,
        auraTheme: theme,
      }) as React.ReactElement<{ children?: React.ReactNode[] }>;

      assert.ok(element);
      const children = React.Children.toArray(element.props.children) as Array<
        React.ReactElement<{ className?: string }>
      >;
      assert.equal(children.length, 4);

      // Find the active tab child
      const activeChild = children.find((c) =>
        c.props.className?.includes(expectedStyles.tabActiveClass.split(" ")[0])
      );
      assert.ok(
        activeChild,
        `Mode "${mode}" with theme "${theme}" must render active tab pill matching "${expectedStyles.tabActiveClass}"`
      );
    }
  }
});

// ============================================================================
// SUITE 5: HubCommandPaletteList Chromatic Synchronization
// ============================================================================

test("Empirical Challenger: HubCommandPaletteList applies chromatic highlight and jump tag per auraTheme", () => {
  const testCommands = GLOBAL_COMMANDS.slice(0, 3);
  const themes: DynamicIslandAuraTheme[] = ["indigo", "amber", "teal", "silver"];

  for (const theme of themes) {
    const element = HubCommandPaletteList({
      commands: testCommands,
      selectedIndex: 0,
      onSelectIndex: () => {},
      onExecuteCommand: () => {},
      auraTheme: theme,
    }) as React.ReactElement<{ children?: React.ReactNode[] }>;

    const children = React.Children.toArray(element.props.children) as Array<
      React.ReactElement<{ className?: string; children?: React.ReactNode[] }>
    >;
    const selectedItem = children[0];
    const subChildren = React.Children.toArray(selectedItem.props.children) as Array<
      React.ReactElement<{ className?: string }>
    >;
    const jumpTag = subChildren[1];

    if (theme === "indigo") {
      assert.match(selectedItem.props.className || "", /indigo/, "indigo palette item must have indigo styling");
      assert.match(jumpTag.props.className || "", /text-indigo-400/, "indigo jump tag must be text-indigo-400");
    } else if (theme === "amber") {
      assert.match(selectedItem.props.className || "", /amber/, "amber palette item must have amber styling");
      assert.match(jumpTag.props.className || "", /text-amber-400/, "amber jump tag must be text-amber-400");
    } else if (theme === "teal") {
      assert.match(selectedItem.props.className || "", /teal/, "teal palette item must have teal styling");
      assert.match(jumpTag.props.className || "", /text-teal-400/, "teal jump tag must be text-teal-400");
    } else if (theme === "silver") {
      assert.match(selectedItem.props.className || "", /white/, "silver palette item must have white styling");
      assert.match(jumpTag.props.className || "", /text-zinc-300/, "silver jump tag must be text-zinc-300");
    }
  }
});

// ============================================================================
// SUITE 6: Expanded Hub Aura & Satellite Bubble Glow Class Generation
// ============================================================================

test("Empirical Challenger: getExpandedHubAuraClass & getSatelliteBubbleGlowClass per theme", () => {
  const kinds: DynamicIslandCapsuleKind[] = [
    "evening_review_due",
    "recovery_active",
    "live_session_running",
    "idle",
  ];

  for (const kind of kinds) {
    const auraClass = getExpandedHubAuraClass(kind);
    const bubbleClass = getSatelliteBubbleGlowClass(kind);

    assert.ok(auraClass.length > 0);
    assert.ok(bubbleClass.length > 0);

    if (kind === "evening_review_due") {
      assert.match(auraClass, /border-indigo-500\/40/);
      assert.match(auraClass, /shadow-\[0_12px_40px_rgba\(99,102,241,0\.22\)\]/);
      assert.match(bubbleClass, /border-indigo-400\/50/);
    } else if (kind === "recovery_active") {
      assert.match(auraClass, /border-amber-500\/40/);
      assert.match(auraClass, /shadow-\[0_12px_40px_rgba\(245,158,11,0\.22\)\]/);
      assert.match(bubbleClass, /border-amber-400\/50/);
    } else if (kind === "live_session_running") {
      assert.match(auraClass, /border-teal-500\/40/);
      assert.match(auraClass, /shadow-\[0_12px_40px_rgba\(20,184,166,0\.22\)\]/);
      assert.match(bubbleClass, /border-teal-400\/50/);
    } else if (kind === "idle") {
      assert.match(auraClass, /border-white\/15/);
      assert.match(auraClass, /shadow-\[0_12px_40px_rgba\(0,0,0,0\.5\)\]/);
      assert.match(bubbleClass, /border-white\/20/);
    }
  }
});

// ============================================================================
// SUITE 7: Hub Panels Component Rendering Integrity
// ============================================================================

test("Empirical Challenger: Hub Component Panels render robustly", () => {
  const sampleDominant: DynamicIslandActiveItem = {
    id: "sample-01",
    kind: "idle",
    priorityWeight: 0,
    title: "AreaForge",
    accentTone: "zinc",
  };

  // 1. HubSupervisionOverview
  const overviewEl = HubSupervisionOverview({
    activeStates: [sampleDominant],
    dominantState: sampleDominant,
    elapsedSeconds: 0,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  });
  assert.ok(overviewEl);

  // 2. HubFlowStopwatchPanel
  const stopwatchEl = HubFlowStopwatchPanel({
    dominantState: sampleDominant,
    elapsedSeconds: 0,
    isResuming: false,
    onDirectResume: () => {},
    onClose: () => {},
  });
  assert.ok(stopwatchEl);

  // 3. HubConfirmationClosureGuide
  const closureEl = HubConfirmationClosureGuide({
    pendingConfirmationsCount: 0,
    eveningReview: null,
    onClose: () => {},
  });
  assert.ok(closureEl);

  // 4. DynamicIslandHub & MorphingFloatingHub
  const hubEl = DynamicIslandHub({
    isOpen: true,
    viewMode: "search",
    onViewModeChange: () => {},
    onClose: () => {},
    activeStates: [sampleDominant],
    dominantState: sampleDominant,
    elapsedSeconds: 0,
    commands: GLOBAL_COMMANDS,
    selectedIndex: 0,
    onSelectIndex: () => {},
    onExecuteCommand: () => {},
    onDirectResume: () => {},
  });
  assert.ok(hubEl);
  assert.equal(MorphingFloatingHub, DynamicIslandHub);
});

// ============================================================================
// SUITE 8: DynamicIsland Outer Expanded Container Chromatic Aura Audit
// ============================================================================

test("Empirical Challenger Audit: Inspect dynamic-island.tsx expanded container class construction", () => {
  const islandSource = loadSource("components/dynamic-island.tsx");
  assert.ok(islandSource.length > 0);

  // Verify that expandedAuraClass calculation is present
  assert.match(islandSource, /const expandedAuraClass = getExpandedHubAuraClass\(currentItem\.kind\);/);
});
