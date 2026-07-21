---
name: areaforge-file-storage-safety
description: "Use when Codex needs to review, change, or plan AreaForge file storage safety: note attachments, upload/download authorization, UPLOAD_DIR privacy, Attachment metadata/hash/URI, orphan files, reconciliation, attachment deletion, storage migration, uploads backup/restore, or file evidence in release and rollback records. This skill owns file body and attachment lifecycle details; broad auth/privacy boundary review belongs to areaforge-security-governance."
---

# AreaForge File Storage Safety

Keep file handling boring, private, reversible, and auditable.

## When To Use / Hand Off

- Use for: attachment and file lifecycle details: upload/download paths, metadata/hash agreement, reconciliation, deletion, storage migration, uploads backup/restore.
- Not here: broad auth, secret, and privacy boundary review -> `areaforge-security-governance`; production backup/restore execution -> `areaforge-sre-ops`; validation selection -> `areaforge-validation-driver`.

## Read First

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/architecture/file-storage.md](../../../docs/architecture/file-storage.md)
3. [docs/security/file-ai-safety.md](../../../docs/security/file-ai-safety.md)
4. [docs/development/attachment-upload-access-design.md](../../../docs/development/attachment-upload-access-design.md)
5. [docs/deployment/backup-restore.md](../../../docs/deployment/backup-restore.md)
6. [docs/development/production-release-runbook.md](../../../docs/development/production-release-runbook.md)
7. [docs/development/residual-risk-ledger.md](../../../docs/development/residual-risk-ledger.md)

## References

- [references/storage-gates.md](references/storage-gates.md): upload, attachment, reconciliation, backup, restore, and migration gates.
- [../areaforge-security-governance/SKILL.md](../areaforge-security-governance/SKILL.md): auth, path traversal, secret, log, and high-risk boundary review.
- [../areaforge-sre-ops/SKILL.md](../areaforge-sre-ops/SKILL.md): production backup, restore, updater, and rollback evidence.
- [../areaforge-validation-driver/SKILL.md](../areaforge-validation-driver/SKILL.md): validation selection after file-storage changes.
- [../areaforge-doc-sync/SKILL.md](../areaforge-doc-sync/SKILL.md): keep architecture, security, deployment, and task docs aligned.

## Workflow

1. Classify the work: upload, authenticated download, DTO exposure, metadata/hash, reconciliation, deletion, orphan cleanup, storage migration, backup, restore, or release evidence.
2. Load the storage gates before proposing edits, cleanup, migration, restore, or deletion.
3. Identify the file authority pair: database row and private file body. Confirm how metadata, hash, byte size, MIME, and authenticated response stay aligned.
4. Treat deletion, cleanup, upload directory migration, backup restore, and metadata repair as high-risk actions requiring explicit confirmation.
5. Keep reconciliation read-only by default: report differences first, do not repair or delete files unless the confirmed scope says so.
6. Verify path traversal, symlink escape, public directory exposure, DTO leakage, cache headers, and file/body hash agreement.
7. Route file export, retention, deletion rights, user migration, and upload lifecycle changes through security governance until a dedicated data-governance owner exists.
8. For file lifecycle work, record the database row/file body authority, backup/restore impact, revocation or rollback path, and whether residual evidence belongs in `AF-RISK-DATA-*` in the future or an existing OPS/security residual now.
9. Sync architecture, security, deployment, runbook, residual, and task docs when file behavior or evidence requirements change.

## Guardrails

- Do not place uploaded files in `public/` or expose them through static hosting.
- Do not expose `Attachment.uri`, `storedName`, upload absolute paths, backup paths with secrets, or file-system internals to the browser.
- Do not move, overwrite, relink, delete, repair, or backfill file metadata without a confirmed high-risk scope.
- Do not treat `report_only` reconciliation as cleanup.
- Do not send attachment content, OCR output, upload paths, or private file metadata to AI by default.
- Do not claim restore or rollback success unless database state and uploads archive handling are both recorded as restored, skipped, or not applicable.
- Do not add attachment export, retention, deletion, or user migration behavior without explicit privacy scope, owner confirmation, rollback/revocation evidence, and residual-risk handling.
