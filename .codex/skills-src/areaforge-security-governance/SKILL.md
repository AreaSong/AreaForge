---
name: areaforge-security-governance
description: "Use when Codex needs to review or update AreaForge security governance, authentication, authorization, uploads, attachment access, AI privacy, secrets, logs, supply chain, GitHub Release signing, GHCR, updater safety, production command boundaries, or high-risk confirmation packets."
---

# AreaForge Security Governance

Review security as a system: data boundary, command boundary, dependency boundary, AI boundary, and release boundary.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/security/threat-model.md](../../../docs/security/threat-model.md)
3. [docs/security/file-ai-safety.md](../../../docs/security/file-ai-safety.md)
4. [docs/development/high-risk-confirmation-packets.md](../../../docs/development/high-risk-confirmation-packets.md)
5. [docs/architecture/ai-boundary.md](../../../docs/architecture/ai-boundary.md)
6. [docs/deployment/github-release-updater.md](../../../docs/deployment/github-release-updater.md)

## References

- [references/security-gates.md](references/security-gates.md): security review checklist and high-risk boundaries.
- [../areaforge-file-storage-safety/SKILL.md](../areaforge-file-storage-safety/SKILL.md): upload, attachment, reconciliation, backup, restore, and storage migration safety.
- [../areaforge-supply-chain/SKILL.md](../areaforge-supply-chain/SKILL.md): release artifact, dependency, image, and updater trust gates.
- [../areaforge-ai-governance/SKILL.md](../areaforge-ai-governance/SKILL.md): AI-specific privacy and cost checks.
- [../areaforge-sre-ops/SKILL.md](../areaforge-sre-ops/SKILL.md): production command, backup, and update boundaries.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): security-related validation selection.

## Workflow

1. Identify assets: account/session, database, upload files, AI context, release keys, GHCR images, server secrets, backups.
2. Identify trust boundary changes: browser/server, Web/updater, DB/filesystem, AI provider, GitHub/GHCR, Nginx/container.
3. Apply the security gates before editing code, docs, or release configuration.
4. For reviews, lead with findings and file/line references; separate confirmed issues from residual risk.
5. Treat data export, retention, deletion rights, account/user migration, privacy lifecycle, or default data sharing changes as high-risk until a dedicated data-governance owner exists.
6. Act as the temporary primary coordinator for data lifecycle work: hand attachment/file body rules to `areaforge-file-storage-safety`, AI history/provider trace rules to `areaforge-ai-governance`, backup/restore or production execution to `areaforge-sre-ops`, and unresolved close conditions to `areaforge-residual-ledger`.
7. For fixes, verify auth, path traversal, secret exposure, logging, dependency, and rollback implications.

## Guardrails

- Do not allow Web runtime to execute server commands or hold Docker socket/server secrets.
- Do not send motivation vault, full emotion records, full review body, attachment content, file paths, or full task titles to AI unless a new confirmation explicitly allows it.
- Do not expose `Attachment.uri`, `storedName`, upload absolute paths, `.env`, database URLs, API keys, or cosign private material.
- Do not weaken signature verification, hash checks, backup requirements, or rollback evidence.
- Do not treat a security scan as a substitute for product validation or release evidence.
- Do not implement data export, retention, deletion, migration, or privacy lifecycle changes without explicit scope, rollback/revocation path, data-owner evidence, validation owner, and residual close condition.
