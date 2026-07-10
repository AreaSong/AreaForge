# Security Gates

## Review Checklist

- Authentication required for private routes.
- API routes do not trust client-provided actor/user ids.
- Upload paths cannot escape `UPLOAD_DIR`; uploads are not in `public/`.
- Attachment DTO exposes `downloadApiPath`, not internal URI or stored filename.
- AI routes are POST-only, authenticated, minimized, and fallback-safe.
- Client bundle contains no server secrets.
- Logs do not include `.env`, database URL, API keys, prompt/raw response, upload absolute path, or full private text.
- Release updater verifies hash/signature and uses immutable digests.
- Web runtime has no server command surface.

## File, Attachment, And Backup Acceptance

For upload, attachment, backup, restore, or storage migration work, require evidence for:

- Files are not moved, overwritten, deleted, or re-linked unless the confirmed scope explicitly permits it.
- Database metadata, stored hash, byte size, MIME, and authenticated download response agree with the file body.
- `UPLOAD_DIR` stays private, is not under `public/`, and symlink traversal is rejected.
- Reconciliation tools default to `report_only` and do not repair, delete, or rewrite metadata without a separate confirmation.
- Backup/restore records include DB dump hash, uploads archive hash, env/config backup hash, restore target, and whether production data was touched.
- Rollback or recovery evidence states whether database and uploads were restored, skipped, or not applicable.

## High-Risk Confirmation Required

- Auth/session model changes.
- Upload deletion, cross-object attachments, storage relocation.
- AI context expansion, history persistence, cost ledger, production key smoke.
- Prisma migration deploy, historical backfill, deleting old fields.
- Production deploy, backup, restore, updater apply, rollback, auto-apply policy.
- Dependency that changes runtime security posture.

## Report Format

Lead with findings. For each issue include path/line, impact, exploit or failure path, recommended fix, and verification.
