# E2E Test Infra: AreaForge Dynamic Island

## Test Philosophy
- Opaque-box, requirement-driven, and visual regression verified.
- Fast, zero-overhead unit testing via native `node:test` + `tsx --test`.
- Deterministic browser visual regression testing via `playwright-core` and local Docker test pool (`areaforge-dev-test-1` on port 43171).
- Methodology: Category-Partition + Boundary Value Analysis + Pairwise Combinatorial + Real-World Workload Testing + Playwright Visual Screenshots.

## Feature Inventory & Test Mapping
| # | Feature | Source (Requirement) | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|---------------------|:------:|:------:|:------:|:------:|
| 1 | Multi-State State Pool Collector | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 2 | Priority Engine Weighting (P0-P7) | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 3 | State Invariant & Fuzzing | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 4 | Three-Segment Capsule Layout | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 5 | Three Independent Click Partitions | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 6 | Smart Ticker Carousel | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ | ✓ |
| 7 | Morphing Floating Hub Shell | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 8 | Hub: 督战全景状态 Panel | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 9 | Hub: 专注心流秒表 Panel | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 10 | Hub: 待确认与晚间收口 Panel | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 11 | Hub: 全键盘命令搜索 Panel | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ | ✓ |
| 12 | Scene-Adaptive Fluid Morphology | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ | ✓ |

## Test Architecture
- **Unit & Integration Runner**: Native `node:test` via `pnpm --filter @areaforge/web test` (`apps/web/components/**/*.test.ts`).
- **Visual E2E Runner**: `scripts/ops/capture-capsule-island-screenshots.ts` using `playwright-core` against `http://127.0.0.1:43171`.
- **Pass/Fail Semantics**:
  - `pnpm typecheck` exits 0 with 0 errors across 8 packages.
  - `pnpm --filter @areaforge/web test` exits 0 with 100% tests passing.
  - Visual verification captures all 7 discrete capsule states and 6 expanded hub consoles with zero layout overflow (`rootOverflow <= 1`).

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Standard Study Session Flow: Idle -> Start Focus -> Live Stopwatch -> Pause -> 1-Click Resume -> Complete & Closeout | F4, F5, F8, F9, F12 | High |
| 2 | Multi-State Alert Concurrency: Paused Focus + Active Recovery Stage 1 + Evening Review Due + Sync Issue -> Smart Ticker rotation & Overview Card in Hub | F1, F2, F6, F7, F8, F10 | High |
| 3 | Instant Command Search & Keyboard Navigation: ⌘K trigger -> morphing search bar -> arrow key navigation -> Enter execution | F5, F7, F11, F12 | Medium |
| 4 | Offline Queue Reconciliation: Network disconnect -> offline timer -> reconnect -> direct sync retry via capsule right segment | F1, F5, F8 | Medium |
| 5 | Full Responsive Viewport Suite: 1080p Desktop, 900p Laptop, 768p Tablet, 390x844 Mobile with zero clipping and smooth 60fps transitions | F4, F7, F12 | High |

## Coverage Thresholds
- Tier 1: ≥5 per feature (≥60 tests)
- Tier 2: ≥5 per feature (≥60 tests covering clock skew, rapid clicking, empty state, text truncation, hotkeys)
- Tier 3: Pairwise coverage of major feature combinations (P0+P3, P2+P4, P1+P5, Search during Live)
- Tier 4: ≥5 realistic application scenarios & Playwright visual screenshot suite across 4 viewports
