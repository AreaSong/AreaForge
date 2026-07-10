# Public Triage Gates

## Classification Gate

Route public work by first matching it to one category:

- Bug: reproducible product behavior, UI, API, data, auth, upload, AI, or regression.
- Feature: requested product or engineering capability.
- Ops support: self-hosting, Nginx, Docker Compose, updater, backup, smoke, alert, rollback, or readiness.
- Release or supply chain: GitHub Release, GHCR digest, SBOM, provenance, signatures, Actions, dependency audit, or updater trust.
- Security: auth bypass, secret exposure, path traversal, upload escape, AI privacy leak, dependency vulnerability, release trust break, or server command exposure.
- Contribution review: PR scope, validation evidence, docs sync, residual risks, and high-risk confirmation.

## Sensitive Data Gate

Before technical analysis, scan public issue or PR content for:

- production `.env`, database URLs, tokens, API keys, session secrets, cosign material, smoke passwords
- attachment contents, full review text, motivation vault data, full emotion records, real study notes, private task titles
- upload absolute paths, backup archives, database dumps, unredacted server logs
- exploit details for auth/session, upload/download, AI provider, release updater, backup/restore, or dependencies

If present, ask for redaction and route security details through `SECURITY.md`. Do not quote secrets back to the user.

## Evidence Gate

Prefer redacted evidence that is enough to reproduce or route:

- AreaForge version, release tag, install mode, browser, OS
- exact command names and pass/fail status
- redacted health, update-agent status, readiness summary, evidence bundle, or alert preview
- screenshots with private study content covered
- minimal local reproduction before production write actions
- residual risk ID when known, such as `AF-RISK-OPS-001`

## Owner Gate

- Product bug or UX: `areaforge-product-experience` and `areaforge-qa-smoke`
- Data, auth, privacy, upload exposure, or security: `areaforge-security-governance`
- Ops support: `areaforge-sre-ops` and `areaforge-observability`
- Release/update: `areaforge-release-operator`
- Supply chain or dependency trust: `areaforge-supply-chain`
- AI behavior: `areaforge-ai-governance`
- Docs drift: `areaforge-doc-sync`
- Residual status: `areaforge-residual-ledger`
- Validation selection: `areaforge-validation-driver`

## Response Gate

Public responses should:

- give the next safe diagnostic step first
- avoid asking for secrets or production data
- state when an action is read-only, local-only, or high-risk production work
- reference the relevant doc path or residual ID
- avoid promising SLA, production access, or automatic fixes

Public responses must not:

- authorize deploy, backup, restore, migration, updater apply, rollback, or auto-apply changes
- accept unredacted logs, dumps, backups, credentials, or attachment contents
- close `AF-RISK-*` without the required evidence
- treat green local checks as production health
