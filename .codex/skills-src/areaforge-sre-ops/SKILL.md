---
name: areaforge-sre-ops
description: "Use when Codex needs to inspect, plan, or improve AreaForge production operations: health checks, logs, Nginx, Docker Compose, PostgreSQL, backups, restore drills, GitHub Release updater, update-agent, auto-apply policy, rollback, disk/cert capacity, incident triage, or operational readiness."
---

# AreaForge SRE Ops

Treat production as a managed system with health, backup, restore, update, rollback, and incident evidence.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/architecture/deployment.md](../../../docs/architecture/deployment.md)
3. [docs/deployment/operator-onboarding.md](../../../docs/deployment/operator-onboarding.md)
4. [docs/deployment/docker-compose.md](../../../docs/deployment/docker-compose.md)
5. [docs/deployment/backup-restore.md](../../../docs/deployment/backup-restore.md)
6. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
7. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
8. [docs/development/production-smoke-alerting-strategy.md](../../../docs/development/production-smoke-alerting-strategy.md)

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
3. For write actions, require explicit confirmation and a rollback plan before changing production, update policy, database, upload directory, or Nginx.
4. Preserve evidence: command, host, timestamp, version, image digest, backup path/hash, status, residual risk.
5. After release/update/rollback, sync docs and tasks through the doc sync skill and record residual items through the residual ledger when they remain.

## Guardrails

- Do not execute production deploy, backup, restore, migration, updater apply, or rollback without explicit user confirmation.
- Do not expose secrets, `.env`, database URLs, API keys, session secrets, or smoke credentials.
- Do not mount Docker socket or server secrets into Web runtime.
- Do not treat `AREAFORGE_AUTO_APPLY=patch` as safe unless signing, backups, manifest policy, and rollback evidence are confirmed.
- Do not delete backups or upload files from routine checks.
