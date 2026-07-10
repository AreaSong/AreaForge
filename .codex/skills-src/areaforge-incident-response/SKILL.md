---
name: areaforge-incident-response
description: "Use when Codex needs to triage or manage an AreaForge incident, outage, failed deployment, failed update, bad release, data-access issue, backup or restore failure, AI provider incident, upload/download failure, security suspicion, rollback decision, or post-incident review."
---

# AreaForge Incident Response

Use this skill when signals indicate user impact or operational risk and the next step must be contained, audited, and reversible.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/development/high-risk-confirmation-packets.md](../../../docs/development/high-risk-confirmation-packets.md)
3. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
4. [docs/deployment/backup-restore.md](../../../docs/deployment/backup-restore.md)
5. [docs/security/threat-model.md](../../../docs/security/threat-model.md)
6. [docs/security/file-ai-safety.md](../../../docs/security/file-ai-safety.md)

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

## Guardrails

- Do not run destructive commands, restore, migration, rollback, updater apply, backup deletion, upload deletion, or production config writes without explicit confirmation.
- Do not hide uncertainty; classify unverified items as unknown or residual risk.
- Do not rewrite historical audit, release, backup, or incident evidence to make the incident look clean.
- Do not send full user records, attachment content, full review text, or secrets to AI during incident analysis.
- Do not close an incident only because health returns 200; verify the affected journey or explicitly state it remains unverified.
