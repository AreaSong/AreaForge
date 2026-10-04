# Smoke Matrix

## Core User Journeys

- Login and session recovery.
- Dashboard: today stats, check-in, active recovery, state theme, update badge.
- Task: create, update, complete, defer, drop, recover, split, convert-review.
- Timer: start, active, pause/resume, end closeout, anti-fake learning fields.
- Review: save daily review and verify reports/dashboard refresh.
- Notes: create note, upload allowed attachment, authenticated download.
- Syllabus: import/maintain nodes, mastery conditions, evidence, retest.
- Analytics/reports: dashboard summaries, report decisions, read-only replay.
- Simulation: create exam, save subject result, stage plan/draft, AI draft fallback.
- Settings/update center: status display, request write, no server command execution.

## Evidence Format

```text
scope:
environment: local | production
url:
test pool updated: yes | no | not-applicable
latest slot/port/source fingerprint:
account:
viewport:
steps:
expected:
actual:
screenshot:
commands:
residual risk:
```

For a formal product-experience release/update closeout, `AF-RISK-UX-001` closure, or an explicitly requested closeout, include desktop and mobile/narrow observations in `docs/development/product-experience-review-record-template.md` and validate the redacted record with `pnpm experience:review:validate <record>`. Routine smoke evidence does not require a separate report file.

## Production Limits

- Prefer read-only checks in production.
- Use a dedicated smoke note/task only when the user authorizes writes through `docs/development/production-smoke-alerting-strategy.md`.
- Do not upload private real files; use a tiny synthetic file.
- Do not call real AI with sensitive context.
- For production read-only smoke records, use `docs/development/production-readonly-smoke-record-template.md` and validate the redacted record with `pnpm smoke:prod-readonly:validate <record>`.
