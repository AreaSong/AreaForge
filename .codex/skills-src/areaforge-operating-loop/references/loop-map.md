# Operating Loop Map

## Classes

| Class | Use when | Primary owner skill | Evidence to close |
|---|---|---|---|
| Quick | Low-risk wording, links, small docs or template edits | `areaforge-doc-sync` | diff summary, `git diff --check`, targeted docs check |
| Change | Feature, API, UI, package, or cross-file change | relevant domain skill plus `areaforge-validation-driver` | source facts, tests/checks, docs sync, residuals |
| Mission-Critical | auth, migration, uploads, AI privacy, deploy, backup, restore, update policy, server commands | security/SRE/release owner skill | explicit confirmation packet, rollback plan, high-risk validation |
| Review | user asks for review, audit, readiness, or risk check | matching governance or domain skill | findings first, file/line evidence, open questions |
| Ops | production health, backups, update-agent, logs, Nginx, disk, cert, smoke freshness | `areaforge-sre-ops` and `areaforge-observability` | timestamped read-only evidence or confirmed write record |
| Release | version bump, tag, GitHub Release, GHCR digest, updater, rollback | `areaforge-release-operator` and `areaforge-supply-chain` | validation, tag, release assets, signature, digest, health, residuals |
| Incident | outage, failed deploy, data access issue, update failure, suspicious security event | `areaforge-incident-response` | severity, evidence freeze, containment, recovery proof, post-incident residuals |
| Product Experience | usability, flow clarity, mobile/desktop, copy, empty states, real learning loop | `areaforge-product-experience` and `areaforge-qa-smoke` | browser/API smoke, screenshots when relevant, user-impact summary |

## Closeout Checks

- Source facts updated before summaries or skill text.
- High-risk confirmation retained when required.
- Validation selected from changed paths, not habit.
- Release-bound changes mention whether a new GitHub Release is required.
- Release-bound changes must read `docs/development/production-release-runbook.md`, `docs/deployment/github-release-updater.md`, `.github/workflows/release.yml`, and `docs/development/high-risk-confirmation-packets.md` before recommending tag, updater apply, rollback, or policy changes.
- Production release or update evidence must include post-release public health, authenticated smoke or explicit limitation, update-agent status, rollback target, `pnpm ops:evidence:bundle` hash, and relevant residual risk IDs.
- Ops claims are backed by timestamped evidence or reported as `unknown`.
- Residual risks use IDs from `docs/development/residual-risk-ledger.md` when they affect future release or operations decisions.
