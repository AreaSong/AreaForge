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

Use `pnpm smoke:prod-readonly:config` before production read-only smoke to verify redacted smoke configuration shape without reading password contents, connecting to production, executing server commands, or writing production data.

Use `pnpm ops:handoff` at the start of a maintenance window, release check, or Codex thread handoff when a read-only operator needs one machine-readable view of offline control-plane status, due residuals, release-relevant residuals, claim boundaries, next commands, and safety facts. It reuses `pnpm ops:status`, does not request network, does not write a handoff file, and cannot prove production health.

Use `pnpm ops:readiness:summary` when a machine-readable read-only snapshot is useful for a release record, handoff, or operator audit. The command may read `/api/health`, optional authenticated update status, optional smoke output, and optional backup evidence strings; it must not execute Docker, backup, restore, migration, rollback, shell, or server commands.

Use `pnpm ops:evidence:bundle` after release/update checks or before operator handoff when the snapshot should be indexed with required evidence, forbidden actions, residual risk IDs, and a `bundleHash`. Validate saved bundles with `pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>`. A bundle hash is evidence indexing, not proof that missing signals are healthy.

Use `pnpm ops:alert:preview` to map readiness signals into severity, would-notify decisions, owner, recommended action, and residual risk IDs. It is a read-only preview; it does not call external alert receivers or close `AF-RISK-OPS-004` by itself.

Use `pnpm alert:drill:validate <record>` to validate a completed alert/recovery drill record against the `AF-RISK-OPS-004` close-condition evidence shape. The validator is read-only and checks fields, enums, hash shape, residual ID, and secret-like leaks.

Use `pnpm update-agent:status:record <status.json> > <record.json>` to normalize a copied server `status.json` or saved `/api/system/update-status` response into a redacted update-agent status record. Then run `pnpm update-agent:status:validate <record.json>` before feeding it to readiness. The validator checks version, `autoApply=none`, `signatureRequired=true`, timer, `blocker=null`, rollback summary, safety facts, and secret-like leaks.

Use `pnpm ops:ops-001:preflight` before generating an OPS-001 closure packet when redacted evidence paths are available. It reports `read_only_ops001_evidence_preflight`, `requiredPreflight`, `forbiddenActions`, and `safetyFacts`; it does not execute production smoke, generate a packet, or update the residual ledger.

Use `pnpm ops:ops-001:closure <smoke-record> <update-status-record> <evidence-bundle> > <packet>` only after the smoke record, update-agent status record, and operational evidence bundle validators pass. Then run `pnpm ops:ops-001:closure:validate <packet>` to prove `AF-RISK-OPS-001` has a reviewable closure packet. This does not close backup, alerting, supply-chain, or other residual risks and does not update the ledger automatically.

Use `pnpm maintenance:window:validate <record>`, `pnpm incident:record:validate <record>`, and `pnpm restore:drill:validate <record>` when maintenance windows, incidents, or restore drills need repository-visible redacted evidence. These records do not execute checks, do not authorize production writes, and cannot replace live production evidence.

Use `pnpm maintenance:window:record` when redacted `pnpm ops:readiness:summary`, `pnpm ops:evidence:bundle`, and `pnpm ops:alert:preview` outputs are already saved locally and a maintenance-window draft is needed. The generator reads local files only, does not connect to production, and the generated record still must pass `pnpm maintenance:window:validate <record>`.

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
