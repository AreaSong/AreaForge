# E2E Test Infra: AreaForge Dynamic Island Ultra

## Test Philosophy
- Opaque-box, requirement-driven. Derives from ORIGINAL_REQUEST.md.
- Verification mechanism: Node.js native test runner (`tsx --test`) for fast, deterministic unit/integration tests + Playwright for 1080p full-fidelity browser screenshots.

## Feature Inventory & Test Mapping
| # | Feature | Requirement | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|---|---------|-------------|:------:|:------:|:------:|:------:|:------:|
| 1 | Route Anti-Redundancy (`/focus`, `/today`, `/roadmap/reviews`) | R1 | 10 | 5 | 5 | 5 | 5 |
| 2 | Priority Engine & Multi-State Sorting | R1, R2 | 10 | 5 | 5 | 5 | 5 |
| 3 | State-Synced Dynamic Aura Theming (4 themes) | R3 | 5 | 8 | 5 | 8 | 5 |
| 4 | Dual-Task Exclamation Satellite Bubble & Fluid Swap | R2 | 5 | 10 | 5 | 5 | 5 |
| 5 | Hover Micro-Actions on Stopwatch Capsule (`⏸`, `🏁`) | R4 | 5 | 5 | 10 | 5 | 5 |
| 6 | Global ⌘K / / / Esc Keyboard Penetration | R4 | 5 | 5 | 10 | 5 | 5 |
| 7 | Morphing Floating Hub Panels & Default Tab Sync | R3 | 5 | 5 | 5 | 10 | 5 |
| 8 | GlobalTopBar & AppShell Route Plumbing | R1 | 5 | 5 | 5 | 5 | 5 |

## Test Architecture
- Unit/Integration Runner: `node:test` + `node:assert/strict` via `pnpm --filter @areaforge/web test`
- Typecheck: `pnpm typecheck`
- Playwright Screenshot Runner: `npx tsx scripts/ops/capture-capsule-island-screenshots.ts`
- Target Container / Port: Local test pool (`http://127.0.0.1:43171` or dev server)

## 5-Tier Coverage Structure
- **Tier 1 - Feature Coverage**: Core mathematical priority logic, route suppression predicates, dynamic aura tokens.
- **Tier 2 - Boundary & Corner Cases**: Empty states, all-suppressed states, 2+ concurrent unsuppressed states, theme color boundaries, fluid swap toggling.
- **Tier 3 - Cross-Feature & Interactions**: Hover micro-action pills with stopPropagation, global keyboard shortcuts (⌘K, /, Esc), satellite bubble wheel & click interactions.
- **Tier 4 - Real-World Application Scenarios**: Dynamic Island in AppShell, GlobalTopBar route transitions, 4-panel Morphing Floating Hub state synchronization.
- **Tier 5 - Adversarial Stress & Hardening**: Continuous execution loops (50,000 runs), hostile fuzzing inputs (10,000 iterations), 2^8 state permutation matrices, ReDoS resistance.
