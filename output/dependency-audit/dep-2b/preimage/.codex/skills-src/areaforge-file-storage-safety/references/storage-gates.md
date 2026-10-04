# File Storage Safety Gates

## Upload And Download

- Uploads stay note-scoped unless a new confirmed scope allows another owner type.
- `UPLOAD_DIR` must be private and outside static public serving.
- Path resolution must reject traversal, symlink escape, and unsafe upload roots.
- Allowed file types remain explicit; MIME, magic bytes, byte size, and hash must agree with the stored file body.
- Attachment DTOs expose authenticated download paths, not internal URI, stored filename, or absolute path.
- Download responses must keep private/no-store cache posture and safe content headers.

## Reconciliation

- Reconciliation defaults to `report_only`.
- A mismatch report may identify database metadata, missing files, hash/size mismatch, unexpected files, or unsafe roots.
- Repairing metadata, deleting orphan files, moving files, or re-linking records requires a separate confirmed high-risk scope.
- Evidence should include row count, mismatch count, report path or hash, and whether production data was touched.

## Deletion And Cleanup

- Attachment deletion is not part of the current Package A scope.
- Future deletion work must define owner, authorization, tombstone or hard-delete semantics, rollback, audit, and file/body cleanup behavior.
- Orphan cleanup must never run silently from Web runtime or release scripts without an explicit confirmation packet.

## Backup, Restore, And Rollback

- Backup evidence must include database dump hash, uploads archive hash, env/config backup hash, and restore target.
- Restore evidence must say whether database and uploads were restored, skipped, or not applicable.
- Rollback evidence must state whether file data was restored, left in place, or reconciled only in `report_only` mode.
- Release records must not contain secrets, production env content, database URLs, upload absolute paths, or private file contents.

## Validation

For file-storage changes, choose checks from the validation matrix and include the smallest sufficient set:

- storage package tests
- upload/download route smoke
- path traversal and unsafe root checks
- metadata/hash/download response agreement
- `pnpm risk:preflight`
- docs/readiness checks when source facts change
