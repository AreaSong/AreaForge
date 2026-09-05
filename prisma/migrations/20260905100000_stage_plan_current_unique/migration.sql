-- Enforce the StagePlan application invariant at the database boundary.
-- Legacy rows without a workspace remain outside this constraint; they are
-- resolved only through the owner-scoped takeover path.
DO $$
BEGIN
    IF EXISTS (
        SELECT "workspaceId"
        FROM "StagePlan"
        WHERE "workspaceId" IS NOT NULL
          AND "status" IN ('active', 'draft')
        GROUP BY "workspaceId"
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'stage plan current preimage is ambiguous';
    END IF;
END $$;

CREATE UNIQUE INDEX "StagePlan_one_current_per_workspace_idx"
    ON "StagePlan"("workspaceId")
    WHERE "workspaceId" IS NOT NULL
      AND "status" IN ('active', 'draft');
