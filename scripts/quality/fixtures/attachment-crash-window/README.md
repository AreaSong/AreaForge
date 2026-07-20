# Attachment Crash-Window Fixture

This directory is fixture-only. It models attachment write states without reading or writing a real database or upload directory.

The validator requires `report_only`, `fileDeleted=false`, redacted state transitions, and explicit `doesNotProve` boundaries.

`ops007-preconfirmation.json` is the checked-in strict state matrix. It contains no file content, object IDs, absolute paths, database URLs, or secret values.
