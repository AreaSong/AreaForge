---
name: areaforge-incident-response
description: "Use when Codex needs to triage or manage an AreaForge incident, outage, failed deployment, failed update, bad release, data-access issue, backup or restore failure, AI provider incident, upload/download failure, security suspicion, rollback decision, or post-incident review. This skill owns incident orchestration from severity to closeout; hand read-only signals to areaforge-observability and confirmed production execution to areaforge-sre-ops."
---

# AreaForge Incident Response

Use this skill when signals indicate user impact or operational risk and the next step must be contained, audited, and reversible.

## When To Use / Hand Off

- Use for: orchestrating an incident end-to-end: severity, evidence freeze, containment, rollback decision, recovery verification, and post-incident review.
- Not here: read-only signal gathering -> `areaforge-observability`; confirmed production execution -> `areaforge-sre-ops`; security or privacy incident boundaries -> `areaforge-security-governance`; follow-up risk tracking -> `areaforge-residual-ledger`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/development/long-term-operability-control-plane.md](../../../docs/development/long-term-operability-control-plane.md)
3. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)
4. [docs/development/maintenance-cadence.md](../../../docs/development/maintenance-cadence.md)
5. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
6. [docs/development/incident-record-template.md](../../../docs/development/incident-record-template.md)
7. [docs/development/high-risk-confirmation-packets.md](../../../docs/development/high-risk-confirmation-packets.md)
8. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
9. [docs/deployment/backup-restore.md](../../../docs/deployment/backup-restore.md)
10. [docs/security/threat-model.md](../../../docs/security/threat-model.md)
11. [docs/security/file-ai-safety.md](../../../docs/security/file-ai-safety.md)

## References

- [references/incident-runbook.md](references/incident-runbook.md): severity, triage, containment, rollback, communication, and closeout.
- [../areaforge-observability/SKILL.md](../areaforge-observability/SKILL.md): gather read-only signals before and after action.
- [../areaforge-sre-ops/SKILL.md](../areaforge-sre-ops/SKILL.md): production backup, restore, updater, and rollback operations.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): security or privacy incident boundaries.
- [../areaforge-residual-ledger/SKILL.md](../areaforge-residual-ledger/SKILL.md): track follow-up risk and closure evidence.

## Workflow

1. Declare severity and scope: user-visible outage, degraded feature, data risk, security suspicion, release/update failure, or unknown.
2. Freeze evidence before changing state: timestamp, version, digest, endpoint, logs, screenshots, failing action, backup status, and current updater state.
3. Choose containment before repair: disable risky feature, pause auto-apply, fall back to local rules, stop further writes, or prepare rollback.
4. For any write action, provide impact, rollback plan, validation, and explicit confirmation request before executing.
5. After containment or rollback, verify health, authenticated smoke, data accessibility, upload access, AI fallback/provider behavior, and update-agent status.
6. Close only after recording root cause or accepted unknown, user impact, actions taken, validation evidence, residual risk, and follow-up owner.
7. If rollback was executed, save a redacted proof from `docs/development/rollback-proof-record-template.md` and run `pnpm rollback:proof:validate <record>`; `ready-for-human-review` does not reopen the update channel or close residuals.
8. If a redacted incident record is added, validate it with `pnpm incident:record:validate <record>`.
9. Place every validated record at `docs/development/incident-*/incident-record.txt`, rebuild `pnpm incident:index`, and validate `docs/development/incident-index.json`. The index projects `open/mitigated/follow-up` into `active` and only `resolved + postIncidentReview=yes` into `resolved`; it is not a live incident controller, production-health proof, or residual closure.

## Guardrails

- Do not run destructive commands, restore, migration, rollback, updater apply, backup deletion, upload deletion, or production config writes without explicit confirmation.
- Do not hide uncertainty; classify unverified items as unknown or residual risk.
- Do not rewrite historical audit, release, backup, or incident evidence to make the incident look clean.
- Do not send full user records, attachment content, full review text, or secrets to AI during incident analysis.
- Do not close an incident only because health returns 200; verify the affected journey or explicitly state it remains unverified.
