# E2E Test Infra: AreaForge UI Unification

## Test Philosophy
- Opaque-box, requirement-driven, multi-viewport responsive and ergonomic validation.
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory
| # | Feature | Source | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|--------|:------:|:------:|:------:|:------:|
| 1 | Tokens & CSS Variables | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Master & Subtle Cards | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 3 | Form Inputs & Controls | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 4 | Segmented Control & Fields | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 5 | Button System & Glows | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 6 | Pinned Bottom Action Bar | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |
| 7 | App Shell & Dynamic Island | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |
| 8 | Multi-Viewport Ergonomics | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Unit & Contract Suite**: `pnpm --filter @areaforge/web test` (245+ test cases via `tsx --test`).
- **Typecheck Suite**: `pnpm typecheck` (tsc across all workspace packages).
- **UI Boundary Gate**: `pnpm web:ui-primitives-boundary` (prevents raw HTML tag leaks and UI clones).
- **Responsive Layout Matrix**: `pnpm ops:responsive-layout:browser-matrix:selftest` (Playwright across 1920x1080, 1440x900, 1366x768, 768x1024, 375x812).

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | `/focus` Workstation Deep Session | Master Cards, Form Inputs, SegmentedField, Button Primary, PinnedActionBar, Dynamic Island | High |
| 2 | `/knowledge` Syllabus & Note Editor | Subtle Cards, Form Inputs, Textarea, Action Bar, Sidebar Navigation | High |
| 3 | `/test` Practice & Mistake Review | SegmentedControl, Buttons, Master Cards, Form Radio, Zero-Scroll Layout | High |
| 4 | `/today` Learning Action Center | Master Cards, Button Links, Status Indicators, Footer Synchronization | Medium |
| 5 | Global App Shell Navigation & Collapse | Topbar Dynamic Island, Primary/Secondary Navigation Collapse, Footer Status Bar | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature (Total ≥ 40)
- Tier 2: ≥5 boundary & corner tests per feature (Total ≥ 40)
- Tier 3: Pairwise combinations of controls, cards, action bars across viewport breakpoints (Total ≥ 10)
- Tier 4: ≥5 realistic end-to-end user workflows
