import assert from "node:assert/strict";
import test from "node:test";
import { deleteModel, deleteOwnerFields, deleteParentFields, deletePrimaryKey, deleteWorkspacePath, sourceDeleteModels } from "./data-delete-models";
import { deletePathPredicate } from "./data-delete-query";

test("删除清单覆盖每个生成的业务模型且 owner/parent/主键路径均存在", () => {
  const models = sourceDeleteModels();
  assert.equal(models.length, 92);
  for (const [model, field] of Object.entries({ ...deleteOwnerFields, ...deleteParentFields })) {
    assert.ok(deleteModel(model).fields.some(candidate => candidate.name === field), model + "." + field);
  }
  for (const model of models) {
    assert.ok(deletePrimaryKey(model.name).length);
    const workspace = deleteWorkspacePath(model.name);
    if (workspace) assert.doesNotThrow(() => deletePathPredicate(model.name, workspace, "workspace-1"), model.name);
  }
});
