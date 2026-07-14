---
name: areaforge-qa-smoke
description: "Use when Codex needs to verify AreaForge real product experience, end-to-end smoke paths, Playwright/browser screenshots, API smoke, production smoke, release smoke, or whether the app feels usable after a feature. Trigger for login, dashboard, task, timer, review, notes, syllabus, analytics, reports, simulation, update center, mobile/desktop viewport, or real experience checks."
---

# AreaForge QA Smoke

Validate the product as a student would use it, then attach enough evidence for engineering confidence.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
3. [docs/ux/dashboard-states.md](../../../docs/ux/dashboard-states.md)
4. [docs/product/feature-scope.md](../../../docs/product/feature-scope.md)
5. [docs/development/production-smoke-alerting-strategy.md](../../../docs/development/production-smoke-alerting-strategy.md)
6. [apps/web/README.md](../../../apps/web/README.md)
7. [docs/development/product-experience-review-record-template.md](../../../docs/development/product-experience-review-record-template.md)

## References

- [references/smoke-matrix.md](references/smoke-matrix.md): user journeys, API smoke, browser checks, and evidence format.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose command gates before UI smoke.
- [../areaforge-product-experience/SKILL.md](../areaforge-product-experience/SKILL.md): product polish and user journey critique.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): post-release smoke and online health evidence.

## Workflow

1. Map the change to one or more user journeys before opening a browser.
2. Run the smallest sufficient command checks first; do not use a browser to hide type, lint, build, or DB failures.
3. Start a local server only when needed; use the existing server if the user already has one running.
4. Verify critical paths with authenticated and unauthenticated states when the route has auth.
5. Capture evidence: URL, viewport, account mode, action path, expected result, actual result, screenshot path when useful, and any residual risk.
6. For production smoke, use `https://forge.areasong.top/`, run `pnpm smoke:prod-readonly:config` before authenticated read-only smoke, and avoid destructive writes unless the user explicitly confirms a safe smoke dataset.
7. For desktop/mobile experience closeout, keep a redacted review record and run `pnpm experience:review:validate <record>`.

## Guardrails

- Do not declare "体验没问题" without checking the actual page or API path.
- Do not run destructive production flows as smoke.
- Do not rely on one desktop viewport for UI changes; include at least one narrow viewport when layout changed.
- Do not use mock AI/provider success as proof of production AI behavior.
- Do not expose admin credentials, session cookies, attachment paths, API keys, or database URLs in smoke records.
- Do not use a successful smoke command as full UX evidence unless viewport, screenshot/browser observation, and `AF-RISK-UX-001` close conditions are recorded.
