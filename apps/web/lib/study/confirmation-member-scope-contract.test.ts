import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("confirmation center resolves the selected member workspace and keeps actor-owned consumers", async () => {
  const source = await readFile(path.join(process.cwd(), "lib/study/confirmation-service.ts"), "utf8");
  assert.match(source, /resolveSelectedMemberWorkspace\(actorId\)/);
  assert.doesNotMatch(source, /resolveActiveWorkspace/);
  assert.match(source, /getPeriodicReport\("week", new Date\(\), actorId\)/);
  assert.match(source, /listStageAdjustmentDrafts\(actorId\)/);
  assert.match(source, /listSimulationExams\(actorId\)/);
  assert.match(source, /listKnowledgeRetests\(actorId\)/);
  assert.match(source, /where: \{ actorId, workspaceId: workspace\.id/);
});
