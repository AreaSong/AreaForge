# Project: AreaForge Dynamic Island Ultra (Global Multi-State Fluid Architecture & Morphing Floating Hub)

## Architecture
- **Obsidian Glass Shell**: Obsidian capsule `bg-[#090e12]/98 backdrop-blur-2xl` at `z-[var(--af-layer-modal)]` (120), fine dividers `border-r/border-l border-white/10`, 60fps native CSS cubic-bezier Apple spring transitions (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Context-Aware Anti-Redundancy Engine**: Route context (`pathname`) propagation from `AppShell` -> `GlobalTopBar` -> `DynamicIsland` -> `useDynamicIslandStatePool` / `collectDynamicIslandStates`. Route-specific state suppression:
  - On `/focus`: suppress stopwatch (`live_session_running`, `live_session_closing`, `activity_paused`) -> pure search capsule / next state. Rise when navigating away.
  - On `/today`: suppress `recovery_active` -> pure search capsule / next state. Rise when navigating away.
  - On `/roadmap/reviews` (`/roadmap/reviews*`): suppress `evening_review_due` -> pure search capsule / next state. Rise when navigating away.
- **Dual-Task Island & Satellite Bubble Morphing**: When multiple unsuppressed states exist (`activeStates.length >= 2`), automatically splits into `[Main Capsule]` + `[Independent Glowing Satellite Bubble]` (exclamation mark `!` layout).
  - Satellite Bubble click / wheel swipe triggers 60fps Fluid Swap Morph, exchanging dominant and satellite focus.
  - Clicking Main Capsule opens the Morphing Floating Hub or navigates to route.
- **State-Synced Dynamic Aura & Theming Engine**: Morphing Console Hub border, shadow aura, default active tab, highlight & action buttons are 100% color-synced with active dominant state:
  - 🌙 晚间收口: Twilight Indigo (`#6366f1`, `border-indigo-500/30`, `shadow-[0_12px_40px_rgba(99,102,241,0.22)]`), default tab 🌙 晚间指引, indigo accents.
  - ⚡ 精力恢复: Amber Gold (`#f59e0b`, `border-amber-500/30`, `shadow-[0_12px_40px_rgba(245,158,11,0.22)]`), default tab ⚡ 督战全景, amber accents.
  - 🟢 专注计时: Geek Teal / Green (`#14b8a6`, `border-teal-500/30`, `shadow-[0_12px_40px_rgba(20,184,166,0.22)]`), default tab ⏱ 专注心流, teal accents.
  - 🔍 纯命令搜索: Pure Dark Glass & Silver Glow (`#94a3b8`, `border-white/10`, `shadow-[0_12px_40px_rgba(0,0,0,0.5)]`), default tab 🔍 命令搜索.
- **Hover Quick Actions & Global ⌘K Keyboard Penetration**:
  - Hovering on focus stopwatch capsule reveals `[ ⏸ 暂停 ]` and `[ 🏁 收口 ]` micro-action pills with `stopPropagation`.
  - Global `⌘K` or `/` expands into full Command Palette with spring physics; `Esc` collapses back smoothly.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Route Context & Anti-Redundancy Engine | Route propagation and suppression (`/focus`, `/today`, `/roadmap/reviews`) | M1 | Survey / R1 |
| 2 | State Priority Engine & Dual-Task Sorting | Deterministic priority resolution & multi-state dual selection | M1 | Survey / R1, R2 |
| 3 | State-Synced Dynamic Aura Tokens | 4 synchronized theme profiles (Indigo, Amber, Teal, Silver) | M1 | Survey / R3 |
| 4 | Dual-Task Exclamation Satellite Bubble | `[Main Capsule] + [Bubble]` split, click & wheel fluid swap morph | M2 | Survey / R2 |
| 5 | Hover Micro-Actions on Stopwatch | Floating `[ ⏸ 暂停 ]` and `[ 🏁 收口 ]` with event isolation | M2 | Survey / R4 |
| 6 | Global ⌘K / / / Esc Keyboard Penetration | Global shortcut capture and smooth fluid expansion/collapse | M2 | Survey / R4 |
| 7 | Morphing Floating Hub Theming & Tab Sync | 100% color-synced borders, aura glow, default active tab selection | M3 | Survey / R3 |
| 8 | Global TopBar & AppShell Plumbing | Forward `pathname` and global state props to Dynamic Island | M3 | Survey / R1 |
| 9 | 5-Tier Unit & Integration Test Suite | Comprehensive unit/integration coverage for Tiers 1-4 + Tier 5 | M4 | Survey / Acceptance |
| 10 | Playwright 1080p Visual Verification Suite | Automated screenshot capture for all 14 visual scenarios | M4 | Survey / Acceptance |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | State Engine, Anti-Redundancy & Dynamic Aura Tokens | Route context suppression predicates, state pool collector, dynamic aura theme definitions, state engine unit tests | None | DONE |
| M2 | Dual-Task Bubble, Hover Micro-Actions & Keyboard Penetration | Exclamation satellite bubble split, 60fps fluid swap morph, stopwatch hover micro-action pills, global ⌘K/Esc handlers | M1 | DONE |
| M3 | Dynamic Aura Morphing Hub & Shell Plumbing | Color-synced Morphing Floating Hub, default tab activation, GlobalTopBar/AppShell route forwarding | M2 | DONE |
| M4 | 100% Test Pass, Tier 5 Adversarial Hardening & Playwright Visuals | Full 5-tier test execution, Tier 5 stress suite, Playwright 1080p screenshot suite | M3, TEST_READY | DONE |

## Code Layout
- `apps/web/components/dynamic-island-types.ts` — Shared state types, priority weights, aura tokens, and view models.
- `apps/web/components/dynamic-island-state-engine.ts` — Multi-state collector, route suppression predicates, priority resolver.
- `apps/web/components/dynamic-island-state-engine.test.ts` — Unit tests for priority, route suppression, and multi-state dual selection.
- `apps/web/components/dynamic-island-glow.ts` — Dynamic Aura theme definitions and glow style calculation.
- `apps/web/components/dynamic-island-segments.tsx` — Main capsule, satellite bubble, and hover micro-action components.
- `apps/web/components/dynamic-island-ticker.ts` — Smart Ticker hook (auto-rotation, pause on hover/focus).
- `apps/web/components/dynamic-island-hub.tsx` — Morphing Floating Hub 60fps console with dynamic aura and default tab sync.
- `apps/web/components/dynamic-island-hub.test.ts` — Unit tests for hub dynamic aura, panels, and tab switching.
- `apps/web/components/dynamic-island.tsx` — Dynamic Island Ultra orchestrator, keyboard handlers, and dual-task morphing shell.
- `apps/web/components/global-topbar.tsx` — Forward `pathname` to Dynamic Island.
- `apps/web/components/app-shell.tsx` — Forward `pathname` to GlobalTopBar.
- `apps/web/components/dynamic-island-capsules.test.ts` — Integration tests for dual-task bubble, hover actions, and keyboard shortcuts.
- `apps/web/components/dynamic-island-m4-adversarial.test.ts` — Tier 5 Adversarial stress test suite.
- `scripts/ops/capture-capsule-island-screenshots.ts` — Playwright visual screenshot automation.
- `TEST_READY.md` — E2E test suite publish signal & coverage summary.
