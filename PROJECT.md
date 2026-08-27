# Project: AreaForge Dynamic Island Status Capsule Engine & Banner Purification

## Architecture
- **Global Supervision Nervous System**: `DynamicIsland` & `GlobalTopBar` (`apps/web/components/`)
  - Polymorphic Status Capsule Engine acting as a unified cross-page status indicator with strict priority evaluation:
    `Live Session (P0) > Closing Session (P1) > Activity Paused (P2) > Recovery Mode (P3) > Evening Review Due (P4) > Offline Sync (P5) > Clean Idle (P6)`.
- **In-Page Banner Purification**:
  - Elimination of all full-width static banners (`TodayStatusBar` in `/today`, redundant warning cards in `/knowledge`, `/roadmap/stages`, `/settings/exams`).
  - Zero layout shift, 100% vertical space release for 1080p / 900p / 768p viewports.
- **Strict Alert Layering**:
  - Tier 1 (Global Supervision): 100% Top-Fixed Dynamic Island.
  - Tier 2 (Scoped Micro-Feedback): Co-located form validation & inline error alerts.
  - Tier 3 (Conflict/Confirmation): Dedicated modals.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Polymorphic Capsule Data Model & Priority Resolver | TypeScript discriminated union and priority evaluation for 6 discrete island states (`live_session_running`, `live_session_closing`, `activity_paused`, `recovery_active`, `evening_review_due`, `sync_issue`, `idle`) | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Dynamic Island & GlobalTopBar Capsule Rendering | Glowing micro-capsules (Amber for Recovery, Emerald/Amber for Paused with 1-click resume, Twilight Indigo for Evening Review, Teal for Live Session, Discrete for Sync) and expanded Hero drawers | M1 | ORIGINAL_REQUEST §R1 |
| F3 | One-Click Resume & Quick Workflow Hooks | Direct resume action from paused capsule in Dynamic Island without route navigation; direct recovery & evening review modal triggers | M1 | ORIGINAL_REQUEST §R1 |
| F4 | `/today` Action Center Banner Elimination | Complete removal of `TodayStatusBar` from `/today`; upward shift of `TodayRecommendation` & `TodayLearningSummary` | M2 | ORIGINAL_REQUEST §R2 |
| F5 | `/knowledge`, `/roadmap`, `/settings` Banner Purification | Removal of static alert banners and redundant cards across knowledge, roadmap stages, settings exams | M2 | ORIGINAL_REQUEST §R2 |
| F6 | Focus Workspace & Clean Alert Layering | Retaining inline form feedback in `/focus` while keeping main cockpit clean and linked with Dynamic Island | M3 | ORIGINAL_REQUEST §R3 |
| F7 | Unit & Adversarial Test Suite Expansion | Adding `dynamic-island-capsules.test.ts`, updating `m1-challenger2-deep-adversarial.test.ts`, and verifying all 607 web tests | M4 | ORIGINAL_REQUEST §Acceptance Criteria |
| F8 | Playwright Multi-Viewport Visual Verification | Capturing and verifying 1080p, 900p, 768p screenshots for all capsule states and cleaned pages | M4 | ORIGINAL_REQUEST §Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Dynamic Island Status Capsule Engine | Implement polymorphic state resolver, 5 capsule styles (Recovery, Paused + 1-click resume, Evening Review, Live Session, Sync), and hook integration in `DynamicIsland` & `GlobalTopBar` | none | DONE |
| M2 | Core Page Banner Elimination & Layout Uplift | Purge `TodayStatusBar` from `/today`, remove redundant static alert bars from `/knowledge`, `/roadmap/stages`, `/settings/exams` | M1 | DONE |
| M3 | Alert Layering & Inline Micro-Feedback | Ensure clean boundary between global status in Dynamic Island and local inline error feedback across forms | M2 | DONE |
| M4 | Test Suite & Playwright Visual Verification | Unit tests for capsule engine, update adversarial tests, run `typecheck` + `test`, and capture Playwright multi-viewport visual screenshots | M3 | DONE |

## Interface Contracts
### `DynamicIsland` ↔ `GlobalTopBar` ↔ `AppShell`
```typescript
export type IslandStatusKind =
  | "live_session_running"
  | "live_session_closing"
  | "activity_paused"
  | "recovery_active"
  | "evening_review_due"
  | "sync_issue"
  | "idle";

export interface DynamicIslandProps {
  userId: string;
  activeSession: StudySessionDto | null;
  offlineSession: StudySessionDto | null;
  quickReviewClaim: QuickReviewActivityClaim | null;
  syncState?: FocusOfflineSyncState;
  onRetrySync?: () => void;
  onOpenAction: (action: GlobalCommandAction) => void;
  compactOnNarrow?: boolean;
  commands?: readonly GlobalCommandDefinition[];
  recovery?: {
    active: boolean;
    stage: number;
    targetMinutes: number;
    reason?: string;
    onOpen?: () => void;
  } | null;
  eveningReview?: {
    due: boolean;
    minimumActionDone: boolean;
    dailyReviewDone: boolean;
    onOpen?: () => void;
  } | null;
  onResumeSession?: (sessionId: string) => Promise<void>;
}
```

## Code Layout
- `apps/web/components/dynamic-island.tsx`: Dynamic Island component container with search input, command palette, and drawer triggers (408 lines).
- `apps/web/components/dynamic-island-segments.tsx`: Polymorphic capsule left & right segments with glow tokens and 1-click resume (275 lines).
- `apps/web/components/dynamic-island-drawer.tsx`: Hero pull-down drawers with state-specific controls and command palette list (259 lines).
- `apps/web/components/global-top-bar.tsx`: Top bar layout linking app shell status to dynamic island.
- `apps/web/components/app-shell.tsx`: Root shell passing recovery, evening review, and active/paused session status to top bar.
- `apps/web/components/action-center-today-view.tsx`: `/today` view with `TodayStatusBar` completely removed.
- `apps/web/lib/routes/knowledge-overview-page.tsx`: `/knowledge` overview with bottom weak point banner removed.
- `apps/web/lib/routes/plan-stages-page.tsx`: `/roadmap/stages` with static suggestion alert removed.
- `apps/web/components/workspace-settings-client.tsx`: `/settings/exams` with static note box removed.
- `apps/web/components/dynamic-island-capsules.test.ts`: 12 unit tests for capsule engine state resolution.
- `apps/web/components/m1-challenger2-deep-adversarial.test.ts`: Adversarial test for banner elimination.
- `scripts/ops/capture-capsule-island-screenshots.ts`: Playwright visual screenshot script.
