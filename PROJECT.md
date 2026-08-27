# Project: AreaForge Dynamic Island (Global Multi-State Fluid Architecture & Morphing Floating Hub)

## Architecture
- **Obsidian Glass Shell**: Obsidian capsule `bg-[#090e12]/98 backdrop-blur-2xl` at `z-[var(--af-layer-modal)]` (120), fine dividers `border-r/border-l border-white/10`, micro-glow tone rings (Teal, Emerald, Amber, Indigo), and 60fps native CSS cubic-bezier transitions.
- **State Pool & Priority Engine**: Multi-state collector (`useDynamicIslandStatePool`) aggregating live sessions, breakpoint pauses, recovery stages, evening review deadlines, offline sync queues, and pending confirmations into a deterministic priority order (P0 to P7).
- **Smart Ticker Carousel**: Smooth auto-rotation carousel (6s cadence) with breathing pagination dots, hover/focus pause, and cross-state transition animations.
- **Independent 3-Segment Partitions**:
  - Left Zone: Status tag / Ticker carousel -> opens Status Hub / Mission Details.
  - Middle Zone: Search input & ⌘K badge -> focuses search & opens Command Palette.
  - Right Zone: Direct contextual quick action (1-click Instant Resume, Closeout link, Sync retry, Stopwatch).
- **Morphing Floating Hub**: 60fps Gaussian blurred console structuring 4 comprehensive panels: (1) 督战全景状态, (2) 专注心流秒表, (3) 待确认与晚间收口指引, (4) 全键盘命令搜索列表.
- **Scene-Adaptive Morphology**: Fluid transformation between Daily Idle Capsule, Live Session Flow Stopwatch (`🟢 LIVE | 科目名 | ⏱ 00:24:32 | ⏸`), and Full Search Bar.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Multi-State State Pool Collector | Collects concurrent active session, recovery, evening review, sync, and confirmations | M1 | Survey / R1 |
| 2 | Priority Engine Weighting | Deterministic prioritization (P0 Live > P1 Closing > P2 Paused > P3 Recovery > P4 Evening > P5 Sync > P6 Confirmations > P7 Idle) | M1 | Survey / R1 |
| 3 | State Invariant & Fuzzing Engine | Mathematical invariants and random permutation test suites for concurrent states | M1 | Survey / R1 |
| 4 | Three-Segment Capsule Layout | Fine dividers `border-white/10`, tone micro-glows, obsidian glass styling | M2 | Survey / R1 |
| 5 | Three Independent Click Partitions | Left -> Status Hub, Middle -> Search Focus, Right -> Direct Instant Action | M2 | Survey / R1 |
| 6 | Smart Ticker Carousel | 6s auto-rotation, breathing pagination dots, hover & focus pause | M2 | Survey / R1 |
| 7 | Morphing Floating Hub Shell | 60fps backdrop-blur-2xl dark console with smooth height unfolding | M3 | Survey / R2 |
| 8 | Hub: 督战全景状态 Panel | Overview of all active missions & one-click recovery / sync actions | M3 | Survey / R2 |
| 9 | Hub: 专注心流秒表 Panel | Live immersion stopwatch, breakpoint resume, fullscreen controls | M3 | Survey / R2 |
| 10 | Hub: 待确认与晚间收口 Panel | Pending confirmations badge & evening review checklist | M3 | Survey / R2 |
| 11 | Hub: 全键盘命令搜索 Panel | Global command palette with fuzzy search & keyboard navigation | M3 | Survey / R2 |
| 12 | Scene-Adaptive Fluid Morphology | Daily Idle -> Live Flow Stopwatch (`🟢 LIVE | 科目名 | ⏱ 00:24:32 | ⏸`) -> Full Search | M3 | Survey / R3 |
| 13 | 4-Tier Test Suite | Comprehensive unit/integration coverage for Tiers 1-4 | M4 | Survey / Acceptance |
| 14 | Playwright Multi-Viewport Visual Suite | Automated screenshot capture across 1080p, 900p, 768p, 390x844 viewports | M4 | Survey / Acceptance |
| 15 | Adversarial Coverage Hardening | White-box stress testing, gap analysis, edge-case coverage (Tier 5) | M4 | Survey / Dual Track |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Multi-State Pool & Priority Engine | State types, concurrent collector, priority calculator, invariant unit tests | None | DONE |
| M2 | Smart Ticker & 3-Segment Interactive Capsule | Independent click partitions, 6s Smart Ticker with breathing dots, glow tokens, action dispatcher | M1 | DONE |
| M3 | Morphing Floating Hub & Scene-Adaptive Morphology | 60fps Gaussian blur console with 4 structured panels, fluid capsule morphing (Idle / Live / Search) | M2 | DONE |
| M4 | E2E Testing Suite, Playwright Visuals & Adversarial Hardening | Full 4-Tier test pass (100% green), Playwright multi-viewport visual screenshots, Tier 5 hardening | M3, TEST_READY | DONE |

## Code Layout
- `apps/web/components/dynamic-island-types.ts` — Shared state types, priority weights, and view models. (DONE)
- `apps/web/components/dynamic-island-state-engine.ts` — Multi-state collector, priority resolver, and invariant helpers. (DONE)
- `apps/web/components/dynamic-island-state-engine.test.ts` — Priority and multi-state unit tests. (DONE)
- `apps/web/components/dynamic-island-ticker.ts` — Smart Ticker hook (auto-rotation, pause on hover/focus). (DONE)
- `apps/web/components/dynamic-island-glow.ts` — Capsule micro-glow style calculation. (DONE)
- `apps/web/components/dynamic-island-segments.tsx` — Partitioned Left, Middle, and Right interactive segments. (DONE)
- `apps/web/components/dynamic-island-hub.tsx` — Morphing Floating Hub 60fps console and structured sub-panels. (DONE)
- `apps/web/components/dynamic-island-hub.test.ts` — Unit tests for hub panels and tab switching. (DONE)
- `apps/web/components/dynamic-island.tsx` — Main Dynamic Island orchestrator & scene-adaptive capsule shell. (DONE)
- `apps/web/components/dynamic-island-capsules.test.ts` — Full unit & integration test suite. (DONE)
- `apps/web/components/dynamic-island-m4-adversarial.test.ts` — Tier 5 Adversarial test suite. (DONE)
- `scripts/ops/capture-capsule-island-screenshots.ts` — Playwright visual screenshot automation. (DONE)
- `TEST_READY.md` — Test suite publish signal & coverage summary. (DONE)
