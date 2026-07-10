# Observability Signals

## Signal Classes

| Signal | Healthy evidence | Degraded evidence | Owner |
|---|---|---|---|
| App health | `GET /api/health` returns expected version and database status | 5xx, wrong version, stale deployment, DB error | SRE Ops |
| Authenticated smoke | Login and first-screen journeys pass | Login failure, dashboard failure, API auth error | QA Smoke |
| Release identity | Version, tag, image digest, manifest, and health agree | mutable tag, missing digest, health mismatch | Release Operator |
| Update agent | timer active, signature required, blocker null, last check recent | blocker present, unsigned assets, stale timer | SRE Ops |
| Backup freshness | current DB/uploads/env/config backup inventory with hashes | missing backup, old backup, missing hash | SRE Ops |
| Upload access | authenticated upload/download smoke passes, metadata/hash match | public file exposure, 403 for owner, hash mismatch | Security Governance |
| AI provider | provider success or explicit fallback with redacted logs | timeout storm, raw prompt logs, unexpected external payload | AI Governance |
| Infrastructure | disk/cert/container/log status acceptable | low disk, cert near expiry, restart loop | SRE Ops |

## Evidence Format

Record:

- timestamp and timezone
- environment: local, CI, staging, remote production, or unknown
- command, endpoint, or source file
- version, release tag, image digest, and commit when relevant
- result: pass, warn, fail, blocked, or unknown
- residual risk and next owner
- residual risk ID when tracked in `docs/development/residual-risk-ledger.md`
- safety facts for read-only operators: whether server commands, backup/restore, migration, production writes, secret printing, password-file reads, or network requests occurred

Use `pnpm ops:readiness:summary` when a machine-readable read-only snapshot is useful for a release record, handoff, or operator audit. The command may read `/api/health`, optional authenticated update status, optional smoke output, and optional backup evidence strings; it must not execute Docker, backup, restore, migration, rollback, shell, or server commands.

Use `pnpm ops:evidence:bundle` after release/update checks or before operator handoff when the snapshot should be indexed with required evidence, forbidden actions, residual risk IDs, and a `bundleHash`. A bundle hash is evidence indexing, not proof that missing signals are healthy.

Use `pnpm ops:alert:preview` to map readiness signals into severity, would-notify decisions, owner, recommended action, and residual risk IDs. It is a read-only preview; it does not call external alert receivers or close `AF-RISK-OPS-004` by itself.

The summary output includes `safetyFacts` such as `serverCommandAttempted=false`, `backupRestoreAttempted=false`, `migrationAttempted=false`, `productionWriteAttempted=false`, `secretValuePrinted=false`, `smokePasswordReadFromFile`, and `networkRequested`.

## Threshold Defaults

- Public health alone is `warn` for release readiness; pair it with authenticated smoke.
- Missing digest is `fail` for production release evidence.
- Missing backup freshness is `blocked` for updater apply, rollback, or migration.
- Missing AI fallback evidence is `warn` unless the affected path is currently user-visible.
- Any suspected secret in logs is `blocked` until security review.

## Long-Term Gaps To Track

- Structured metrics dashboard is not yet a product feature.
- Production extra smoke is still configured outside Web runtime.
- Full alert routing is operational, not in-app.
- SBOM/provenance may be a supply-chain residual until implemented.
Track these gaps with `AF-RISK-*` IDs in `docs/development/residual-risk-ledger.md`.
