import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@areaforge/db";
import { advanceSubjectMergeParentRevisions, migrateSubjectReferences } from "./subject-merge-migration";
import { restoreSubjectMergeReferences } from "./subject-merge-undo-migration";
import type { SubjectMergeScope } from "./subject-merge-support";

const models = {
  studyTasks: "studyTask", studySessions: "studySession", syllabusNodes: "syllabusNode", notes: "note",
  mistakes: "mistake", simulationSubjectResults: "simulationSubjectResult", planMilestones: "planMilestone",
  planInboxItems: "planInboxItem", studyResources: "studyResource", primaryKnowledgePoints: "knowledgePoint",
  knowledgeGroups: "knowledgeGroup", learningArrangements: "learningArrangement",
} as const;

test("合并/撤销推进所有版本模型，正文保留且旧表单CAS不再匹配", async () => {
  const scope = { relatedKnowledgePointLinks: [] } as unknown as SubjectMergeScope;
  const rows: Record<string, Record<string, unknown>> = {};
  const tx: Record<string, unknown> = {};
  for (const [key, model] of Object.entries(models)) {
    const id = `${model}-id`;
    Object.assign(scope, { [key]: [{ id, sourceSubjectId: "source", originType: "USER", originKey: "origin", originVersion: 1, stableKey: "stable", originSnapshot: {} }] });
    const field = model === "knowledgePoint" ? "primarySubjectId" : "subjectId";
    rows[model] = { id, [field]: "source", revision: 1, content: "原文", simulationExamId: "exam" };
    tx[model] = {
      findMany: async () => [rows[model]],
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const subject = where[field];
        if (typeof subject === "string" && rows[model][field] !== subject) return { count: 0 };
        if (subject && typeof subject === "object" && !(subject as { in: unknown[] }).in.includes(rows[model][field])) return { count: 0 };
        if (where.revision !== undefined && rows[model].revision !== where.revision) return { count: 0 };
        for (const [name, value] of Object.entries(data)) rows[model][name] = name === "revision" ? Number(rows[model][name]) + (value as { increment: number }).increment : value;
        return { count: 1 };
      },
    };
  }
  let examRevision = 1;
  tx.simulationExam = { updateMany: async () => { examRevision++; return { count: 1 }; } };
  const client = tx as unknown as Prisma.TransactionClient;
  await migrateSubjectReferences(client, "target", ["source"], scope);
  const staleNoteRevision = rows.note.revision;
  rows.note.content = "合并后改过的正文";
  await restoreSubjectMergeReferences(client, "target", scope);
  for (const model of Object.values(models)) {
    assert.equal(rows[model][model === "knowledgePoint" ? "primarySubjectId" : "subjectId"], "source");
    assert.equal(rows[model].revision, ["studyTask", "studySession", "mistake"].includes(model) ? 1 : 3, model);
  }
  assert.equal(examRevision, 3);
  assert.equal(rows.note.content, "合并后改过的正文");
  const staleWrite = await client.note.updateMany({ where: { id: "note-id", revision: Number(staleNoteRevision) }, data: { subjectId: "target" } });
  assert.equal(staleWrite.count, 0);
  assert.equal(rows.note.subjectId, "source");
});

test("主科目与关联科目共同影响父知识点时只推进一次", async () => {
  let ids: string[] = [];
  const tx = { knowledgePoint: { updateMany: async (query: { where: { id: { in: string[] } } }) => { ids = query.where.id.in; return { count: ids.length }; } } } as unknown as Prisma.TransactionClient;
  await advanceSubjectMergeParentRevisions(tx, {
    primaryKnowledgePoints: [{ id: "both" }], relatedKnowledgePointLinks: [{ knowledgePointId: "both" }, { knowledgePointId: "related-only" }], simulationSubjectResults: [],
  } as unknown as SubjectMergeScope);
  assert.deepEqual(ids, ["both", "related-only"]);
});

test("父考试只推进受影响集合，共用同一考试的结果去重", async () => {
  const versions = new Map([["affected", 10], ["untouched", 20]]);
  const tx = {
    simulationSubjectResult: { findMany: async (query: { where: { id: { in: string[] } }; select: unknown }) => {
      assert.deepEqual(query, { where: { id: { in: ["one", "two"] } }, select: { simulationExamId: true } });
      return [{ simulationExamId: "affected" }, { simulationExamId: "affected" }];
    } },
    simulationExam: { updateMany: async (query: { where: { id: { in: string[] } }; data: unknown }) => {
      assert.deepEqual(query, { where: { id: { in: ["affected"] } }, data: { revision: { increment: 1 } } });
      for (const id of query.where.id.in) versions.set(id, versions.get(id)! + 1);
      return { count: query.where.id.in.length };
    } },
  } as unknown as Prisma.TransactionClient;
  await advanceSubjectMergeParentRevisions(tx, { primaryKnowledgePoints: [], relatedKnowledgePointLinks: [], simulationSubjectResults: [{ id: "one" }, { id: "two" }] } as unknown as SubjectMergeScope);
  assert.equal(versions.get("affected"), 11);
  assert.equal(versions.get("untouched"), 20);
});
