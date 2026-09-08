import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

test("ranking routes remain feature-gated, authenticated and projection-only", async () => {
  const [preferences, challenges, participants, projection, deletion, transfer, appeals, appealAction] = await Promise.all([
    source("app/api/ranking/preferences/route.ts"),
    source("app/api/ranking/challenges/route.ts"),
    source("app/api/ranking/challenges/[id]/participants/route.ts"),
    source("app/api/ranking/challenges/[id]/projection/route.ts"),
    source("app/api/ranking/deletion-preview/route.ts"),
    source("app/api/ranking/challenges/[id]/transfer-ownership/route.ts"),
    source("app/api/ranking/challenges/[id]/appeals/route.ts"),
    source("app/api/ranking/challenges/[id]/appeals/[appealId]/route.ts"),
  ]);
  for (const route of [preferences, challenges, participants, projection, deletion, appeals, appealAction]) {
    assert.match(route, /requireApiUser/);
    assert.match(route, /apiErrorResponse/);
  }
  assert.match(projection, /rebuildChallengeProjection/);
  assert.match(deletion, /previewRankingDeletion/);
  assert.match(transfer, /transferPrivateChallengeOwnership/);
  assert.match(appeals, /listRankingAppeals/);
  assert.match(appeals, /submitRankingAppeal/);
  assert.match(appealAction, /transitionRankingAppeal/);
  assert.doesNotMatch(appeals, /notification|email|fetchExternal/i);
  assert.doesNotMatch(appealAction, /notification|email|fetchExternal/i);
  assert.doesNotMatch(deletion, /method\s*:\s*["']DELETE["']/i);
});
