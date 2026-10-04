-- Workspace lifecycle and current selection are separate in v1.4.
-- From this migration onward, the rollback floor must understand WorkspaceSelection.

DROP INDEX IF EXISTS "ExamWorkspace_one_active_per_user_idx";
