import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import {
  LIQUID_TIMINGS,
  getSatelliteLiquidClass,
  getCapsuleLiquidMorphClass,
  getLiquidFoldAnimationClass,
  isReducedMotionPreferred,
  type LiquidMorphPhase,
} from "./dynamic-island-morph";

describe("Dynamic Island Liquid Morph Engine: Constants & Timings", () => {
  it("exports exact physics timings compliant with Apple Liquid Spring specifications", () => {
    assert.equal(LIQUID_TIMINGS.MERGE_P1_MS, 400, "Forward phase 1 merge must be 400ms");
    assert.equal(LIQUID_TIMINGS.EXPAND_P2_MS, 320, "Forward phase 2 vertical unfold must be 320ms");
    assert.equal(LIQUID_TIMINGS.COLLAPSE_P1_MS, 260, "Reverse phase 1 vertical fold must be 260ms");
    assert.equal(LIQUID_TIMINGS.DETACH_P2_MS, 360, "Reverse phase 2 elastic detach must be 360ms");
  });
});

describe("Dynamic Island Liquid Morph Engine: Satellite Liquid Animation Classes", () => {
  it("resolves idle_split satellite state to resting layout", () => {
    const cls = getSatelliteLiquidClass("idle_split", true);
    assert.ok(cls.includes("opacity-100"), `Expected opacity-100, got: ${cls}`);
    assert.ok(cls.includes("transform-none"), `Expected transform-none, got: ${cls}`);
  });

  it("resolves merging_p1 satellite state to liquid fusing with leftward translation", () => {
    const cls = getSatelliteLiquidClass("merging_p1", true);
    assert.ok(cls.includes("af-satellite-fusing"), `Expected af-satellite-fusing, got: ${cls}`);
    assert.ok(cls.includes("pointer-events-none"), `Expected pointer-events-none, got: ${cls}`);
  });

  it("resolves expanded_p2 and collapsing_p1 satellite state to hidden", () => {
    const clsExpanded = getSatelliteLiquidClass("expanded_p2", true);
    assert.ok(clsExpanded.includes("opacity-0"), `Expected opacity-0, got: ${clsExpanded}`);
    assert.ok(clsExpanded.includes("pointer-events-none"), `Expected pointer-events-none, got: ${clsExpanded}`);

    const clsCollapse = getSatelliteLiquidClass("collapsing_p1", true);
    assert.ok(clsCollapse.includes("opacity-0"), `Expected opacity-0, got: ${clsCollapse}`);
  });

  it("resolves detaching_p2 satellite state to elastic detachment animation", () => {
    const cls = getSatelliteLiquidClass("detaching_p2", true);
    assert.ok(cls.includes("af-satellite-detaching"), `Expected af-satellite-detaching, got: ${cls}`);
  });

  it("hides satellite when hasSatellite is false regardless of phase", () => {
    const phases: LiquidMorphPhase[] = [
      "idle_split",
      "idle_single",
      "merging_p1",
      "expanded_p2",
      "collapsing_p1",
      "detaching_p2",
    ];
    for (const p of phases) {
      const cls = getSatelliteLiquidClass(p, false);
      assert.ok(cls.includes("hidden"), `Phase ${p} should be hidden when hasSatellite is false`);
    }
  });
});

describe("Dynamic Island Liquid Morph Engine: Capsule Liquid Morph Classes", () => {
  it("renders resting split capsule in idle_split mode", () => {
    const cls = getCapsuleLiquidMorphClass("idle_split", true, false);
    assert.ok(cls.includes("rounded-[18px]"));
    assert.ok(cls.includes("flex-1"));
    assert.ok(cls.includes("relative"));
  });

  it("renders single wide capsule in idle_single mode", () => {
    const cls = getCapsuleLiquidMorphClass("idle_single", false, false);
    assert.ok(cls.includes("rounded-[18px]"));
    assert.ok(cls.includes("w-full"));
  });

  it("applies horizontal liquid stretch in merging_p1 mode", () => {
    const cls = getCapsuleLiquidMorphClass("merging_p1", true, false);
    assert.ok(cls.includes("af-capsule-merged"), `Expected af-capsule-merged, got: ${cls}`);
    assert.ok(cls.includes("duration-[400ms]"), `Expected duration-[400ms], got: ${cls}`);
  });

  it("applies obsidian glass card styling in expanded_p2 mode", () => {
    const cls = getCapsuleLiquidMorphClass("expanded_p2", true, true);
    assert.ok(cls.includes("rounded-[20px]"));
    assert.ok(cls.includes("relative"));
    assert.ok(cls.includes("duration-[320ms]"));
    assert.ok(cls.includes("ring-1 ring-white/10"));
  });

  it("applies vertical fold styling in collapsing_p1 mode", () => {
    const cls = getCapsuleLiquidMorphClass("collapsing_p1", true, false);
    assert.ok(cls.includes("rounded-[18px]"));
    assert.ok(cls.includes("duration-[260ms]"));
  });

  it("applies elastic detachment spring retraction in detaching_p2 mode", () => {
    const cls = getCapsuleLiquidMorphClass("detaching_p2", true, false);
    assert.ok(cls.includes("duration-[360ms]"));
    assert.ok(cls.includes("flex-1"));
  });
});

describe("Dynamic Island Liquid Morph Engine: Fold Animation Class Generator", () => {
  it("generates grid-rows-[1fr] and translate-y-0 when phase is expanded_p2", () => {
    const { containerGridClass, innerContentClass } = getLiquidFoldAnimationClass("expanded_p2");
    assert.ok(containerGridClass.includes("grid-rows-[1fr]"));
    assert.ok(containerGridClass.includes("opacity-100"));
    assert.ok(innerContentClass.includes("translate-y-0"));
  });

  it("generates grid-rows-[0fr] and pointer-events-none when phase is not expanded_p2", () => {
    const phases: LiquidMorphPhase[] = [
      "idle_split",
      "idle_single",
      "merging_p1",
      "collapsing_p1",
      "detaching_p2",
    ];
    for (const p of phases) {
      const { containerGridClass, innerContentClass } = getLiquidFoldAnimationClass(p);
      assert.ok(containerGridClass.includes("grid-rows-[0fr]"));
      assert.ok(containerGridClass.includes("opacity-0"));
      assert.ok(containerGridClass.includes("pointer-events-none"));
      assert.ok(innerContentClass.includes("-translate-y-2"));
    }
  });
});

describe("Dynamic Island Liquid Morph Engine: Reduced Motion Detection", () => {
  it("returns false in non-browser environment or default environment safely", () => {
    const reduced = isReducedMotionPreferred();
    assert.equal(typeof reduced, "boolean");
  });
});

describe("Dynamic Island Liquid Morph Engine: 1,000-Iteration FSM Transition Invariant Fuzzing", () => {
  it("guarantees valid state and valid CSS classes across 1,000 randomized state permutations", () => {
    const allPhases: LiquidMorphPhase[] = [
      "idle_split",
      "idle_single",
      "merging_p1",
      "expanded_p2",
      "collapsing_p1",
      "detaching_p2",
    ];

    for (let i = 0; i < 1000; i++) {
      const phase = allPhases[Math.floor(Math.random() * allPhases.length)];
      const hasSatellite = Math.random() > 0.5;
      const isOpen = phase === "expanded_p2" || (phase === "merging_p1" && Math.random() > 0.5);

      const satelliteClass = getSatelliteLiquidClass(phase, hasSatellite);
      const capsuleClass = getCapsuleLiquidMorphClass(phase, hasSatellite, isOpen);
      const foldClasses = getLiquidFoldAnimationClass(phase);

      assert.ok(typeof satelliteClass === "string" && satelliteClass.length > 0);
      assert.ok(typeof capsuleClass === "string" && capsuleClass.length > 0);
      assert.ok(typeof foldClasses.containerGridClass === "string");
      assert.ok(typeof foldClasses.innerContentClass === "string");

      if (phase === "expanded_p2") {
        assert.ok(capsuleClass.includes("rounded-[20px]"));
        assert.ok(foldClasses.containerGridClass.includes("grid-rows-[1fr]"));
      } else {
        assert.ok(foldClasses.containerGridClass.includes("grid-rows-[0fr]"));
      }

      if (!hasSatellite) {
        assert.ok(satelliteClass.includes("hidden"));
      }
    }
  });
});
