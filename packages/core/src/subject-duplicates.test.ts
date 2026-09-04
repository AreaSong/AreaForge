import assert from "node:assert/strict";
import test from "node:test";
import {
  findSubjectDuplicateSets,
  normalizeSubjectIdentity,
  type SubjectDuplicateCandidate,
} from "./subject-duplicates";

function subject(
  input: Partial<SubjectDuplicateCandidate> & Pick<SubjectDuplicateCandidate, "id" | "name" | "stableKey">,
): SubjectDuplicateCandidate {
  return {
    legacyCode: null,
    archived: false,
    sortOrder: 10,
    referenceCount: 0,
    ...input,
  };
}

test("normalizeSubjectIdentity folds width, whitespace and machine-key case", () => {
  assert.deepEqual(
    normalizeSubjectIdentity({
      name: "  数据　结构 ",
      stableKey: " 408-Data ",
      legacyCode: " data_structure ",
    }),
    {
      name: "数据 结构",
      stableKey: "408-DATA",
      legacyCode: "DATA_STRUCTURE",
    },
  );
});

test("findSubjectDuplicateSets reports exact signals but not semantic guesses", () => {
  const sets = findSubjectDuplicateSets([
    subject({ id: "math", name: "数学", stableKey: "math" }),
    subject({ id: "advanced-math", name: "高等数学", stableKey: "advanced-math" }),
    subject({ id: "data-a", name: "数据结构", stableKey: "data", legacyCode: "DATA_STRUCTURE" }),
    subject({ id: "data-b", name: " 数据结构 ", stableKey: "DATA-ALT", legacyCode: "OTHER" }),
  ]);

  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0]?.subjectIds, ["data-a", "data-b"]);
  assert.deepEqual(sets[0]?.reasons.map((reason) => reason.code), ["NORMALIZED_NAME"]);
});

test("findSubjectDuplicateSets joins transitive signals into one review set", () => {
  const sets = findSubjectDuplicateSets([
    subject({ id: "a", name: "操作系统", stableKey: "os-a", legacyCode: "OPERATING_SYSTEM" }),
    subject({ id: "b", name: "操作系统", stableKey: "os-b", legacyCode: "OS_ALT" }),
    subject({ id: "c", name: "OS", stableKey: "OS-B", legacyCode: "OS_THIRD" }),
  ]);

  assert.deepEqual(sets[0]?.subjectIds, ["a", "b", "c"]);
  assert.deepEqual(sets[0]?.reasons.map((reason) => reason.code), [
    "NORMALIZED_NAME",
    "NORMALIZED_STABLE_KEY",
  ]);
});

test("recommended target prefers active, referenced and earlier subjects deterministically", () => {
  const duplicate = (input: Partial<SubjectDuplicateCandidate> & { id: string }) => subject({
    name: "英语",
    stableKey: input.id,
    ...input,
  });

  assert.equal(findSubjectDuplicateSets([
    duplicate({ id: "archived", archived: true, referenceCount: 99 }),
    duplicate({ id: "light", referenceCount: 2, sortOrder: 1 }),
    duplicate({ id: "heavy", referenceCount: 10, sortOrder: 99 }),
  ])[0]?.recommendedTargetId, "heavy");
});

test("duplicate candidate ids are de-duplicated before grouping", () => {
  const row = subject({ id: "same", name: "政治", stableKey: "politics" });
  assert.deepEqual(findSubjectDuplicateSets([row, row]), []);
});
