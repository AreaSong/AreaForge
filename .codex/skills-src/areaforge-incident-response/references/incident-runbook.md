# Incident Runbook

## Severity

| Severity | Meaning | First action |
|---|---|---|
| SEV1 | App unavailable, data access broken, or likely data/security loss | Freeze evidence, pause risky automation, prepare rollback/containment |
| SEV2 | Core study loop degraded for authenticated users | Gather signals, contain affected path, verify fallback |
| SEV3 | Non-core feature, docs, updater status, or observability gap | Record residual, schedule fix, avoid risky production writes |
| Security suspicion | Secret exposure, unauthorized access, attachment leak, AI privacy leak | Stop expansion, preserve evidence, use security governance |

## Triage Packet

Collect before writes:

- user-visible symptom and reproduction path
- current version, release tag, image digest, commit, and health output
- affected endpoints/pages and timestamps
- updater state and auto-apply policy
- recent release or config changes
- backup freshness and rollback target
- logs with secrets redacted

## Containment Options

- keep `AREAFORGE_AUTO_APPLY=none`
- disable or bypass AI provider and use local fallback
- stop a risky update path before applying
- roll back to the previous pinned image after confirmation
- block attachment route only if there is explicit data exposure risk
- avoid data repair until root cause and backups are known

## Closeout

Close only when the record contains:

- severity and impact window
- root cause or accepted unknown
- actions taken and who authorized risky writes
- validation after containment or rollback
- residual risks and follow-up owner
- docs/tasks/workflow sync status

## Never Do

- never restore or rollback without a current backup decision
- never delete data as a containment shortcut
- never expose secrets while sharing logs
- never mark resolved without verifying the affected user journey
