import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedSearchCopy } from "./data-delete-search";
import type { DeleteRecord, DeleteTx } from "./data-delete-query";

const record = (model: string, id: string, metadata: Record<string, unknown> = {}): DeleteRecord => ({ model, key: { id },
  identityHash: `sha256:${"a".repeat(64)}`, rowHash: `sha256:${"b".repeat(64)}`, metadata });
const client = { workspaceSearchPartition: { findUnique: async () => ({ workspaceId: "historical-workspace" }) } } as unknown as DeleteTx;
test("搜索副本只继承已授权精确源，不从分区反向授权源，也不按同名ID跨模型删除", async () => {
  for (const [kind, model, field] of [["SUBJECT", "Subject", "subjectId"], ["TASK", "StudyTask", "taskId"], ["KNOWLEDGE_POINT", "KnowledgePoint", "knowledgePointId"],
    ["NOTE", "Note", "noteId"], ["MISTAKE", "Mistake", "mistakeId"], ["RESOURCE", "StudyResource", "resourceId"]]) {
    const source = record(model!, "source", { workspaceId: "new-workspace" });
    const copy = record("WorkspaceSearchDocument", "copy", { kind, sourceId: "source", [field!]: "source", partitionId: "foreign-viewer", workspaceId: "historical-workspace" });
    assert.equal(await isAuthorizedSearchCopy(client, copy, [source]), true);
    assert.equal(await isAuthorizedSearchCopy(client, copy, [record("OtherModel", "source")]), false);
    assert.equal(await isAuthorizedSearchCopy(client, { ...copy, metadata: { ...copy.metadata, sourceId: "different" } }, [source]), false);
    assert.equal(await isAuthorizedSearchCopy(client, { ...copy, metadata: { ...copy.metadata, workspaceId: "forged" } }, [source]), false);
    assert.equal(await isAuthorizedSearchCopy(client, source, [copy]), false);
  }
});
