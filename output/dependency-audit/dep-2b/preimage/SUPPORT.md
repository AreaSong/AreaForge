# AreaForge Support

AreaForge is a self-hosted study operations system. Public support is best-effort and evidence-based: include enough redacted context to reproduce or route the issue, but never include secrets or private study data.

## Where To Ask

- Bug with clear reproduction: use the Bug Report issue template.
- Feature or product improvement: use the Feature Request issue template.
- Self-hosting, release, updater, backup, smoke, or rollback question: use the Ops Support issue template.
- Security vulnerability: use GitHub private vulnerability reporting when available. If unavailable, open a minimal public issue asking for a private contact and do not include exploit details.

## Do Not Post Publicly

- production `.env`, database URLs, API keys, session secrets, GitHub tokens, cosign private material, smoke passwords
- attachment contents, full review text, motivation vault data, full emotion records, private task titles, real study notes
- upload absolute paths, backup archives, database dumps, server logs with unredacted secrets
- exploit details for auth/session, uploads, AI provider, release updater, backup/restore, or dependency issues

## Useful Redacted Context

- AreaForge version and release tag
- install mode: local dev, Docker Compose, self-host production, updater-managed production
- browser and OS for UI bugs
- relevant command names and pass/fail result
- `pnpm ops:support:bundle-preview` output after `pnpm ops:support:bundle-preview:validate`
- redacted health or update-agent status
- residual risk ID if the issue relates to known operations gaps, such as `AF-RISK-OPS-001`
- whether the issue affects auth, uploads, AI, release/update, backup/restore, migration, or data integrity

## Maintainer Triage

Maintainers route issues using `docs/development/support-intake.md`.

Public issue replies should not ask users to paste secrets. When more evidence is needed, request redacted command output, screenshots without private data, or a minimal reproduction on a non-production environment.
