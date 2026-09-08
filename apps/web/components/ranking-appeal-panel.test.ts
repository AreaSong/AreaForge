import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("ranking appeal UI exposes submit, owner review, conflict recovery and accessible feedback", async () => {
  const source = await readFile(path.join(process.cwd(), "components/ranking-appeal-panel.tsx"), "utf8");
  assert.match(source, /listRankingAppeals/);
  assert.match(source, /submitRankingAppeal/);
  assert.match(source, /transitionRankingAppeal/);
  assert.match(source, /expectedRevision|appeal\.revision/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /aria-invalid/);
  assert.match(source, /role="alert"/);
  assert.match(source, /min-h-11/);
  assert.match(source, /网络不可用/);
  assert.match(source, /已重新载入最新结果/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});
