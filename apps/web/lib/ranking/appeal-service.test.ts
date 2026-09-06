import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("ranking appeals use a dedicated durable source with revision fencing", async () => {
  const source = await readFile(path.join(process.cwd(), "lib/ranking/appeal-service.ts"), "utf8");
  assert.match(source, /rankingAppeal\.create/);
  assert.match(source, /rankingAppeal\.findMany/);
  assert.match(source, /rankingAppeal\.updateMany/);
  assert.match(source, /revision:\s*input\.expectedRevision/);
  assert.match(source, /RANKING_APPEAL_ALREADY_OPEN/);
  assert.doesNotMatch(source, /readAppealEvents|reduceAppeals/);
});

test("ranking appeal audit stays redacted and the database enforces one open appeal", async () => {
  const root = path.resolve(process.cwd(), "../../");
  const [source, migration] = await Promise.all([
    readFile(path.join(process.cwd(), "lib/ranking/appeal-service.ts"), "utf8"),
    readFile(path.join(root, "prisma/migrations/20260906140000_v18_ranking_appeals/migration.sql"), "utf8"),
  ]);
  assert.match(source, /writeAppealAudit/);
  assert.doesNotMatch(source, /reason:\s*appeal\.reason/);
  assert.match(migration, /RankingAppeal_participantId_active_uidx/);
  assert.match(migration, /WHERE "status" IN \('OPEN', 'UNDER_REVIEW'\)/);
  assert.match(migration, /RankingAppeal_reason_check/);
  assert.match(migration, /RankingAppeal_review_check/);
  assert.match(migration, /RankingAppeal_challengeId_participantId_fkey/);
  assert.match(migration, /RankingAppeal_participantId_submittedByUserId_fkey/);
});
