# TEST_READY: AreaForge Dynamic Island Verification & Test Suite

## Executive Summary
The test infrastructure and verification suite for the **AreaForge Global Dynamic Island (Obsidian Glass 3-Segment Capsule, Multi-State Priority Pool & Morphing Floating Hub)** are fully validated and production-ready.

- **Workspace Typecheck**: `pnpm typecheck` passed with **0 errors** across all 8 packages.
- **Unit & Integration Suite**: `pnpm --filter @areaforge/web test` passed **677/677 tests (100% green)** in 2.19s.
- **Playwright Visual E2E Suite**: `scripts/ops/capture-capsule-island-screenshots.ts` executed **84/84 visual verification suites (100% green)** against the local test pool container (`http://127.0.0.1:43171`).
- **Multi-Viewport Layout Compliance**: 1080p Desktop, 900p Laptop, 768p Tablet, and 390x844 Mobile verified with **0 layout overflow (`rootOverflow = 0px`)**.
- **Visual Artifacts**: 137 screenshots and full telemetry JSON reports generated at `.agents/m4_worker_1/screenshots/` and `.agents/challenger_visual_playwright_2/screenshots/`.

---

## Test Execution Commands

### 1. Workspace Typecheck
```bash
pnpm typecheck
```
*Validates type safety across packages/core, packages/db, packages/config, packages/storage, packages/ui, packages/ai, packages/auth, and apps/web.*

### 2. Fast Unit & Integration Suite
```bash
pnpm --filter @areaforge/web test
```
*Executes all unit tests using native `node:test` + `tsx --test`, including Dynamic Island state engine, priority invariants, ticker rotation, hub tab switching, and capsule rendering.*

### 3. Local Test Pool Health & Refresh
```bash
# Check test pool health
pnpm dev:test:doctor -- --json

# Refresh test container with latest build
pnpm dev:test:refresh
```

### 4. Playwright Visual Screenshot Automation
```bash
TSX_TSCONFIG_PATH=apps/web/tsconfig.json npx tsx scripts/ops/capture-capsule-island-screenshots.ts
```
*Automates browser login, page purification checks across 8 canonical routes, and multi-state Dynamic Island captures across 4 viewports.*

---

## 4-Tier Test Suite Architecture

| Tier | Focus | Test Count / Coverage | Status |
|------|-------|-----------------------|:------:|
| **Tier 1** | Normal Path Functional Tests | 12 features × ≥5 tests (60+ tests) | PASS (100%) |
| **Tier 2** | Boundary, Skew, Truncation & Edge Cases | 12 features × ≥5 tests (60+ tests) | PASS (100%) |
| **Tier 3** | Pairwise Combinatorial Interactions | Multi-state concurrency (P0+P3, P2+P4, P1+P5, Search during Live) | PASS (100%) |
| **Tier 4** | Real-World Workload Scenarios & Visual E2E | 5 Scenarios across 4 Viewports (1080p, 900p, 768p, 390x844) | PASS (100%) |

---

## Visual Verification Matrix (84/84 Suites Passed)

### 1. Canonical Page Purification (32 Suites)
Verifies that static intrusive banners are eliminated and content renders cleanly without horizontal overflow (`rootOverflow <= 1`):
- `/today` (今日行动中心) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/knowledge` (知识沉淀与全景总览) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/test` (全真模考与实战检验) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/roadmap` (长期路线与阶段规划) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/roadmap/stages` (阶段计划与考纲) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/settings` (系统设置与控制台) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/settings/exams` (考研工作区与科目设置) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**
- `/focus` (专注工作台) — 1080p, 900p, 768p, 390x844: **PASS (0px overflow)**

### 2. Dynamic Island Multi-State & Morphing Hub Suites (52 Suites)
Verifies discrete capsule states, micro-glow rings, and expanded console drawer tabs across all 4 viewports:
- `state1_idle`: Daily Idle Capsule (Obsidian shell, subtle border, ⌘K badge)
- `state2_idle_drawer_open`: Expanded Hub Command Palette (Fuzzy command search, arrow navigation)
- `state3_live_focus_running`: P0 Live Focus Running (Pulsing teal dot, live stopwatch `HH:MM:SS`, teal glow ring)
- `state4_live_focus_hero_drawer`: Live Focus Hub Console (Large flow stopwatch, full-screen trigger, closeout link)
- `state5_activity_paused`: P2 Activity Paused (Paused subject label, inline `[继续]` action, emerald glow ring)
- `state6_activity_paused_hero_drawer`: Paused Breakpoint Console (Breakpoint details, 1-click resume, closeout)
- `state8_recovery_active`: P3 Recovery Mode Active (Energy recovery stage indicator, amber glow ring)
- `state9_recovery_hero_drawer`: Recovery Supervision Console (3-stage guidance cards, recovery shortcut)
- `state10_evening_review_due`: P4 Evening Review Due (20:00 closure indicator, indigo glow ring)
- `state11_evening_review_hero_drawer`: Evening Review Guide Console (Minimum action & daily review checklist)
- `state7_sync_issue`: P5 Offline Queue / Sync Issue (Amber alert tone, 1-click retry button)
- `state12_confirmations_pending`: P6 Pending Confirmations (Decision badge, 1-click review link)
- `state13_live_session_closing`: P1 Live Session Closing (Green closing indicator, closeout link)

---

## Artifact Index & Output Paths
- **Visual JSON Summary**: `.agents/m4_worker_1/screenshots/visual-verification-results.json`
- **Screenshots Directory (Primary)**: `.agents/m4_worker_1/screenshots/`
- **Screenshots Directory (Mirror)**: `.agents/challenger_visual_playwright_2/screenshots/`
- **Test Infrastructure Document**: `TEST_INFRA.md`
- **Project Feature Document**: `PROJECT.md`
