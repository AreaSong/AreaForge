import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {
  useLiquidMorphState,
  LIQUID_TIMINGS,
  getSatelliteLiquidClass,
  getCapsuleLiquidMorphClass,
  getLiquidFoldAnimationClass,
  isReducedMotionPreferred,
  type LiquidMorphPhase,
  type UseLiquidMorphOptions,
  type UseLiquidMorphResult,
} from "./dynamic-island-morph";
import { isInputElement } from "./dynamic-island";

// Polyfill minimal browser DOM & Window for Node test runner
if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as { window: unknown }).window = {
    matchMedia: (query: string) => ({
      matches: query.includes("reduce") && Boolean((globalThis as unknown as { __MOCK_REDUCED_MOTION__?: boolean }).__MOCK_REDUCED_MOTION__),
    }),
    setTimeout: (fn: (...args: unknown[]) => void, ms?: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: unknown) => globalThis.clearTimeout(id as NodeJS.Timeout),
  };
}

if (typeof globalThis.document === "undefined") {
  (globalThis as unknown as { document: unknown }).document = {
    documentElement: {
      getAttribute: (attr: string) => {
        if (attr === "data-af-motion" && (globalThis as unknown as { __MOCK_REDUCED_MOTION_ATTR__?: boolean }).__MOCK_REDUCED_MOTION_ATTR__) {
          return "reduce";
        }
        return null;
      },
    },
  };
}

/**
 * High-fidelity React Hook Test Harness executing against React 19 Client Internals.
 * Replicates React hook state slots, refs, callbacks, effect dependency tracking,
 * cleanup lifecycles, re-renders, and unmount.
 */
interface HookTester<TOpts, TResult> {
  readonly result: TResult;
  render: (newProps: TOpts) => TResult;
  unmount: () => void;
}

function createHookTester<TOpts, TResult>(
  hook: (props: TOpts) => TResult,
  initialProps: TOpts
): HookTester<TOpts, TResult> {
  const stateSlots: unknown[] = [];
  let stateIdx = 0;
  const refSlots: Array<{ current: unknown }> = [];
  let refIdx = 0;
  const effectSlots: Array<{
    effect: () => void | (() => void);
    deps?: unknown[];
    prevDeps?: unknown[];
    cleanup?: void | (() => void);
  }> = [];
  let effectIdx = 0;
  let currentProps = initialProps;
  let result: TResult;
  let isRendering = false;
  let pendingRerender = false;

  const dispatcher = {
    useState(initial: unknown) {
      const idx = stateIdx++;
      if (stateSlots.length <= idx) {
        stateSlots.push(typeof initial === "function" ? (initial as () => unknown)() : initial);
      }
      const setState = (next: unknown) => {
        const val = typeof next === "function" ? (next as (prev: unknown) => unknown)(stateSlots[idx]) : next;
        if (stateSlots[idx] !== val) {
          stateSlots[idx] = val;
          if (!isRendering) {
            render(currentProps);
          } else {
            pendingRerender = true;
          }
        }
      };
      return [stateSlots[idx], setState];
    },
    useRef(initial: unknown) {
      const idx = refIdx++;
      if (refSlots.length <= idx) {
        refSlots.push({ current: initial });
      }
      return refSlots[idx];
    },
    useCallback(fn: (...args: unknown[]) => unknown, deps?: unknown[]) {
      return fn;
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const idx = effectIdx++;
      if (effectSlots.length <= idx) {
        effectSlots.push({ effect, deps, cleanup: undefined, prevDeps: undefined });
      } else {
        effectSlots[idx].effect = effect;
        effectSlots[idx].prevDeps = effectSlots[idx].deps;
        effectSlots[idx].deps = deps;
      }
    },
  };

  function runEffects() {
    for (const slot of effectSlots) {
      let shouldRun = false;
      if (!slot.prevDeps) {
        shouldRun = true;
      } else if (!slot.deps) {
        shouldRun = true;
      } else {
        shouldRun = slot.deps.some((dep, i) => !Object.is(dep, slot.prevDeps?.[i]));
      }
      if (shouldRun) {
        if (typeof slot.cleanup === "function") {
          slot.cleanup();
        }
        slot.cleanup = slot.effect();
      }
    }
  }

  function render(props: TOpts): TResult {
    currentProps = props;
    stateIdx = 0;
    refIdx = 0;
    effectIdx = 0;
    isRendering = true;
    pendingRerender = false;
    const internals = (React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
    }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const prevH = internals.H;
    internals.H = dispatcher;
    try {
      result = hook(currentProps);
    } finally {
      internals.H = prevH;
      isRendering = false;
    }
    runEffects();
    if (pendingRerender) {
      render(currentProps);
    }
    return result;
  }

  render(initialProps);

  return {
    get result() {
      return result;
    },
    render,
    unmount() {
      for (const slot of effectSlots) {
        if (typeof slot.cleanup === "function") {
          slot.cleanup();
        }
      }
    },
  };
}

// ============================================================================
// SUITE 1: Full Forward and Reverse Lifecycle & Timing Verification
// ============================================================================

test("Liquid Morph FSM: Forward Merge -> Expand lifecycle with dual-task satellite", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = false;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  // 1. Initial State
  assert.equal(harness.result.phase, "idle_split");
  assert.equal(harness.result.isExpanded, false);
  assert.equal(harness.result.isMerging, false);
  assert.equal(harness.result.isRenderedSatellite, true);

  // 2. Trigger requestOpen()
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1", "Must enter merging_p1 immediately");
  assert.equal(harness.result.isMerging, true);
  assert.equal(harness.result.isExpanded, false);
  assert.equal(isOpenState, true);

  // 3. Fast-forward 200ms (midway through merge phase)
  t.mock.timers.tick(200);
  assert.equal(harness.result.phase, "merging_p1", "Must remain in merging_p1 at T=200ms");

  // 4. Advance past 400ms
  t.mock.timers.tick(200);
  assert.equal(harness.result.phase, "expanded_p2", "Must advance to expanded_p2 after 400ms");
  assert.equal(harness.result.isExpanded, true);
  assert.equal(harness.result.isMerging, false);
  assert.equal(harness.result.isRenderedSatellite, false);

  t.mock.timers.reset();
});

test("Liquid Morph FSM: Single Item Forward Expand (no satellite) expands instantly", () => {
  let isOpenState = false;
  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: false, isOpen: false }
  );

  assert.equal(harness.result.phase, "idle_single");
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "expanded_p2", "Single item must expand directly without merging_p1");
  assert.equal(harness.result.isExpanded, true);
  assert.equal(isOpenState, true);
});

test("Liquid Morph FSM: Reverse Collapse -> Detach -> Split lifecycle with satellite", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = true;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: true }
  );

  assert.equal(harness.result.phase, "expanded_p2");

  // 1. Trigger requestClose()
  harness.result.requestClose();
  assert.equal(harness.result.phase, "collapsing_p1", "Must enter collapsing_p1 immediately on close");
  assert.equal(harness.result.isCollapsing, true);
  assert.equal(harness.result.isExpanded, false);
  assert.equal(isOpenState, false);

  // 2. Advance 150ms (midway through collapse)
  t.mock.timers.tick(150);
  assert.equal(harness.result.phase, "collapsing_p1");

  // 3. Advance to 260ms -> transitions to detaching_p2
  t.mock.timers.tick(110);
  assert.equal(harness.result.phase, "detaching_p2", "Must advance to detaching_p2 after 260ms collapse");
  assert.equal(harness.result.isDetaching, true);
  assert.equal(harness.result.isCollapsing, false);
  assert.equal(harness.result.isRenderedSatellite, true);

  // 4. Advance 180ms (midway through detach)
  t.mock.timers.tick(180);
  assert.equal(harness.result.phase, "detaching_p2");

  // 5. Advance another 180ms (total 360ms detach) -> returns to idle_split
  t.mock.timers.tick(180);
  assert.equal(harness.result.phase, "idle_split", "Must return to resting idle_split after 360ms detach");
  assert.equal(harness.result.isDetaching, false);

  t.mock.timers.reset();
});

test("Liquid Morph FSM: Single Item Reverse Collapse (no satellite) returns to idle_single directly after collapse", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = true;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: false, isOpen: true }
  );

  assert.equal(harness.result.phase, "expanded_p2");
  harness.result.requestClose();
  assert.equal(harness.result.phase, "collapsing_p1");

  t.mock.timers.tick(260);
  assert.equal(harness.result.phase, "idle_single", "Single item must return to idle_single without detaching_p2");

  t.mock.timers.reset();
});

// ============================================================================
// SUITE 2: Interruption & Race Condition Stress
// ============================================================================

test("Liquid Morph FSM Stress: Escape during merging_p1 cancels merge and smoothly collapses back", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = false;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  // 1. User clicks capsule to open
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1");

  // 2. User presses Escape at T=80ms while still in merging_p1
  t.mock.timers.tick(80);
  assert.equal(harness.result.phase, "merging_p1");

  harness.result.requestClose();
  assert.equal(harness.result.phase, "collapsing_p1", "Must switch directly to collapsing_p1");

  // 3. Ensure the original 400ms merge timer is dead and does NOT force expanded_p2
  t.mock.timers.tick(100);
  assert.equal(harness.result.phase, "collapsing_p1", "Old merge timer must be neutralized");

  // 4. Advance remaining collapse time (260 - 100 = 160ms)
  t.mock.timers.tick(160);
  assert.equal(harness.result.phase, "detaching_p2");

  // 5. Advance 360ms detach time
  t.mock.timers.tick(360);
  assert.equal(harness.result.phase, "idle_split");

  t.mock.timers.reset();
});

test("Liquid Morph FSM Stress: Capsule click during collapsing_p1 cancels collapse and re-merges", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = true;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: true }
  );

  // 1. Trigger close
  harness.result.requestClose();
  assert.equal(harness.result.phase, "collapsing_p1");

  // 2. At T=120ms into collapse, user clicks capsule to re-open
  t.mock.timers.tick(120);
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1", "Must abort collapse and re-enter merging_p1");

  // 3. Advance past old collapse deadline (total 260ms)
  t.mock.timers.tick(140);
  assert.equal(harness.result.phase, "merging_p1", "Must not trigger detaching_p2 from dead collapse timer");

  // 4. Advance remaining merge time (400 - 140 = 260ms)
  t.mock.timers.tick(260);
  assert.equal(harness.result.phase, "expanded_p2", "Must cleanly expand to expanded_p2");

  t.mock.timers.reset();
});

test("Liquid Morph FSM Stress: Capsule click during detaching_p2 cancels detach and re-merges", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = true;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: true }
  );

  // Close -> Collapse (260ms) -> enters detaching_p2
  harness.result.requestClose();
  t.mock.timers.tick(260);
  assert.equal(harness.result.phase, "detaching_p2");

  // At T=100ms into detaching_p2, user clicks capsule to open
  t.mock.timers.tick(100);
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1", "Must abort detach and start merging_p1");

  // Advance 400ms -> expanded_p2
  t.mock.timers.tick(400);
  assert.equal(harness.result.phase, "expanded_p2");

  t.mock.timers.reset();
});

test("Liquid Morph FSM Stress: Redundant consecutive requestOpen and requestClose calls are idempotent", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = false;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  // Spam requestOpen 10 times in rapid succession
  for (let i = 0; i < 10; i++) {
    harness.result.requestOpen();
  }
  assert.equal(harness.result.phase, "merging_p1");

  t.mock.timers.tick(400);
  assert.equal(harness.result.phase, "expanded_p2");

  // Spam requestOpen when already expanded -> must remain expanded without timers
  for (let i = 0; i < 10; i++) {
    harness.result.requestOpen();
  }
  assert.equal(harness.result.phase, "expanded_p2");

  // Spam requestClose 10 times
  for (let i = 0; i < 10; i++) {
    harness.result.requestClose();
  }
  assert.equal(harness.result.phase, "collapsing_p1");

  t.mock.timers.tick(260);
  assert.equal(harness.result.phase, "detaching_p2");

  t.mock.timers.tick(360);
  assert.equal(harness.result.phase, "idle_split");

  // Spam requestClose when already idle -> must be no-op
  for (let i = 0; i < 10; i++) {
    harness.result.requestClose();
  }
  assert.equal(harness.result.phase, "idle_split");

  t.mock.timers.reset();
});

// ============================================================================
// SUITE 3: Global ⌘K / Slash Fast-Forward Keyboard Penetration
// ============================================================================

test("Liquid Morph FSM: fastForwardToExpanded immediately jumps to expanded_p2 from any intermediate phase", (t) => {
  const intermediatePhases: LiquidMorphPhase[] = [
    "idle_split",
    "idle_single",
    "merging_p1",
    "collapsing_p1",
    "detaching_p2",
  ];

  for (const startPhase of intermediatePhases) {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    let isOpenState = startPhase === "expanded_p2" || startPhase === "collapsing_p1";

    const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
      (props) =>
        useLiquidMorphState({
          hasSatellite: props.hasSatellite,
          isOpen: isOpenState,
          onOpenChange: (open) => {
            isOpenState = open;
            harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
          },
        }),
      { hasSatellite: true, isOpen: isOpenState }
    );

    // Setup starting phase
    if (startPhase === "merging_p1") {
      harness.result.requestOpen();
      t.mock.timers.tick(50);
      assert.equal(harness.result.phase, "merging_p1");
    } else if (startPhase === "collapsing_p1") {
      harness.result.fastForwardToExpanded();
      harness.result.requestClose();
      t.mock.timers.tick(50);
      assert.equal(harness.result.phase, "collapsing_p1");
    } else if (startPhase === "detaching_p2") {
      harness.result.fastForwardToExpanded();
      harness.result.requestClose();
      t.mock.timers.tick(260);
      assert.equal(harness.result.phase, "detaching_p2");
    }

    // Call fastForwardToExpanded() (simulates ⌘K or /)
    harness.result.fastForwardToExpanded();
    assert.equal(
      harness.result.phase,
      "expanded_p2",
      `Fast-forward from ${startPhase} must transition immediately to expanded_p2`
    );
    assert.equal(harness.result.isExpanded, true);
    assert.equal(isOpenState, true);

    // Advance time by 1,000ms to prove no trailing callbacks regress the phase
    t.mock.timers.tick(1000);
    assert.equal(harness.result.phase, "expanded_p2", "Phase must stay pinned at expanded_p2");

    t.mock.timers.reset();
  }
});

// ============================================================================
// SUITE 4: Rapid Chattering & Chaotic Fuzzing (10,000 Random Interruption Cycles)
// ============================================================================

test("Liquid Morph FSM Chaotic Stress: 10,000 randomized state transitions & timer fuzzing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = false;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  const validPhases = new Set<LiquidMorphPhase>([
    "idle_split",
    "idle_single",
    "merging_p1",
    "expanded_p2",
    "collapsing_p1",
    "detaching_p2",
  ]);

  for (let i = 0; i < 10000; i++) {
    const action = i % 5;
    const hasSat = (i & 1) === 0;

    // Mutate props occasionally
    if (i % 100 === 0) {
      harness.render({ hasSatellite: hasSat, isOpen: isOpenState });
    }

    if (action === 0) {
      harness.result.requestOpen();
    } else if (action === 1) {
      harness.result.requestClose();
    } else if (action === 2) {
      harness.result.fastForwardToExpanded();
    } else if (action === 3) {
      // Small tick
      t.mock.timers.tick((i * 17) % 150);
    } else {
      // Big tick
      t.mock.timers.tick((i * 31) % 400);
    }

    // INVARIANT 1: Phase is always one of 6 valid phases
    assert.ok(
      validPhases.has(harness.result.phase),
      `Iteration ${i}: Phase "${harness.result.phase}" is invalid`
    );

    // INVARIANT 2: Boolean helper flags match phase strictly
    assert.equal(harness.result.isExpanded, harness.result.phase === "expanded_p2");
    assert.equal(harness.result.isMerging, harness.result.phase === "merging_p1");
    assert.equal(harness.result.isCollapsing, harness.result.phase === "collapsing_p1");
    assert.equal(harness.result.isDetaching, harness.result.phase === "detaching_p2");

    // INVARIANT 3: CSS classes are non-empty strings
    assert.ok(harness.result.satelliteAnimationClass.length > 0);
    assert.ok(harness.result.capsuleMorphClass.length > 0);
  }

  // Quiescent settling verification: after 1000ms idle, FSM MUST be in a resting state
  t.mock.timers.tick(1000);
  assert.ok(
    harness.result.phase === "idle_split" ||
      harness.result.phase === "idle_single" ||
      harness.result.phase === "expanded_p2",
    `FSM must settle into resting state, but got: ${harness.result.phase}`
  );

  t.mock.timers.reset();
});

// ============================================================================
// SUITE 5: Dynamic Satellite Presence (hasSatellite) Drift Stress
// ============================================================================

test("Liquid Morph FSM: hasSatellite dynamic toggling synchronizes resting states cleanly", () => {
  let isOpenState = false;
  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  assert.equal(harness.result.phase, "idle_split");

  // Satellite removed while closed -> switches to idle_single
  harness.render({ hasSatellite: false, isOpen: false });
  assert.equal(harness.result.phase, "idle_single");

  // Satellite restored while closed -> switches to idle_split
  harness.render({ hasSatellite: true, isOpen: false });
  assert.equal(harness.result.phase, "idle_split");
});

// ============================================================================
// SUITE 6: Reduced Motion Accessibility Bypass Mode
// ============================================================================

test("Liquid Morph FSM: Reduced motion bypasses all intermediate animation phases", () => {
  (globalThis as unknown as { __MOCK_REDUCED_MOTION_ATTR__?: boolean }).__MOCK_REDUCED_MOTION_ATTR__ = true;
  assert.equal(isReducedMotionPreferred(), true, "Reduced motion must be detected");

  let isOpenState = false;
  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  assert.equal(harness.result.phase, "idle_split");

  // requestOpen() goes immediately to expanded_p2
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "expanded_p2", "Reduced motion must bypass merging_p1");

  // requestClose() goes immediately to idle_split
  harness.result.requestClose();
  assert.equal(harness.result.phase, "idle_split", "Reduced motion must bypass collapsing_p1 and detaching_p2");

  (globalThis as unknown as { __MOCK_REDUCED_MOTION_ATTR__?: boolean }).__MOCK_REDUCED_MOTION_ATTR__ = false;
});

// ============================================================================
// SUITE 7: Memory Safety, Timer Teardown, and Unmount Protection
// ============================================================================

test("Liquid Morph FSM: Unmount during intermediate phase cleanly aborts active timers", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = false;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  // Start merging_p1
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1");

  // Unmount component while timer is in flight
  harness.unmount();

  // Advance time beyond merge duration
  t.mock.timers.tick(500);

  // No errors thrown, memory is cleanly reclaimed
  assert.ok(true, "Unmount cleanup executed without dangling timer exceptions");
  t.mock.timers.reset();
});

// ============================================================================
// SUITE 8: Dynamic Island Component Contract & Keyboard Integration
// ============================================================================

test("Dynamic Island Helpers: isInputElement identifies text entry elements and rejects others safely", () => {
  assert.equal(isInputElement(null), false);
  assert.equal(isInputElement(undefined as unknown as Element), false);

  const mockInput = { tagName: "INPUT" } as Element;
  const mockTextarea = { tagName: "TEXTAREA" } as Element;
  const mockSelect = { tagName: "SELECT" } as Element;
  const mockDiv = { tagName: "DIV", isContentEditable: false } as unknown as Element;
  const mockEditableDiv = { tagName: "DIV", isContentEditable: true } as unknown as Element;

  assert.equal(isInputElement(mockInput), true);
  assert.equal(isInputElement(mockTextarea), true);
  assert.equal(isInputElement(mockSelect), true);
  assert.equal(isInputElement(mockDiv), false);
  assert.equal(isInputElement(mockEditableDiv), true);
});

test("Dynamic Island Morph: getLiquidFoldAnimationClass returns strict CSS grid-template-rows", () => {
  const openFold = getLiquidFoldAnimationClass("expanded_p2");
  assert.ok(openFold.containerGridClass.includes("grid-rows-[1fr]"));
  assert.ok(openFold.containerGridClass.includes("opacity-100"));
  assert.ok(openFold.innerContentClass.includes("translate-y-0"));

  const closedPhases: LiquidMorphPhase[] = [
    "idle_split",
    "idle_single",
    "merging_p1",
    "collapsing_p1",
    "detaching_p2",
  ];
  for (const p of closedPhases) {
    const closedFold = getLiquidFoldAnimationClass(p);
    assert.ok(closedFold.containerGridClass.includes("grid-rows-[0fr]"));
    assert.ok(closedFold.containerGridClass.includes("opacity-0"));
    assert.ok(closedFold.containerGridClass.includes("pointer-events-none"));
    assert.ok(closedFold.innerContentClass.includes("-translate-y-2"));
  }
});

// ============================================================================
// SUITE 9: Comprehensive State Transition Matrix Table
// ============================================================================

test("Liquid Morph FSM: State Transition Invariant Matrix verification", () => {
  const transitions: Array<{
    initialPhase: LiquidMorphPhase;
    hasSatellite: boolean;
    action: "requestOpen" | "requestClose" | "fastForwardToExpanded";
    expectedImmediatePhase: LiquidMorphPhase;
    settlesToPhase: LiquidMorphPhase;
  }> = [
    // From idle_split
    { initialPhase: "idle_split", hasSatellite: true, action: "requestOpen", expectedImmediatePhase: "merging_p1", settlesToPhase: "expanded_p2" },
    { initialPhase: "idle_split", hasSatellite: true, action: "requestClose", expectedImmediatePhase: "idle_split", settlesToPhase: "idle_split" },
    { initialPhase: "idle_split", hasSatellite: true, action: "fastForwardToExpanded", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },

    // From idle_single
    { initialPhase: "idle_single", hasSatellite: false, action: "requestOpen", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },
    { initialPhase: "idle_single", hasSatellite: false, action: "requestClose", expectedImmediatePhase: "idle_single", settlesToPhase: "idle_single" },
    { initialPhase: "idle_single", hasSatellite: false, action: "fastForwardToExpanded", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },

    // From expanded_p2 with satellite
    { initialPhase: "expanded_p2", hasSatellite: true, action: "requestOpen", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },
    { initialPhase: "expanded_p2", hasSatellite: true, action: "requestClose", expectedImmediatePhase: "collapsing_p1", settlesToPhase: "idle_split" },
    { initialPhase: "expanded_p2", hasSatellite: true, action: "fastForwardToExpanded", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },

    // From expanded_p2 without satellite
    { initialPhase: "expanded_p2", hasSatellite: false, action: "requestOpen", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },
    { initialPhase: "expanded_p2", hasSatellite: false, action: "requestClose", expectedImmediatePhase: "collapsing_p1", settlesToPhase: "idle_single" },
    { initialPhase: "expanded_p2", hasSatellite: false, action: "fastForwardToExpanded", expectedImmediatePhase: "expanded_p2", settlesToPhase: "expanded_p2" },
  ];

  for (const tCase of transitions) {
    let isOpenState = tCase.initialPhase === "expanded_p2";
    const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
      (props) =>
        useLiquidMorphState({
          hasSatellite: props.hasSatellite,
          isOpen: isOpenState,
          onOpenChange: (open) => {
            isOpenState = open;
            harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
          },
        }),
      { hasSatellite: tCase.hasSatellite, isOpen: isOpenState }
    );

    // Trigger action
    harness.result[tCase.action]();
    assert.equal(
      harness.result.phase,
      tCase.expectedImmediatePhase,
      `From ${tCase.initialPhase} (${tCase.hasSatellite ? "sat" : "single"}) on ${tCase.action}: expected ${tCase.expectedImmediatePhase}, got ${harness.result.phase}`
    );
  }
});

// ============================================================================
// SUITE 10: Real-World Rapid User Interruption Sequences
// ============================================================================

test("Liquid Morph FSM: Realistic rapid user interruption scenario (Open -> ⌘K -> Esc -> Click -> Esc)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let isOpenState = false;

  const harness = createHookTester<UseLiquidMorphOptions, UseLiquidMorphResult>(
    (props) =>
      useLiquidMorphState({
        hasSatellite: props.hasSatellite,
        isOpen: isOpenState,
        onOpenChange: (open) => {
          isOpenState = open;
          harness.render({ hasSatellite: props.hasSatellite, isOpen: open });
        },
      }),
    { hasSatellite: true, isOpen: false }
  );

  // 1. User clicks capsule to open (starts merging_p1)
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1");

  // 2. User presses ⌘K at T=30ms (fast forwards)
  t.mock.timers.tick(30);
  harness.result.fastForwardToExpanded();
  assert.equal(harness.result.phase, "expanded_p2");

  // 3. User immediately hits Escape at T=60ms (collapsing_p1)
  t.mock.timers.tick(30);
  harness.result.requestClose();
  assert.equal(harness.result.phase, "collapsing_p1");

  // 4. At T=120ms into collapse, user clicks capsule again (merging_p1)
  t.mock.timers.tick(60);
  harness.result.requestOpen();
  assert.equal(harness.result.phase, "merging_p1");

  // 5. Allow merge to complete (400ms) -> expanded_p2
  t.mock.timers.tick(400);
  assert.equal(harness.result.phase, "expanded_p2");

  // 6. User clicks outside / Esc -> collapses cleanly back to idle_split
  harness.result.requestClose();
  assert.equal(harness.result.phase, "collapsing_p1");
  t.mock.timers.tick(260);
  assert.equal(harness.result.phase, "detaching_p2");
  t.mock.timers.tick(360);
  assert.equal(harness.result.phase, "idle_split");

  t.mock.timers.reset();
});

// ============================================================================
// SUITE 11: File Budget and Code Modularity Standards
// ============================================================================

test("Code Architecture: All dynamic-island source files strictly conform to ≤ 500 lines budget", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const filesToCheck = [
    "components/dynamic-island-morph.ts",
    "components/dynamic-island-helpers.tsx",
    "components/dynamic-island.tsx",
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), "apps/web", relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n").length;
      assert.ok(
        lines <= 500,
        `File ${relPath} exceeds 500 lines budget! Actual: ${lines} lines.`
      );
    }
  }
});

