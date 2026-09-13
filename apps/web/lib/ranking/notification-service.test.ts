import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("ranking notification service gates the durable queue separately from direct notification writes", async () => {
  const source = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "notification-service.ts"), "utf8");
  assert.match(source, /notificationQueueEnabled\(process.env\)/);
  assert.match(source, /enqueueRankingNotificationJob\(client, input\)/);
  assert.match(source, /writeRankingNotificationDirect\(client, input\)/);
  assert.match(source, /new ApiError\(error.code, 409\)/);
});
