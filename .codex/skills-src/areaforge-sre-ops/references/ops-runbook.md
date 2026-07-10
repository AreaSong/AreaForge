# Ops Runbook

## Read-Only Checks

- First operator path: `docs/deployment/operator-onboarding.md`, then `pnpm operator:onboarding:preflight`.
- Offline operability projection: `pnpm ops:status`; this reads local source facts only and cannot prove production health.
- Public health: `curl -fsS https://forge.areasong.top/api/health`.
- Production read-only smoke: run `pnpm smoke:prod-readonly:config`, then run or attach redacted `pnpm smoke:prod-readonly` output, then validate the record with `pnpm smoke:prod-readonly:validate <record>`.
- Updater status JSON: current/latest version, blocker, signature required, rollback target; generate redacted records with `pnpm update-agent:status:record <status.json> > <record.json>` and validate them with `pnpm update-agent:status:validate <record.json>`.
- Systemd: `areaforge-update-agent.timer` and recent `areaforge-update-agent.service` logs.
- Containers: Web image digest, migration image digest when applicable, PostgreSQL internal-only exposure.
- Nginx: `forge.areasong.top` routes to AreaForge Web on server localhost port, not Grafana.
- Backups: latest database dump, uploads archive, env backup, retention age, sha256 records.
- Restore drills: record non-production or temporary restore evidence with `pnpm restore:drill:validate <record>`.
- Disk/cert: free space, certificate expiry, backup partition capacity.

## Write Actions Require Confirmation

- `apply --yes --tag`.
- Rollback.
- Changing `AREAFORGE_AUTO_APPLY`.
- Migration deploy.
- Backup deletion or restore.
- Upload directory movement.
- Nginx or compose changes.

## Incident Triage

1. Confirm user-visible symptom and exact time.
2. Check public health and updater status.
3. Check recent deploy/update events.
4. Check logs with secret redaction.
5. Decide: rollback app, restore data, fix forward, or hold.
6. Record residual risk and docs/task follow-up.
7. If the issue is an incident, record redacted closeout with `pnpm incident:record:validate <record>`.
