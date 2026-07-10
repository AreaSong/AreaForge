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

## High-Risk Confirmation Required

- Auth/session model changes.
- Upload deletion, cross-object attachments, storage relocation.
- AI context expansion, history persistence, cost ledger, production key smoke.
- Prisma migration deploy, historical backfill, deleting old fields.
- Production deploy, backup, restore, updater apply, rollback, auto-apply policy.
- Dependency that changes runtime security posture.

## Report Format

Lead with findings. For each issue include path/line, impact, exploit or failure path, recommended fix, and verification.
