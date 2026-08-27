# E2E Test Infra: Dynamic Island Status Capsules & Banner Purification

## Test Philosophy
- Opaque-box & component-level verification derived from user requirements in `ORIGINAL_REQUEST.md`.
- Ensure zero in-page static banners, complete polymorphic capsule transitions in Dynamic Island, strict alert layering, and visual regression prevention across multiple viewports (1080p, 900p, 768p).

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Dynamic Island Polymorphic States | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 2 | One-Click Resume from Paused Capsule | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | Recovery & Evening Review Capsule Triggers | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | `/today` Banner Elimination | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 5 | Other Core Pages Banner Purification | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 6 | Scoped Form Micro-Feedback Layering | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |

## Test Architecture
- Fast unit runner: `pnpm --filter @areaforge/web test` (executes `node:test` via `tsx --test`).
- Monorepo Typecheck: `pnpm typecheck` (tsc across all packages).
- Visual snapshot runner: `scripts/ops/capture-capsule-island-screenshots.ts` using `playwright-core` against local Docker test pool `areaforge-dev-test-1` (`http://127.0.0.1:43171`).

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Cold Start Idle State: Search & Command Palette in Dynamic Island | F1, F6 | Low |
| 2 | Live Focus Session: Real-time Timer Capsule & Expand Hero Focus | F1, F2 | Medium |
| 3 | Paused Focus Session: Activity Paused Capsule & 1-Click Resume | F1, F2, F3 | High |
| 4 | Recovery Mode Active: Amber Glowing Capsule & Open Recovery Drawer | F1, F2, F3 | High |
| 5 | Evening Review Due Window (>= 20:00): Twilight Indigo Capsule & Closeout Nav | F1, F2, F3 | Medium |
| 6 | Multi-page Navigation with Purified Banners: /today, /knowledge, /test, /roadmap | F4, F5, F6 | High |
