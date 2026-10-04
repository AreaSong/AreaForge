ALTER TABLE "Attachment"
  ADD COLUMN "storageWorkspaceId" TEXT,
  ADD COLUMN "storageReleasedAt" TIMESTAMP(3),
  ADD COLUMN "storageReleaseProof" TEXT;

ALTER TABLE "Attachment"
  ADD CONSTRAINT "Attachment_storage_workspace_valid" CHECK (
    "storageWorkspaceId" IS NULL OR
    (length("storageWorkspaceId") BETWEEN 1 AND 191 AND btrim("storageWorkspaceId") = "storageWorkspaceId")
  ),
  ADD CONSTRAINT "Attachment_storage_release_valid" CHECK (
    ("storageReleasedAt" IS NULL AND "storageReleaseProof" IS NULL) OR
    ("storageReleasedAt" IS NOT NULL AND "storageReleaseProof" IS NOT NULL
      AND "storageReleaseProof" ~ '^sha256:[a-f0-9]{64}$' AND status = 'FAILED' AND "stagingName" IS NULL)
  );

CREATE INDEX "Attachment_storageWorkspaceId_storageReleasedAt_idx"
  ON "Attachment"("storageWorkspaceId", "storageReleasedAt");

-- 计量归属只允许给旧 NULL 行补齐，不允许已知归属漂移；已释放身份不能再次激活。
CREATE FUNCTION areaforge_attachment_storage_identity_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."storageWorkspaceId" IS NOT NULL AND NEW."storageWorkspaceId" IS DISTINCT FROM OLD."storageWorkspaceId" THEN
    RAISE EXCEPTION 'STORAGE_WORKSPACE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF OLD."storageReleasedAt" IS NOT NULL AND
    (NEW."storageReleasedAt" IS DISTINCT FROM OLD."storageReleasedAt"
      OR NEW."storageReleaseProof" IS DISTINCT FROM OLD."storageReleaseProof"
      OR ROW(NEW.id, NEW."ownerUserId", NEW."storageWorkspaceId", NEW."storedName", NEW.uri,
        NEW.hash, NEW."sizeBytes", NEW."protocolVersion", NEW.status, NEW."stagingName")
        IS DISTINCT FROM ROW(OLD.id, OLD."ownerUserId", OLD."storageWorkspaceId", OLD."storedName", OLD.uri,
        OLD.hash, OLD."sizeBytes", OLD."protocolVersion", OLD.status, OLD."stagingName")) THEN
    RAISE EXCEPTION 'STORAGE_RELEASE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER areaforge_attachment_storage_identity_guard
  BEFORE UPDATE ON "Attachment" FOR EACH ROW
  EXECUTE FUNCTION areaforge_attachment_storage_identity_guard();
