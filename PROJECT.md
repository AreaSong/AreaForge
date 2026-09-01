# Project: AreaForge 14-inch MacBook Pro Viewport, Grid, Density & Visual Denoising Refactoring

## Architecture
This project refactors and polishes the AreaForge frontend for 14-inch MacBook Pro (1440px~1512px viewport width) and desktop workstation environments. It establishes a fluid Container Query grid architecture, standardizes an 8pt 3-tier Surface hierarchy, enforces a strict Max 2 Badges visual denoising policy, compresses global toolbars by 26.4% (+15% vertical content gain), modularizes oversized components under 500 lines, and strictly preserves 100% of business logic, state machines, and API contracts with zero regressions.

### Key Architectural Pillars
1. **Container Query & Fluid Grid Architecture (R1)**:
   - Replaced brittle viewport-level `xl:` (>=1280px) breakpoints with Container Queries (`@container`) across main content areas.
   - Dual sidebars (Primary 184px + Secondary 216px = 400px) leave 992px~1064px net content width on 14" MacBooks; internal grids adapt to container width to guarantee 2-column or 3-column golden ratios without card crushing (eliminating 78px and 137.5px compressed cards).
2. **Icons & Badges Systemic Denoising (R2)**:
   - **Max 2 Badges Rule**: Single card header is constrained to maximum 2 badges (1 Primary State Badge + 1 Optional Context Badge).
   - Elimination of purely decorative icons (`Sparkles`, `Compass`, `BookOpen`, `Layers`, `Clock` / `History` / `Star` prefixes).
   - Metric numbers converged to footer single-line monospace text (`font-mono text-xs text-zinc-400`).
3. **Surface Hierarchy & Russian-Doll De-nesting (R3)**:
   - Strict 3-tier Surface model: `Surface Base` (#0e1619 / `border-white/8`), `Surface Raised` (`rgba(255,255,255,0.03)` / `border-white/5`), `Surface Overlay` (#121c20 / `border-white/15`).
   - Forbids Card-in-Card nesting; replaces nested card wrappers with clean `divide-y divide-white/5` dividers.
   - Standardized `packages/ui/src/card.tsx` to 8pt steps (`sm: p-3`, `md: p-4 sm:p-5`, `lg: p-5 sm:p-6`) and eliminated 130+ non-standard `!p-2.5`, `!p-3.5`, `!p-4.5` overrides.
4. **Vertical Toolbar Space Optimization (R4)**:
   - GlobalTopBar: 61px -> 47px (-14px, -23%).
   - PageToolbar: 57px -> 39px (-18px, -31.6%).
   - GlobalContextStatusBar: 41px -> 31px (-10px, -24.4%).
   - Total fixed toolbars: 159px -> 117px (-42px, -26.4%), releasing ≥15% vertical content area on 14" screens.
5. **AST Boundary Compliance, Component Modularity & Zero Regression (R5)**:
   - Split 4 oversized components >500 lines (`dynamic-island-hub.tsx`, `dynamic-island-segments.tsx`, `focus-evidence-forms.tsx`, `focus-session-client.tsx`) to pass `pnpm web:component-complexity`.
   - Replaced raw `<button>` tags with canonical UI primitives to pass `pnpm web:ui-primitives-boundary`.
   - 100% preservation of `lib/client/**`, `lib/api/**`, `lib/contracts/**`, and state machines.

## Feature Inventory
| # | Feature | Description | Milestone | Source | Status |
|---|---|---|---|---|---|
| 1 | 8pt Spacing Token & UI Card Primitive Standardization | Standardize `cardPaddingClasses` in `packages/ui/src/card.tsx` to 8pt rhythm, eliminate non-standard paddings | M1 | ORIGINAL_REQUEST §R3 | DONE |
| 2 | Global Toolbars Vertical Height Compression | Optimize GlobalTopBar (47px), PageToolbar (39px), and GlobalContextStatusBar (31px) | M1 | ORIGINAL_REQUEST §R4 | DONE |
| 3 | `/today` 14" Viewport Container Adaptation | Rebalance TodayRecommendation, SubjectTimerList, and TodayLearningSummary with `@container` | M2 | ORIGINAL_REQUEST §R1 | DONE |
| 4 | `/knowledge`, `/test`, `/roadmap` Grid Adaptation | Refactor KPI strips, Gantt timeline, weak loss rankings, and syllabus tables to fluid container grids | M2 | ORIGINAL_REQUEST §R1 | DONE |
| 5 | Card Badges & Icons Systemic Denoising | Apply Max 2 Badges rule and remove decorative icons in TodayRecommendation, KnowledgePointCard, MicroBadges | M3 | ORIGINAL_REQUEST §R2 | DONE |
| 6 | Surface De-nesting & Multi-layer Container Removal | Eliminate Russian-Doll nesting in TodayLearningSummary, SyllabusTreeNode, NoteCard, MistakeCard, TestQueue | M3 | ORIGINAL_REQUEST §R3 | DONE |
| 7 | AST Governance & Modular Splitting (≤500 lines) | Split 4 oversized components, fix raw UI primitives, pass `pnpm check` and boundary scripts | M4 | ORIGINAL_REQUEST §R5 | DONE |
| 8 | E2E Regression Testing & 14" Viewport Verification | Pass 100% unit tests (967/967), full `pnpm check`, dev-test pool slot 1 refresh and Playwright 14" MBP screenshots | M5 | ORIGINAL_REQUEST §Acceptance Criteria | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status | Key Outputs |
|---|---|---|---|---|---|
| M1 | UI Primitive Tokens & Global Toolbars Vertical Compression | Update `packages/ui/src/card.tsx`, `app-shell.tsx`, `global-top-bar.tsx`, `page-toolbar.tsx`, `shared-study-toolbar.tsx` | none | DONE | 8pt Card padding, 117px combined toolbars, 54px vertical space savings |
| M2 | 14" MacBook Viewport Grids & Container Adaptation | Update `/today`, `/knowledge`, `/test`, `/roadmap` views with `@container` and adaptive columns | M1 | DONE | Adaptive 2/3-col layouts without card crushing |
| M3 | Icons/Badges Denoising & Surface De-nesting | Refactor card headers to Max 2 Badges, remove decorative icons, replace nested cards with dividers | M1, M2 | DONE | Clean card headers, flat surface hierarchy, 0 decorative clutter |
| M4 | AST Governance & Modular Splitting (≤500 lines) | Modularize 4 oversized components, fix raw UI primitives, pass `pnpm check` and boundary scripts | M1, M2, M3 | DONE | All 293 TSX components ≤500 lines, 0 raw buttons, 0 boundary errors |
| M5 | Dual-Track E2E & Visual Verification | Run all test suites (967/967 pass), verify zero regression, refresh dev test pool, capture 14" MacBook Pro screenshots | M1, M2, M3, M4 | DONE | Full test suite green, dev-test slot 1 verified (43171), visual proof artifacts |

## Interface Contracts
### Surface Tokens (`Surface Base` -> `Surface Raised` -> `Surface Overlay`)
```typescript
export const surfaceTokens = {
  canvas: "bg-[#080b0f]",
  base: "bg-[#0e1619] border border-white/8 shadow-sm",
  raised: "bg-white/[0.03] border border-white/5",
  overlay: "bg-[#121c20] border border-white/15 shadow-2xl backdrop-blur-xl",
} as const;
```

### Card Padding Standard (`packages/ui/src/card.tsx`)
```typescript
export const cardPaddingClasses: Record<CardPadding, string> = {
  none: "",
  sm: "p-3",               // 12px
  md: "p-4 sm:p-5",        // 16px (20px on expanded screens)
  lg: "p-5 sm:p-6",        // 20px (24px on expanded screens)
};
```
