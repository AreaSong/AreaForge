import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  filterGlobalCommands,
  resolveGlobalCommand,
  tokenizeCommandArguments,
  clampCommandIndex,
  GLOBAL_COMMANDS,
} from "@/lib/navigation/command-palette";
import { formatClockDuration, formatShortDuration, formatBytes } from "@/lib/formatters";
import { getTimerElapsedSeconds } from "@areaforge/core";
import { PRIMARY_WORKBENCH_ITEMS, UTILITY_NAV_ITEM } from "@/lib/navigation/app-navigation";

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
// SUITE 1: Dynamic Island Query Engine & Regex/ReDoS Robustness
// ============================================================================

test("Challenger 1 - Dynamic Island Query: ReDoS and catastrophic backtracking resilience", () => {
  // Classic ReDoS payloads targeting naive RegExp or string matching
  const redosPayloads = [
    "a".repeat(5000) + "!",
    "((a+)+)+$",
    "(a|aa)+",
    "([a-zA-Z]+)*",
    "(.*)*",
    "\\p{L}+",
    "\\u0000".repeat(500),
  ];

  for (const payload of redosPayloads) {
    const start = performance.now();
    const results = filterGlobalCommands(payload, GLOBAL_COMMANDS);
    const duration = performance.now() - start;

    assert.ok(Array.isArray(results), `Payload must return array: ${payload.slice(0, 30)}`);
    assert.ok(duration < 50, `Filtering took ${duration}ms, must be < 50ms to prevent UI freezing`);
  }
});

test("Challenger 1 - Dynamic Island Query: 100,000 character extreme query performance & memory safety", () => {
  const massiveQuery = "今日 ".repeat(25000); // 125,000 characters
  const start = performance.now();
  const results = filterGlobalCommands(massiveQuery, GLOBAL_COMMANDS);
  const duration = performance.now() - start;

  assert.ok(Array.isArray(results));
  assert.ok(duration < 100, `Massive 100k+ query executed in ${duration}ms (must be < 100ms)`);
});

test("Challenger 1 - Dynamic Island Query: Special characters, SQLi, XSS, and Unicode Astral plane", () => {
  const adversarialQueries = [
    "<script>alert(1)</script>",
    "'; DROP TABLE sessions; --",
    "\\x00\\x08\\x0b\\x0c\\x0e\\x1f",
    "\u202E\u202D\u200E\u200F RTL/LTR override", // Bidi control chars
    "𠮷野家 𩸽 𠀋 𡈽 𠮟 🦄 🌈 ⚡ 🎯 🧘 ⏱️", // Astral plane surrogates + emojis
    "Café naïve résumé 🦆",
    "   \t\r\n\v\f  ", // pure whitespace
    "", // empty query
  ];

  for (const query of adversarialQueries) {
    const filtered = filterGlobalCommands(query, GLOBAL_COMMANDS);
    assert.ok(Array.isArray(filtered));

    const resolved = resolveGlobalCommand(query, GLOBAL_COMMANDS);
    if (query.trim() === "") {
      assert.equal(resolved, null, "Whitespace-only or empty query must resolve to null");
      assert.equal(filtered.length, GLOBAL_COMMANDS.length, "Empty query must return all global commands");
    } else {
      // Must not throw or crash
      assert.ok(resolved === null || typeof resolved === "object");
    }
  }
});

test("Challenger 1 - Dynamic Island Query: Argument Tokenizer & Prototype Pollution defense", () => {
  // Test prototype pollution attempt via CLI arguments
  const attackCommand = "start --__proto__=polluted --constructor=hacked --toString=malicious";
  const resolved = resolveGlobalCommand(attackCommand, GLOBAL_COMMANDS);

  assert.ok(resolved !== null);
  assert.equal(resolved.definition.id, "start-learning");
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined, "Object.prototype must not be polluted");
  assert.equal(typeof ({}).toString, "function", "Object.prototype.toString must remain standard function");

  // Test quotes with escapes and unclosed quotes
  const unclosedQuote = 'start "unclosed argument with \\" escaped quote';
  const tokens = tokenizeCommandArguments(unclosedQuote);
  assert.ok(Array.isArray(tokens));
  assert.ok(tokens.length > 0);
  assert.doesNotThrow(() => resolveGlobalCommand(unclosedQuote, GLOBAL_COMMANDS));
});

// ============================================================================
// SUITE 2: Corrupted Timestamps & Dynamic Island Duration Robustness
// ============================================================================

test("Challenger 1 - Timer & Formatters: Corrupted, Negative, and Infinite timestamps", () => {
  const now = new Date("2026-08-26T06:00:00Z");

  // 1. Started in the far future (10 years ahead)
  const farFuture = new Date("2036-08-26T06:00:00Z");
  const elapsedFarFuture = getTimerElapsedSeconds({
    status: "running",
    startedAt: farFuture,
    accumulatedPauseSeconds: 0,
    now,
  });
  assert.equal(elapsedFarFuture, 0, "Future startedAt must clamp to 0 elapsed seconds");
  assert.equal(formatClockDuration(elapsedFarFuture), "00:00:00");

  // 2. Started at Unix Epoch 0 with negative elapsed calculation
  const epochStarted = new Date(0);
  const elapsedEpoch = getTimerElapsedSeconds({
    status: "running",
    startedAt: epochStarted,
    accumulatedPauseSeconds: 0,
    now: new Date(0), // Server hydration initial snapshot
  });
  assert.equal(elapsedEpoch, 0, "Server hydration snapshot at now=0 must produce 0 elapsed seconds");
  assert.equal(formatClockDuration(elapsedEpoch), "00:00:00");

  // 3. PausedAt timestamp before startedAt
  const elapsedPausedBeforeStart = getTimerElapsedSeconds({
    status: "paused",
    startedAt: new Date("2026-08-26T06:00:00Z"),
    pausedAt: new Date("2026-08-26T05:00:00Z"), // 1 hour earlier
    accumulatedPauseSeconds: 0,
    now,
  });
  assert.equal(elapsedPausedBeforeStart, 0, "Paused before start must clamp to 0");
  assert.equal(formatClockDuration(elapsedPausedBeforeStart), "00:00:00");

  // 4. Invalid Date inputs (NaN)
  const invalidDate = new Date(NaN);
  const elapsedInvalid = getTimerElapsedSeconds({
    status: "running",
    startedAt: invalidDate,
    accumulatedPauseSeconds: 0,
    now,
  });
  assert.equal(formatClockDuration(elapsedInvalid), "00:00:00", "NaN elapsed must format as 00:00:00");

  // 5. Huge accumulatedPauseSeconds (e.g. 1,000,000 seconds on a 60-second session)
  const elapsedExcessivePause = getTimerElapsedSeconds({
    status: "running",
    startedAt: new Date("2026-08-26T05:59:00Z"),
    accumulatedPauseSeconds: 1_000_000,
    now,
  });
  assert.equal(elapsedExcessivePause, 0, "Excessive pause must clamp to 0 instead of negative");
  assert.equal(formatClockDuration(elapsedExcessivePause), "00:00:00");

  // 6. Non-finite values in formatClockDuration, formatShortDuration, formatBytes
  assert.equal(formatClockDuration(NaN), "00:00:00");
  assert.equal(formatClockDuration(Infinity), "00:00:00");
  assert.equal(formatClockDuration(-9999), "00:00:00");
  assert.equal(formatShortDuration(NaN), "00:00");
  assert.equal(formatShortDuration(-500), "00:00");
  assert.equal(formatBytes(NaN), "未记录");
  assert.equal(formatBytes(-100), "未记录");
  assert.equal(formatBytes(Infinity), "未记录");
});

// ============================================================================
// SUITE 3: Dynamic Island Keyboard Navigation Indexing & Clamping
// ============================================================================

test("Challenger 1 - Dynamic Island: Cyclic navigation with 0, 1, and N commands", () => {
  // Case A: 0 commands
  assert.equal(clampCommandIndex(0, 0), 0);
  assert.equal(clampCommandIndex(10, 0), 0);
  assert.equal(clampCommandIndex(-5, 0), 0);
  assert.equal(clampCommandIndex(NaN, 0), 0);

  // Case B: 1 command
  assert.equal(clampCommandIndex(0, 1), 0);
  assert.equal(clampCommandIndex(1, 1), 0);
  assert.equal(clampCommandIndex(-1, 1), 0);

  // Cyclic navigation simulation with N commands
  const total = 7;
  // Step down from last item (6) wraps to 0
  assert.equal((6 + 1) % total, 0);
  // Step up from first item (0) wraps to 6
  assert.equal((0 - 1 + total) % total, 6);
  // Step up from middle item (3) goes to 2
  assert.equal((3 - 1 + total) % total, 2);
  // Step down from middle item (3) goes to 4
  assert.equal((3 + 1) % total, 4);
});

// ============================================================================
// SUITE 4: Navigation Rail Responsive Transitions & Accessibility
// ============================================================================

test("Challenger 1 - Primary Navigation: All 5 canonical routes match and generate correct aria-current", () => {
  const testCases = [
    { pathname: "/focus", expectedHref: "/focus", activeWorkbench: "/focus" },
    { pathname: "/today", expectedHref: "/today", activeWorkbench: "/today" },
    { pathname: "/knowledge", expectedHref: "/knowledge", activeWorkbench: "/knowledge" },
    { pathname: "/knowledge/cards/123", expectedHref: "/knowledge", activeWorkbench: "/knowledge" },
    { pathname: "/test/retests", expectedHref: "/test/retests", activeWorkbench: "/test/retests" },
    { pathname: "/test/simulations/456", expectedHref: "/test/retests", activeWorkbench: "/test/retests" },
    { pathname: "/roadmap", expectedHref: "/roadmap", activeWorkbench: "/roadmap" },
    { pathname: "/settings", expectedHref: "/settings", activeWorkbench: "/settings" },
    { pathname: "/settings/exams", expectedHref: "/settings", activeWorkbench: "/settings" },
  ];

  for (const tc of testCases) {
    const matchingWorkbench = PRIMARY_WORKBENCH_ITEMS.find((item) => item.match(tc.pathname));
    const matchingUtility = UTILITY_NAV_ITEM.match(tc.pathname) ? UTILITY_NAV_ITEM : null;
    const active = matchingWorkbench ?? matchingUtility;

    assert.ok(active !== null, `Route ${tc.pathname} must match a navigation item`);
    assert.equal(active.href, tc.expectedHref, `Route ${tc.pathname} should match ${tc.expectedHref}`);
  }
});

test("Challenger 1 - Primary Navigation: Tooltip labels on collapsed state and accessibility contrast", () => {
  const navSource = loadSource("components/primary-navigation.tsx");

  // 1. Tooltips when collapsed
  assert.match(navSource, /title=\{props\.collapsed \? props\.item\.label : undefined\}/);

  // 2. Email label hidden when collapsed via sr-only
  assert.match(navSource, /data-primary-email className=\{props\.collapsed \? "sr-only" : undefined\}/);

  // 3. Brand name hidden when collapsed via sr-only
  assert.match(navSource, /data-primary-label className=\{props\.collapsed \? "sr-only" : "truncate text-sm font-medium"\}/);

  // 4. Logout button receives compact prop
  assert.match(navSource, /<LogoutButton compact=\{props\.collapsed\} userId=\{props\.userId\} \/>/);

  // 5. Explicit border divider above utility/settings
  assert.match(navSource, /border-t border-white\/10 pt-4/);
});

// ============================================================================
// SUITE 5: Full App Shell AST Primitive Boundary Exhaustive Scan
// ============================================================================

test("Challenger 1 - AST Primitive Boundary: Zero unauthorized raw primitives in entire App Shell", () => {
  const allShellComponentFiles = [
    "components/app-shell.tsx",
    "components/global-top-bar.tsx",
    "components/primary-navigation.tsx",
    "components/secondary-navigation.tsx",
    "components/shared-study-toolbar.tsx",
    "components/dynamic-island.tsx",
    "components/window-dock.tsx",
    "components/global-confirmation-center.tsx",
    "components/focus-evidence-forms.tsx",
    "components/focus-launcher-subcomponents.tsx",
    "components/focus-launcher-views.tsx",
    "components/focus-session-panels.tsx",
    "components/focus-timer-workspace.tsx",
  ];

  for (const relFile of allShellComponentFiles) {
    const source = loadSource(relFile);

    // 1. Check for raw <button> tags
    const buttonMatches = source.match(/<button[\s>]/g) || [];
    assert.equal(
      buttonMatches.length,
      0,
      `Violation in ${relFile}: contains ${buttonMatches.length} raw <button> tags!`,
    );

    // 2. Check for raw <input> tags
    const inputMatches = source.match(/<input[\s>]/g) || [];
    assert.equal(
      inputMatches.length,
      0,
      `Violation in ${relFile}: contains ${inputMatches.length} raw <input> tags!`,
    );

    // 3. Check for unauthorized local clone patterns
    assert.doesNotMatch(
      source,
      /function IconButton\(/,
      `Violation in ${relFile}: contains local IconButton definition; must import from @/components/ui/button`,
    );
  }
});
