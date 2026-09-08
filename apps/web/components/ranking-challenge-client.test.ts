import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("ranking UI keeps opt-in and private-field boundaries visible", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ranking-challenge-client.tsx"), "utf8");
  assert.match(source, /enabled\s*\?\s*"已主动加入"/);
  assert.match(source, /props\.enabled/);
  assert.match(source, /不包含动机、复盘正文、笔记、错题、附件/);
  assert.match(source, /重建排名/);
  assert.match(source, /邀请成员/);
  assert.match(source, /inviteChallengeParticipant/);
  assert.match(source, /joinOrLeaveChallenge/);
  assert.match(source, /currentUserId/);
  assert.match(source, /canManage/);
  assert.match(source, /RankingAppealPanel/);
});
