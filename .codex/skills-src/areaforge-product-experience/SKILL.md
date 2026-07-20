---
name: areaforge-product-experience
description: "Use when Codex needs to audit, design, or improve AreaForge real user experience, product flows, learning loop clarity, dashboard information architecture, task/timer/review ergonomics, reports usefulness, recovery mode, update center usability, accessibility, empty states, copy, or visual polish. This skill owns product design judgment; executing browser/API smoke and collecting verification evidence belongs to areaforge-qa-smoke."
---

# AreaForge Product Experience

Judge the app by whether a tired student can understand the next action and trust the system.

## When To Use / Hand Off

- Use for: judging and improving product experience: journey clarity, information architecture, ergonomics, accessibility, copy, and visual polish.
- Not here: executing browser/API smoke and evidence capture -> `areaforge-qa-smoke`; syncing UX docs after behavior changes -> `areaforge-doc-sync`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/product/charter.md](../../../docs/product/charter.md) if present; otherwise [docs/product/feature-scope.md](../../../docs/product/feature-scope.md)
3. [docs/ux/dashboard-states.md](../../../docs/ux/dashboard-states.md)
4. [docs/modules/check-in.md](../../../docs/modules/check-in.md)
5. [docs/modules/task-debt.md](../../../docs/modules/task-debt.md)
6. [docs/modules/periodic-reports.md](../../../docs/modules/periodic-reports.md)
7. [docs/development/product-experience-review-record-template.md](../../../docs/development/product-experience-review-record-template.md)
8. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
9. [docs/development/long-term-operability-control-plane.md](../../../docs/development/long-term-operability-control-plane.md)

## References

- [references/experience-rubric.md](references/experience-rubric.md): product experience rubric and journey checklist.
- [../areaforge-qa-smoke/SKILL.md](../areaforge-qa-smoke/SKILL.md): verify UX changes in a browser.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): keep UX docs and current behavior aligned.

## Workflow

1. Pick the target persona and moment: first setup, morning planning, focus session, end-session closeout, evening review, weekly report, recovery, simulation, or update.
2. Trace the user journey before proposing UI changes.
3. Evaluate clarity, trust, friction, feedback, recovery, accessibility, and mobile fit.
4. Prefer improvements that make the next action obvious without adding explanatory walls of text.
5. Verify changes with the QA smoke skill and update UX/module docs when behavior changes.
6. For release/update handoff or claims that real experience is healthy, record desktop and mobile evidence with `docs/development/product-experience-review-record-template.md` and run `pnpm experience:review:validate <record>`.
7. Treat `health`, `readiness`, API smoke, and old screenshots as insufficient for `AF-RISK-UX-001`; desktop/mobile product experience evidence must be fresh.

## Guardrails

- Do not create a marketing landing page when the user needs the actual app workflow.
- Do not hide full task lists in recovery or theme states; focus can be emphasized but not destructive.
- Do not make AI or reports appear authoritative when they are suggestions requiring confirmation.
- Do not add visible instructional clutter when better controls, labels, or state affordances solve the issue.
- Do not declare UX improved without checking at least the affected page state.
- Do not close `AF-RISK-UX-001` from `pnpm check`, API smoke, or old screenshots alone.
