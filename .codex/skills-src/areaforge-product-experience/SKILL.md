---
name: areaforge-product-experience
description: "Use when Codex needs to audit, design, or improve AreaForge real user experience, product flows, learning loop clarity, dashboard information architecture, task/timer/review ergonomics, reports usefulness, recovery mode, update center usability, accessibility, empty states, copy, or visual polish."
---

# AreaForge Product Experience

Judge the app by whether a tired student can understand the next action and trust the system.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/product/charter.md](../../../docs/product/charter.md) if present; otherwise [docs/product/feature-scope.md](../../../docs/product/feature-scope.md)
3. [docs/ux/dashboard-states.md](../../../docs/ux/dashboard-states.md)
4. [docs/modules/check-in.md](../../../docs/modules/check-in.md)
5. [docs/modules/task-debt.md](../../../docs/modules/task-debt.md)
6. [docs/modules/periodic-reports.md](../../../docs/modules/periodic-reports.md)

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

## Guardrails

- Do not create a marketing landing page when the user needs the actual app workflow.
- Do not hide full task lists in recovery or theme states; focus can be emphasized but not destructive.
- Do not make AI or reports appear authoritative when they are suggestions requiring confirmation.
- Do not add visible instructional clutter when better controls, labels, or state affordances solve the issue.
- Do not declare UX improved without checking at least the affected page state.
