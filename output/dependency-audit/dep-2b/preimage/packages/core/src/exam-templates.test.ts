import assert from "node:assert/strict";
import test from "node:test";
import {
  EXAM_TEMPLATE_CATALOG_VERSION,
  findExamTemplateSubjectByLegacyCode,
  getExamTemplate,
  listExamTemplates,
  materializeExamTemplate,
} from "./exam-templates";

test("exam template catalog is versioned and materializes ordinary rows", () => {
  assert.ok(EXAM_TEMPLATE_CATALOG_VERSION);
  assert.deepEqual(listExamTemplates().map((template) => template.id), [
    "postgraduate-common",
    "computer-science-408",
  ]);
  const template = getExamTemplate("computer-science-408");
  assert.equal(template?.groups.length, 1);
  const rows = materializeExamTemplate("computer-science-408");
  assert.equal(rows?.groups[0]?.stableKey, "408");
  assert.equal(rows?.subjects.length, 4);
  assert.equal(rows?.subjects.every((subject) => subject.groupStableKey === "408"), true);
  if (rows) rows.groups[0]!.name = "已编辑分组";
  assert.equal(materializeExamTemplate("computer-science-408")?.groups[0]?.name, "408");
  assert.equal(findExamTemplateSubjectByLegacyCode("OPERATING_SYSTEM")?.groupStableKey, "408");
  assert.equal(findExamTemplateSubjectByLegacyCode("math")?.groupStableKey, "common");
  assert.equal(findExamTemplateSubjectByLegacyCode("missing"), null);
  assert.equal(materializeExamTemplate("missing"), null);
});
