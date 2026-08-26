# Project: AreaForge UI Style & Ergonomic Infrastructure Unification

## Architecture
AreaForge UI architecture unification based on the `/focus` workstation visual and ergonomic standard (`rounded-2xl` master cards with dark glass `bg-[#0e1619]/90 border-white/10 shadow-lg`, `rounded-xl` form controls & buttons, glowing teal primary accents, segmented selectors with active teal flares, universal `PinnedActionBar`, and refined App Shell components).

The architecture is layered as follows:
1. **Design Tokens Layer (`packages/ui` & `globals.css`)**: Centralized radii (`--af-radius-card: 16px`, `--af-radius-control: 12px`), surface colors (`--af-canvas: #080b0f`, `--af-surface-card: #0e1619`), borders, teal accent glow shadows, and ergonomic control heights (`h-10` / `h-11`).
2. **Core UI Primitives Layer (`components/ui` & `@areaforge/ui`)**: Canonical `Surface`, `Card`, `Button`, `IconButton`, `ButtonLink`, `Field` (`Input`, `Textarea`, `Select`, `Radio`, `Checkbox`), `SegmentedControl`, `SegmentedField`, and `PinnedActionBar`.
3. **App Shell Layer (`components/shell`, `global-top-bar`, `dynamic-island`, `primary-navigation`, `shared-study-toolbar`)**: Unified navigation highlights, 60fps dynamic island expansion, zero-scroll layout constraints, and footer synchronization indicators.
4. **Consumer Workstations & Pages (`/focus`, `/today`, `/knowledge`, `/test`, `/roadmap`, `/settings`)**: Migration from ad-hoc inline classes and raw HTML tags to canonical `@areaforge/ui` primitives.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Tokens & CSS Variables | Standardize canvas, surface, master card `#0e1619`/90, radii (16px card / 12px control), shadows, and heights in `packages/ui` & `globals.css` | M1 | ORIGINAL_REQUEST §R1 |
| F2 | Base Surface & Card Primitives | Implement standard `Surface` / `Card` with master card (`bg-[#0e1619]/90 border border-white/10 shadow-lg rounded-2xl`) and subtle card (`bg-white/[0.02] border border-white/5 rounded-xl`) | M1 | ORIGINAL_REQUEST §R1 |
| F3 | Form Input Controls | Standardize `Input`, `Textarea`, `Select`, `Radio`, `Checkbox` in `components/ui/field.tsx` with `rounded-xl`, `border-white/10`, `bg-white/5`, `focus:border-teal-400 focus:outline-none` | M2 | ORIGINAL_REQUEST §R2 |
| F4 | Segmented Control & SegmentedField | Standardize tablist `SegmentedControl` and form `SegmentedField` with active teal flare (`border-teal-400/80 bg-teal-500/20 text-teal-100 shadow-[0_0_12px_rgba(45,212,191,0.2)]`) | M2 | ORIGINAL_REQUEST §R2 |
| F5 | Button System | Standardize `Button`, `IconButton`, `ButtonLink` with `rounded-xl`, primary teal background `bg-teal-400` + glow `shadow-[0_0_20px_rgba(45,212,191,0.35)] hover:shadow-[0_0_28px_rgba(45,212,191,0.5)]` + `active:scale-[0.98]` | M3 | ORIGINAL_REQUEST §R3 |
| F6 | Pinned Bottom Action Bar | Standardize `PinnedActionBar` layout container with sticky bottom docking, zero-scroll viewport alignment, and bottom-edge alignment | M3 | ORIGINAL_REQUEST §R3 |
| F7 | App Shell & Dynamic Focus Island | Refine Topbar Dynamic Island (60fps smooth expansion, stopwatch logic, badge alignment), Sidebar navigation highlights & dividers, and Footer status bar typography | M4 | ORIGINAL_REQUEST §R4 |
| F8 | Raw Primitive Debt & Workstation Migration | Migrate raw HTML `<button>`, `<input>`, and local clone primitives in `/focus`, `dynamic-island`, `window-dock` to canonical UI primitives, resolving all `web:ui-primitives-boundary` violations | M4 | Survey findings & R1-R4 |
| F9 | Multi-Viewport & Zero-Scroll Testing | Automated E2E and visual verification across 1080p, 900p, 768p viewports; ensure zero unwanted horizontal/vertical scrollbars and pixel alignment | M5 | Acceptance Criteria 2 & 3 |
| F10 | Full-Suite Regression & Quality Gates | Verify `pnpm typecheck` (0 errors), `pnpm --filter @areaforge/web test` (388/388 pass), `pnpm web:ui-primitives-boundary` (clean), and forensic integrity audit | M5 | Acceptance Criteria 3 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Tokens & Surface Containers | Update `packages/ui` exports and `apps/web/app/globals.css`; implement unified `Surface` and `Card` components | none | DONE |
| M2 | Form Inputs & Segmented Controls | Upgrade `field.tsx` (Input, Textarea, Select, Radio, Checkbox) and `segmented-control.tsx` (SegmentedControl, SegmentedField); export to `@areaforge/ui` | M1 | DONE |
| M3 | Button System & PinnedActionBar | Upgrade `button.tsx`, `icon-button.tsx`, implement canonical `pinned-action-bar.tsx` and `editor-actions.tsx` | M1 | DONE |
| M4 | App Shell & Workstation Migration | Refine Dynamic Island, Topbar, Sidebar, Footer Status Bar; migrate all raw primitives in `/focus`, `dynamic-island`, `window-dock` to canonical UI components | M2, M3 | DONE |
| M5 | E2E Testing & Quality Gate Verification | Execute comprehensive multi-viewport Playwright matrix (1080p, 900p, 768p), full test suite (388/388 pass), typecheck, primitive boundary check, and forensic audit | M4 | PLANNED |

---

## Interface Contracts

### 1. `packages/ui` & `globals.css` Token Contract
- `--af-canvas`: `#080b0f`
- `--af-surface-card`: `#0e1619` (90% opacity: `rgba(14, 22, 25, 0.90)`)
- `--af-surface-subtle`: `rgba(255, 255, 255, 0.02)`
- `--af-radius-card`: `1rem` (`16px`, `rounded-2xl`)
- `--af-radius-control`: `0.75rem` (`12px`, `rounded-xl`)
- `--af-shadow-teal-glow`: `0 0 20px rgba(45, 212, 191, 0.35)`
- `--af-shadow-teal-glow-hover`: `0 0 28px rgba(45, 212, 191, 0.50)`

### 2. `Card` & `Surface` Component Contract
- `Card`:
  - `variant="master"` (default): `rounded-2xl border border-white/10 bg-[#0e1619]/90 shadow-lg`
  - `variant="subtle"`: `rounded-xl border border-white/5 bg-white/[0.02]`
  - `variant="accent"`: `rounded-2xl border border-teal-500/20 bg-[#0e1619]/90 shadow-[0_0_16px_rgba(45,212,191,0.15)]`
- Props: `children`, `className`, `variant`, `padding` (`"none" | "sm" | "md" | "lg"`)

### 3. `Field` (`Input`, `Textarea`, `Select`, `Radio`, `Checkbox`) Contract
- `Input`, `Select`: `h-10` / `h-11`, `rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none transition-colors`
- `Textarea`: `rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white placeholder:text-zinc-600 focus:border-teal-400 focus:outline-none transition-colors`
- `SegmentedField`: `<SegmentedField name="..." label="..." value={val} onChange={setVal} options={[{ value, label, badge, hint }]} />` with active flare `border-teal-400/80 bg-teal-500/20 text-teal-100 shadow-[0_0_12px_rgba(45,212,191,0.2)]`.

### 4. `Button` & `PinnedActionBar` Contract
- `Button`:
  - `variant="primary"`: `h-10 sm:h-11 rounded-xl bg-teal-400 px-6 sm:px-8 text-sm font-semibold text-[#061012] shadow-[0_0_20px_rgba(45,212,191,0.35)] transition-all hover:bg-teal-300 hover:shadow-[0_0_28px_rgba(45,212,191,0.5)] active:scale-[0.98]`
  - `variant="secondary"`: `h-10 sm:h-11 rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-[0.98]`
  - `variant="ghost"`: `h-10 sm:h-11 rounded-xl bg-transparent px-4 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200 active:scale-[0.98]`
  - `variant="danger"`: `h-10 sm:h-11 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 text-sm font-medium text-rose-300 hover:bg-rose-500/20 active:scale-[0.98]`
- `PinnedActionBar`: `<PinnedActionBar left={...} right={...} status={...} className="..." />` with `sticky bottom-0 z-10 w-full border-t border-white/10 bg-[#080b0f]/90 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-4`.

---

## Code Layout
- `packages/ui/`:
  - `src/index.ts`: Public entrypoint exporting tokens, Card, Surface, Button, Field, SegmentedControl, PinnedActionBar
  - `src/tokens.ts`: Central design tokens definitions
  - `src/card.tsx`: Polymorphic Card primitive
  - `src/surface.tsx`: Polymorphic Surface primitive
  - `src/field.tsx`: Canonical Field primitives
  - `src/segmented-control.tsx`: Canonical SegmentedControl and SegmentedField
  - `src/button.tsx`: Canonical Button, IconButton, ButtonLink, ButtonSpinner
  - `src/pinned-action-bar.tsx`: Canonical PinnedActionBar and EditorActionBar
- `apps/web/app/globals.css`: Tailwind v4 theme & CSS custom properties
- `apps/web/components/ui/`:
  - `card.tsx`: Master & subtle card primitives
  - `surface.tsx`: Surface layout primitives
  - `button.tsx`: Unified button system
  - `icon-button.tsx`: Canonical icon button
  - `field.tsx`: Input, Textarea, Select, Radio, Checkbox, FormField
  - `segmented-control.tsx`: SegmentedControl (tablist) and SegmentedField (radio options)
  - `pinned-action-bar.tsx`: Sticky / docked bottom action bar
  - `editor-actions.tsx`: Re-exports / composes PinnedActionBar
- `apps/web/components/shell/` / `apps/web/components/`:
  - `app-shell.tsx`: Core layout shell
  - `global-top-bar.tsx`: Header bar
  - `dynamic-island.tsx`: Focus stopwatch island
  - `primary-navigation.tsx`: Primary navigation sidebar
  - `secondary-navigation.tsx`: Secondary navigation rail
  - `shared-study-toolbar.tsx`: Footer status bar
- `apps/web/components/focus-*.tsx`: Workstation panels migrated to canonical UI primitives
