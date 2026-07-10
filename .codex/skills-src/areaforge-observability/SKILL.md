---
name: areaforge-observability
description: "Use when Codex needs to inspect, design, or improve AreaForge observability: health checks, logs, update-agent status, backup freshness, disk/cert capacity, release evidence, alert thresholds, smoke signals, operational dashboards, or production readiness signals."
---

# AreaForge Observability

Use this skill to prove what the system is doing before diagnosing, releasing, rolling back, or claiming production health.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/development/validation-matrix.md](../../../docs/development/validation-matrix.md)
3. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
4. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)
5. [docs/development/docs-100-completion-record.md](../../../docs/development/docs-100-completion-record.md)
6. [docs/development/operational-readiness.md](../../../docs/development/operational-readiness.md)
7. [docs/development/maintenance-cadence.md](../../../docs/development/maintenance-cadence.md)
8. [docs/development/production-smoke-alerting-strategy.md](../../../docs/development/production-smoke-alerting-strategy.md)
9. [docs/development/support-bundle-preview.md](../../../docs/development/support-bundle-preview.md)
10. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)

## References

- [references/signals.md](references/signals.md): signal inventory, thresholds, evidence format, and gaps.
- [../areaforge-sre-ops/SKILL.md](../areaforge-sre-ops/SKILL.md): production operations and updater checks.
- [../areaforge-qa-smoke/SKILL.md](../areaforge-qa-smoke/SKILL.md): user-journey smoke evidence.
- [../areaforge-incident-response/SKILL.md](../areaforge-incident-response/SKILL.md): incident classification when signals show degradation.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): choose local verification after observability changes.

## Workflow

1. Classify the observation target: app health, user journey, database, uploads, AI provider, release updater, backup, infrastructure, or docs evidence.
2. Load the signal inventory before deciding whether a status is healthy, degraded, blocked, or unknown.
3. Use `pnpm ops:status` only as an offline control-plane/residual projection; use live readiness, smoke, update-agent, backup, release, and alert evidence for production claims.
4. Prefer read-only evidence: health JSON, metadata-only support bundle preview, logs with secrets redacted, status files, smoke result, backup inventory, disk/cert age, release digest, and update-agent state.
5. Separate live production evidence from local, CI, dry-run, or historical evidence.
6. Record status with timestamp, source, command or endpoint, result, residual risk ID, and follow-up owner.
7. If evidence shows user-visible failure, stale backups, signature failure, missing smoke, or unknown release digest, hand off to incident response or release operator.

## Guardrails

- Do not mark production healthy from a single local command, cached screenshot, or stale release record.
- Do not expose tokens, cookies, `.env`, database URLs, upload paths, backup paths with secrets, or full logs containing user content.
- Do not execute production deploy, updater apply, backup, restore, migration, rollback, or server command from this skill without explicit confirmation through the SRE or incident skill.
- Do not treat `GET /api/health` alone as complete product health; pair it with authenticated smoke or an explicit limitation.
- Do not invent green status for missing metrics. Report `unknown` and the missing evidence.
