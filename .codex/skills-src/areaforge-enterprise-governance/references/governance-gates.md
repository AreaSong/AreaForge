# Governance Gates

## Scope Gate

Ask which governance surface changed:

- CI workflow
- release workflow
- branch, tag, or repository policy
- dependency or build approval
- external capability admission: subagents, MCP, automations, Browser/Computer Use, deployment plugins, or remote ops tools
- security and privacy policy
- PR, issue, CODEOWNERS, or review template
- Codex workflow, skill, validation, or docs gate

## Review Gate

- Findings before summary for reviews.
- File and line evidence for concrete issues.
- Use `CODE_REVIEW.md` as the lightweight review policy for source-fact alignment, high-risk blockers, evidence freshness, and residual-risk reporting.
- Separate blockers, warnings, and residual risks.
- Do not let green local checks replace review of security, release, and data boundaries.

## CI Gate

CI should keep at least:

- `pnpm governance:preflight`
- updater shellcheck and preflight when updater files exist
- Package E / risk / docs gates when release posture is affected
- `pnpm check`
- dependency and lockfile review when package metadata changes

## Policy Gate

- High-risk actions still need explicit confirmation packets.
- Web runtime must not get production command capability.
- External capabilities must not bypass Web runtime command boundaries, release signing, backup/restore, migration, or production confirmation gates.
- Skills are execution guidance, not product source facts.
- Public repository/package visibility does not weaken signing, digest, or rollback requirements.

## Missing Enterprise Artifacts

Current public-project artifacts include `SECURITY.md`, `.github/dependabot.yml`, `.github/pull_request_template.md`, and `docs/development/dependency-policy.md`. If the project later needs broader collaboration, consider CODEOWNERS, issue templates, CODE_OF_CONDUCT.md, SUPPORT.md, or branch protection docs. Do not add them only for ceremony; add them when they change real review behavior.
