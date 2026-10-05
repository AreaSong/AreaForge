import assert from "node:assert/strict";
import test from "node:test";
import { loadSubjectMergePreviewReferences } from "./subject-merge-preview-references";
import { buildSubjectDuplicateSnapshotHash } from "./subject-duplicate-query-service";

const models = ["studyTask", "studySession", "syllabusNode", "note", "mistake", "simulationSubjectResult", "planMilestone", "planInboxItem", "studyResource", "knowledgePoint", "knowledgePointSubject", "knowledgeGroup", "learningArrangement"];
function fixture(notes: unknown[]) {
  return Object.fromEntries(models.map(model => [model, { findMany: async (input: { where: unknown; select: unknown }) => {
    assert.ok(!JSON.stringify(input.where).includes("actor"), "全量绑定不能只取当前用户");
    assert.ok(!JSON.stringify(input.select).includes('"content"'), "不读取正文");
    return model === "note" ? notes : [];
  } }])) as unknown as Parameters<typeof loadSubjectMergePreviewReferences>[0];
}
const note = (id: string, ownerUserId: string, revision = 1) => ({ id, ownerUserId, revision, subjectId: "source", title: id + "-title", updatedAt: new Date(0) });
const hash = (referenceIdentities: readonly unknown[]) => buildSubjectDuplicateSnapshotHash({
  workspaceId: "w", workspaceRevision: 1, targetId: "target", sourceIds: ["source"], reasons: [], subjects: [],
  conflictCounts: { syllabusStableKeys: 0, simulationExams: 0, simulationInboxOrigins: 0, invalidSimulationInboxOrigins: 0, relatedKnowledgePoints: 0 },
  simulationOriginInboxItems: 0, primaryKnowledgePoints: 0, referenceIdentities,
});

test("其他成员参与全量快照，但返回明细不泄露其身份、标题或链接", async () => {
  const result = await loadSubjectMergePreviewReferences(fixture([note("own", "actor"), note("private-secret", "member-b")]), ["source"], "actor");
  assert.equal(result.references.length, 2);
  assert.deepEqual(result.privateCounts, { notes: 1 });
  assert.equal(result.details.length, 1);
  assert.equal(result.details[0].href, "/knowledge/cards/own");
  assert.ok(!JSON.stringify({ details: result.details, counts: result.privateCounts }).includes("private-secret"));
});

test("同数量替换引用、版本变化以及其他成员引用变化均使旧预览失效", async () => {
  const base = await loadSubjectMergePreviewReferences(fixture([note("a", "actor"), note("b", "member")]), ["source"], "actor");
  for (const notes of [[note("replacement", "actor"), note("b", "member")], [note("a", "actor", 2), note("b", "member")], [note("a", "actor"), note("replacement", "member")]]) {
    const changed = await loadSubjectMergePreviewReferences(fixture(notes), ["source"], "actor");
    assert.equal(changed.references.length, base.references.length);
    assert.notEqual(hash(changed.references), hash(base.references));
  }
  const reordered = await loadSubjectMergePreviewReferences(fixture([note("b", "member"), note("a", "actor")]), ["source"], "actor");
  assert.equal(hash(reordered.references), hash(base.references));
});

test("本人模拟补救明细标记转换冲突和无效来源，并提供草稿入口", async () => {
  const db = fixture([]);
  const rows = [
    { id: "a", subjectId: "target", originKey: "simulation-loss:e:target:METHOD_ERROR:none", originSnapshot: {} },
    { id: "b", subjectId: "source", originKey: "old", originSnapshot: { examId: "e", reason: "METHOD_ERROR" } },
    { id: "bad", subjectId: "source", originKey: "bad", originSnapshot: {} },
  ].map(row => ({ ...row, ownerUserId: "actor", workspaceId: "w", originType: "SIMULATION_LOSS", originVersion: 2, revision: 1, title: row.id, stableKey: row.id }));
  db.planInboxItem.findMany = (async () => rows) as unknown as typeof db.planInboxItem.findMany;
  const result = await loadSubjectMergePreviewReferences(db, ["target", "source"], "actor", "target");
  assert.equal(result.details.find(row => row.id === "a")?.conflict, "合并后唯一键冲突");
  assert.equal(result.details.find(row => row.id === "b")?.conflict, "合并后唯一键冲突");
  assert.match(result.details.find(row => row.id === "b")!.key!, /simulation-loss:e:target:METHOD_ERROR:none/);
  assert.equal(result.details.find(row => row.id === "bad")?.conflict, "模拟补救来源无效");
  assert.equal(result.details.find(row => row.id === "bad")?.href, "/roadmap/allocation/drafts/bad");
});

test("同一来源科目的两条补救记录转换后同键，计数与明细一致", async () => {
  const db = fixture([]);
  const rows = ["a", "b"].map(id => ({ id, subjectId: "source", ownerUserId: "actor", workspaceId: "w", originType: "SIMULATION_LOSS", originKey: id, originVersion: 1, stableKey: id, title: id, revision: 1, originSnapshot: { examId: "e", reason: "METHOD_ERROR" } }));
  db.planInboxItem.findMany = (async () => rows) as unknown as typeof db.planInboxItem.findMany;
  const result = await loadSubjectMergePreviewReferences(db, ["target", "source"], "actor", "target");
  assert.deepEqual(result.details.map(row => row.conflict), ["合并后唯一键冲突", "合并后唯一键冲突"]);
});
