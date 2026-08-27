# Project: AreaForge Dynamic Island Two-Phase Liquid Morph & Merge Animation System

## Architecture
The Dynamic Island Ultra system provides desktop-class contextual awareness and interaction across the AreaForge shell. It integrates an 8-tier priority state machine (P0 `live_session_running` through P7 `idle`), route-aware anti-redundancy suppression (`/focus`, `/today`, `/roadmap/reviews`), and state-synced dynamic aura theming (`teal`, `amber`, `indigo`, `silver`).

This project introduces a **Two-Phase Liquid Morph & Merge and Reverse Elastic Detach Animation Engine**:
1. **Forward Animation Pipeline**:
   - **Phase 1 (Horizontal Liquid Merge, 220ms)**: When clicking the main capsule in dual-task mode, the capsule stretches rightward with `cubic-bezier(0.16, 1, 0.3, 1)` while the satellite bubble moves leftward and fuses into the capsule edge, forming a single unbroken wide pill.
   - **Phase 2 (Vertical Expansion, 300ms)**: The merged pill smoothly expands vertically into the Obsidian Glass console (`grid-rows-[0fr->1fr]`) and illuminates with the state-synced Dynamic Aura glow.
2. **Reverse Animation Pipeline**:
   - **Phase 1 (Vertical Collapse, 250ms)**: Pressing `Esc` or clicking outside folds the Obsidian Glass console vertically back into a single-line merged pill.
   - **Phase 2 (Elastic Droplet Detach, 240ms)**: The right edge contracts while the satellite circle elastically pinches off and springs out to the right (`cubic-bezier(0.34, 1.56, 0.64, 1)`), restoring the dual-task exclamation layout `[ Capsule ]  ( Bubble )`.
3. **State Machine Hook (`useLiquidMorphState`)**:
   - FSM with 6 explicit phases: `idle_split`, `idle_single`, `merging_p1`, `expanded_p2`, `collapsing_p1`, `detaching_p2`.
   - Dedicated lifecycle timers with instant keyboard shortcut bypass (`⌘K` fast-forward to `expanded_p2`).

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---|---|---|---|---|
| 1 | Two-Phase Forward Liquid Merge & Expand | Horizontal liquid stretch (220ms) fusing satellite circle, followed by vertical accordion expansion (300ms) into Obsidian Glass hub | M1 | ORIGINAL_REQUEST §R1 | DONE |
| 2 | Reverse Vertical Collapse & Elastic Detach | Vertical collapse (250ms) to single-row merged capsule, followed by elastic spring droplet detachment (240ms) restoring exclamation mark | M2 | ORIGINAL_REQUEST §R2 | DONE |
| 3 | Route-Aware Anti-Redundancy & Aura Sync | Preserve `/focus`, `/today`, `/roadmap/reviews` suppression and 4-tone aura theme synchronization | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 4 | Dual Track Test & Visual Proof Pipeline | 100% pass on `pnpm typecheck`, `pnpm --filter @areaforge/web test` (828/828 pass), Docker slot 1 deploy & Playwright screenshot capture (19/19) | M4 | ORIGINAL_REQUEST §Acceptance Criteria | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status | Key Outputs |
|---|---|---|---|---|---|
| M1 | Liquid Morph State Engine & Forward Pipeline | Implement `dynamic-island-morph.ts` (FSM, timings, classes), update `dynamic-island.tsx` and `dynamic-island-segments.tsx` for 2-phase merge | none | DONE | `dynamic-island-morph.ts`, `globals.css` (.af-satellite-fusing, .af-capsule-merged) |
| M2 | Reverse Collapse & Elastic Detach Physics | Implement reverse fold & droplet separation spring keyframes, rapid toggle safety, keyboard shortcut fast-forward | M1 | DONE | `@keyframes af-satellite-elastic-detach`, `fastForwardToExpanded` |
| M3 | Anti-Redundancy & Aura Sync Integrity | Verify routing suppression across all routes, ensure 100% aura color harmony, modularize complexity ≤ 500 lines | M1, M2 | DONE | `dynamic-island-helpers.tsx` modularized, `dynamic-island.tsx` at 476 lines |
| M4 | Test Coverage & Playwright Visual Verification | Unit test suites (`dynamic-island-morph.test.ts`, `dynamic-island-morph-stress.test.ts`), Docker slot 1 refresh, Playwright multi-frame liquid capture | M1, M2, M3 | DONE | 828/828 unit tests pass, 19/19 1080p screenshots verified in `output/screenshots/dynamic-island-ultra/` |

## Interface Contracts
### `dynamic-island-morph.ts` ↔ `dynamic-island.tsx`
```typescript
export type LiquidMorphPhase =
  | "idle_split"
  | "idle_single"
  | "merging_p1"
  | "expanded_p2"
  | "collapsing_p1"
  | "detaching_p2";

export interface UseLiquidMorphOptions {
  hasSatellite: boolean;
  isOpen: boolean;
  onOpenStateChange: (open: boolean) => void;
}

export interface UseLiquidMorphResult {
  phase: LiquidMorphPhase;
  isMerging: boolean;
  isExpanded: boolean;
  isCollapsing: boolean;
  isDetaching: boolean;
  isSolidMergedCapsule: boolean;
  shouldRenderSatellite: boolean;
  satelliteClass: string;
  capsuleClass: string;
  triggerOpen: (targetViewMode?: string) => void;
  triggerClose: () => void;
  fastForwardOpen: (targetViewMode?: string) => void;
}
```

## Code Layout
- `apps/web/components/dynamic-island-morph.ts`: Core liquid morph FSM hook and timing tokens (235 lines).
- `apps/web/components/dynamic-island-helpers.tsx`: Modular helper subcomponents and elapsed time hooks (279 lines).
- `apps/web/components/dynamic-island.tsx`: Root Dynamic Island container component (476 lines).
- `apps/web/components/dynamic-island-segments.tsx`: Satellite bubble and capsule segment rendering (644 lines).
- `apps/web/components/dynamic-island-glow.ts`: State-synced dynamic aura tokens and classes (417 lines).
- `apps/web/components/dynamic-island-hub.tsx`: Expanded Obsidian Glass console panel (894 lines).
- `apps/web/components/dynamic-island-morph.test.ts`: FSM unit tests (176 lines).
- `apps/web/components/dynamic-island-morph-stress.test.ts`: 18 stress suites and 10,000-iteration monkey fuzzing tests (920 lines).
- `scripts/ops/capture-capsule-island-screenshots.ts`: Playwright automated frame capture script (774 lines).
