---
name: areaforge-qa-smoke
description: "Use for executing AreaForge user-journey evidence: Playwright/API smoke, screenshots, authenticated paths, desktop/mobile viewports, local test-pool URLs, and production read-only smoke. Product judgment belongs to areaforge-product-experience; command selection belongs to areaforge-validation-driver."
---

# AreaForge QA Smoke

Validate the product as a student would use it, then attach enough evidence for engineering confidence.

## When To Use / Hand Off

- Use for: executing smoke checks and collecting evidence: user journeys, browser/API smoke, screenshots, viewports, production read-only smoke.
- Not here: product design judgment, information architecture, and UX critique -> `areaforge-product-experience`; command gate selection -> `areaforge-validation-driver`; post-release health evidence -> `areaforge-release-operator`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
3. [docs/ux/dashboard-states.md](../../../docs/ux/dashboard-states.md)
4. [docs/product/feature-scope.md](../../../docs/product/feature-scope.md)
5. [docs/development/production-smoke-alerting-strategy.md](../../../docs/development/production-smoke-alerting-strategy.md)
6. [apps/web/README.md](../../../apps/web/README.md)
7. [docs/development/product-experience-review-record-template.md](../../../docs/development/product-experience-review-record-template.md)

Read the minimum sources relevant to the journey under test. Always read this skill; load production, release, or product-experience references only when the requested evidence needs them.

## References

- [references/smoke-matrix.md](references/smoke-matrix.md): user journeys, API smoke, browser checks, and evidence format.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose command gates before UI smoke.
- [../areaforge-product-experience/SKILL.md](../areaforge-product-experience/SKILL.md): product polish and user journey critique.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): post-release smoke and online health evidence.

## Workflow

1. Map the change to one or more user journeys before opening a browser.
2. Run the smallest sufficient command checks first; do not use a browser to hide type, lint, build, or DB failures.
3. Start a local server only when needed; use the existing server if the user already has one running. For the local production-build test pool, run `pnpm dev:test:latest -- --json` and use its URL instead of assuming slot 1. If the task deploys a candidate, run `refresh` or `snapshot` first and query latest again only after it succeeds. A pre-existing instance may support evidence only when its source fingerprint matches the requested scope; it remains labeled pre-existing, not task-owned latest. Do not create one Web container per journey, page, screenshot, or conversation. If an external browser runner creates a one-shot `areaforge-v11browser-runtime-*`, remove it after the evidence run and never treat it as a pool slot.
4. Verify critical paths with authenticated and unauthenticated states when the route has auth.
5. Capture evidence: URL, viewport, account mode, action path, expected result, actual result, screenshot path when useful, and any residual risk. For local test-pool evidence, also capture latest slot, port, source fingerprint, and whether this task actually updated the pool.
6. For production smoke, use `https://forge.areasong.top/`, run `pnpm smoke:prod-readonly:config` before authenticated read-only smoke, and avoid destructive writes unless the user explicitly confirms a safe smoke dataset.
7. For a formal desktop/mobile release or update handoff, `AF-RISK-UX-001` closure, or an explicitly requested experience closeout, keep a redacted review record and run `pnpm experience:review:validate <record>`. Routine UI smoke records use the evidence fields above and do not require a new report file.

## Guardrails

- Do not declare "体验没问题" without checking the actual page or API path.
- Do not run destructive production flows as smoke.
- Do not rely on one desktop viewport for UI changes; include at least one narrow viewport when layout changed.
- Do not use mock AI/provider success as proof of production AI behavior.
- Do not expose admin credentials, session cookies, attachment paths, API keys, or database URLs in smoke records.
- Do not use a successful smoke command as full UX evidence unless viewport, screenshot/browser observation, and `AF-RISK-UX-001` close conditions are recorded.
