# Ops Runbook

## Read-Only Checks

- Public health: `curl -fsS https://forge.areasong.top/api/health`.
- Production read-only smoke: run or attach redacted `pnpm smoke:prod-readonly` output, then validate the record with `pnpm smoke:prod-readonly:validate <record>`.
- Updater status JSON: current/latest version, blocker, signature required, rollback target.
- Systemd: `areaforge-update-agent.timer` and recent `areaforge-update-agent.service` logs.
- Containers: Web image digest, migration image digest when applicable, PostgreSQL internal-only exposure.
- Nginx: `forge.areasong.top` routes to AreaForge Web on server localhost port, not Grafana.
- Backups: latest database dump, uploads archive, env backup, retention age, sha256 records.
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
