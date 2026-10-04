---
name: areaforge-sre-ops
description: "Use for confirmed AreaForge live-system changes and recovery: Docker Compose, Nginx, PostgreSQL, backup/restore, updater apply, rollback, capacity controls, and operational runbooks. Hand read-only signals to areaforge-observability and incident severity/containment to areaforge-incident-response."
---

# AreaForge SRE Ops

Treat production as a managed system with health, backup, restore, update, rollback, and incident evidence.

## When To Use / Hand Off

- Use for: planning or executing confirmed production changes and recovery: backup, restore, updater apply, rollback, Nginx, containers, and PostgreSQL. Read-only health/status evidence belongs to `areaforge-observability`.
- Not here: read-only signal inventory and status evidence -> `areaforge-observability`; incident severity and containment orchestration -> `areaforge-incident-response`; release identity and update evidence -> `areaforge-release-operator`; artifact trust -> `areaforge-supply-chain`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/architecture/deployment.md](../../../docs/architecture/deployment.md)
3. [docs/deployment/operator-onboarding.md](../../../docs/deployment/operator-onboarding.md)
4. [docs/deployment/docker-compose.md](../../../docs/deployment/docker-compose.md)
5. [docs/deployment/backup-restore.md](../../../docs/deployment/backup-restore.md)
6. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
7. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
8. [docs/development/production-smoke-alerting-strategy.md](../../../docs/development/production-smoke-alerting-strategy.md)
9. [docs/development/long-term-operability-control-plane.md](../../../docs/development/long-term-operability-control-plane.md)
10. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)
11. [docs/development/support-bundle-preview.md](../../../docs/development/support-bundle-preview.md)
12. [docs/development/maintenance-cadence.md](../../../docs/development/maintenance-cadence.md)
13. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)
14. [docs/development/restore-drill-record-template.md](../../../docs/development/restore-drill-record-template.md)
15. [docs/development/update-agent-status-record-template.md](../../../docs/development/update-agent-status-record-template.md)

Read the minimum sources relevant to the operation. Always read this skill; load backup, release, incident, security, or live-production references only when the requested action needs them.

## References

- [references/ops-runbook.md](references/ops-runbook.md): health, backup, restore, updater, rollback, and incident checks.
- [../areaforge-observability/SKILL.md](../areaforge-observability/SKILL.md): read-only signals, status evidence, and monitoring gaps.
- [../areaforge-incident-response/SKILL.md](../areaforge-incident-response/SKILL.md): severity, containment, rollback decision, and closeout.
- [../areaforge-release-operator/SKILL.md](../areaforge-release-operator/SKILL.md): release and updater evidence.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): production secrets, command, and exposure boundaries.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose local checks after ops changes.

## Workflow

1. Classify the request: observe, diagnose, plan, change config, apply update, rollback, restore, or incident response.
2. For observe/diagnose, prefer read-only checks and hand detailed signal inventory to the observability skill.
3. For write actions, require explicit confirmation and a rollback plan before changing production, update policy, database, upload directory, or Nginx. Read-only health/status checks do not require that write confirmation and should be handed to Observability.
4. Preserve evidence: command, host, timestamp, version, image digest, backup path/hash, status, residual risk.
5. Keep ownership explicit: SRE Ops may execute only confirmed production operations; Observability supplies read-only signals; Release Operator owns release identity and auto-apply policy evidence; Supply Chain owns artifact trust. Reuse a confirmation across this handoff only when it explicitly covers the same execution action, target, scope, and still-valid evidence; policy-only approval never authorizes updater apply.
6. After release/update/rollback, sync docs and tasks through the doc sync skill and record residual items through the residual ledger when they remain.

## Guardrails

- Do not execute production deploy, backup, restore, migration, updater apply, or rollback without explicit user confirmation.
- Do not expose secrets, `.env`, database URLs, API keys, session secrets, or smoke credentials.
- Do not mount Docker socket or server secrets into Web runtime.
- Do not treat `AREAFORGE_AUTO_APPLY=patch` as safe unless signing, backups, manifest policy, and rollback evidence are confirmed.
- Do not delete backups or upload files from routine checks.
