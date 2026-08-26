# Project: AreaForge High-Density Ergonomics (IDE-Grade / Bloomberg-Style) Overhaul

## Architecture
- **Design Philosophy**: High-Density Ergonomics, IDE-Grade & Bloomberg-Style data visualization, dark glassmorphism (`bg-[#0e1619]/90 border border-white/10`).
- **Layout Contraction**: Global reduction of excessive padding (`p-6`/`p-8` down to `p-3.5`~`p-4.5`), compact headers, tight vertical gaps (`space-y-3.5`~`space-y-4`).
- **Micro-Visualizations**: Pure React SVG-based micro-charts (Heatbars, Proportion Bars, Sparklines, Radars, Mini-Bars) with zero heavy external charting dependencies.
- **Data Engine**: Reuses existing Prisma & Core schemas (`StudySession`, `ReviewSchedule`, `ReviewEvent`, `KnowledgePoint`, `SimulationExam`, `StagePlan`, `SyllabusNode`) to aggregate rich statistics without schema migrations.
- **Verification Matrix**: 100% unit tests pass (`pnpm --filter @areaforge/web test`), 0 type errors (`pnpm typecheck`), all 22 quality gates (`pnpm check`), and Playwright multi-viewport screenshots (1080p, 900p, 768p).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Global Compact Shell & Spacing | Reduce padding in `app-shell.tsx`, `page-frame.tsx`, `page-header.tsx`, `card.tsx` to `p-3.5`~`p-4.5` and `gap-3.5`~`gap-4` | M1 | DONE |
| 2 | Micro-Visualization Primitives | Build `HourlyHeatbar`, `SubjectProportionBar`, `CompactBadge`, `StatusDot`, `MiniSparkline`, `MiniRadar` components | M1 | DONE |
| 3 | `/today` Micro-Metrics & Hourly Heatbar | Embed 24h hourly study distribution heatbar and subject time allocation proportion bar in Today summary | M2 | DONE |
| 4 | `/today` Queue Card & Timer Ergonomics | Enrich action cards with priority badges, overdue warnings, syllabus breadcrumbs, quick start CTAs, and 7d inline sparkbars | M2 | DONE |
| 5 | `/knowledge` Retention & Mastery Deck | Add Ebbinghaus curve distribution bar, subject mastery distribution & mini-radar, Top 5 weak points ranking | M3 | DONE |
| 6 | `/knowledge` Flashcard & Mistake Micro-Badges | Add attempt count, accuracy %, avg latency, importance stars, and days-since-review micro-badges on cards | M3 | DONE |
| 7 | `/test` Full-Function Command Dashboard | Replace empty cards with score trendline SVG sparkline, weak module loss ranking, pending test queue, instant retest | M4 | DONE |
| 8 | `/roadmap` Gantt Timeline & Coverage Matrix | Add Gantt-style stage timeline, syllabus total coverage & mastery bar, subject budget vs actual conversion table | M5 | DONE |
| 9 | `/settings` IDE-Grade Parameters & Storage Sync | Add workspace capacity metrics, IndexedDB offline sync status indicator, compact settings grid | M5 | DONE |
| 10 | Multi-Viewport Visual Screenshots & Test Suite | 100% test pass (`pnpm test`), 0 type errors (`pnpm typecheck`), and Playwright multi-viewport screenshots (1080p, 900p, 768p) | M6 | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Global Shell & Micro-UI Primitives | `app-shell.tsx`, `page-frame.tsx`, `page-header.tsx`, `card.tsx`, micro-visualizations | none | DONE |
| M2 | `/today` Action Center Overhaul | `/today` dashboard, queue cards, recommendation card, subject timer list | M1 | DONE |
| M3 | `/knowledge` Analytics & Cards Overhaul | `/knowledge` overview, Ebbinghaus curve, mastery radar, flashcards & mistake books | M1 | DONE |
| M4 | `/test` Exam Command Deck Overhaul | `/test` overview, score trend sparkline, weak module loss ranking, pending queue | M1 | DONE |
| M5 | `/roadmap` & `/settings` Overhaul | `/roadmap` Gantt timeline & coverage, `/settings` workspace metrics & sync status | M1 | DONE |
| M6 | Test Suite & Multi-Viewport Verification | Full unit tests, typecheck, Playwright multi-viewport screenshots | M2, M3, M4, M5 | DONE |

## Code Layout
- `apps/web/components/layout/app-shell.tsx` — Global root shell padding and sidebar compaction
- `apps/web/components/ui/page-frame.tsx` — Page container padding and vertical rhythm
- `apps/web/components/ui/page-header.tsx` — Header padding and compact actions
- `packages/ui/src/card.tsx` & `apps/web/components/ui/card.tsx` — Compact card padding tokens
- `packages/ui/src/micro-charts.tsx` & `apps/web/components/ui/micro-charts.tsx` — Micro-visualization primitives (Heatbars, Radars, Sparklines, Proportion bars)
- `apps/web/app/today/**` — Today Action Center high-density views
- `apps/web/app/knowledge/**` — Knowledge Center overview, flashcards, mistake books
- `apps/web/app/test/**` — Exam / Test Center command deck
- `apps/web/app/roadmap/**` — Roadmap Center Gantt timeline and coverage matrix
- `apps/web/app/settings/**` — Settings Center parameters and workspace capacity panel
- `apps/web/e2e/**` & `.agents/worker_m6/screenshots/` — Playwright multi-viewport screenshots (1080p, 900p, 768p)
