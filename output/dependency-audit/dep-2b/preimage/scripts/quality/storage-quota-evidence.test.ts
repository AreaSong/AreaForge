import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveStorageQuotaEvidence, storageReleaseCoverage } from "./storage-quota-evidence";

test("STORAGE 释放缺口只由完整双文件形态的阶段证据关闭", () => {
  const names = ["precommit-sigkill", "precommit-commit", "concurrent-commit", "concurrent-rollback", "concurrent-released"]
    .flatMap(prefix => ["staging", "final"].map(suffix => prefix + "-" + suffix));
  const record = { stage: "1B-4", sourceFingerprint: "test", checkedAt: "test", status: "complete",
    passed: ["canonical-55-migration-ledger", "prior-objects-and-files-unchanged", ...names],
    cases: names.map(name => ({ case: name, totalUnlinks: 1, committedReleaseCas: 1 })) };
  assert.deepEqual(storageReleaseCoverage(record), { precommit: true, concurrent: true });
  assert.deepEqual(storageReleaseCoverage(undefined), { precommit: false, concurrent: false });
  assert.deepEqual(storageReleaseCoverage({ ...record, stage: "1B-3" }), { precommit: false, concurrent: false });
  assert.deepEqual(storageReleaseCoverage({ ...record, status: "partial" }), { precommit: false, concurrent: false });
  assert.deepEqual(storageReleaseCoverage({ ...record, cases: record.cases.slice(1) }), { precommit: false, concurrent: true });
  assert.deepEqual(storageReleaseCoverage({ ...record, passed: record.passed.slice(0, -1) }), { precommit: true, concurrent: false });
  assert.deepEqual(storageReleaseCoverage({ ...record, cases: record.cases.map(row => ({ ...row, totalUnlinks: 2 })) }),
    { precommit: false, concurrent: false });
});

test("普通回归保护失败不能覆盖最后一份完成证据", async () => {
  const original = process.cwd(); const directory = await mkdtemp(path.join(tmpdir(), "areaforge-storage-evidence-"));
  try {
    process.chdir(directory);
    const record = { stage: "1A", sourceFingerprint: "test-before", checkedAt: "test", status: "complete",
      visibilityBefore: "40", visibilityAfter: "40" };
    await saveStorageQuotaEvidence(record);
    const file = path.join(directory, "output/storage-quota/runtime-evidence.json");
    const before = await readFile(file, "utf8");
    for (const stage of ["1A", "1B-1", "1B-4"]) {
      await assert.rejects(saveStorageQuotaEvidence({ ...record, stage, sourceFingerprint: "test-failed", visibilityAfter: "41" }),
        /STORAGE_EVIDENCE_PRIOR_PROTECTION/);
      assert.equal(await readFile(file, "utf8"), before);
    }
  } finally { process.chdir(original); await rm(directory, { recursive: true, force: true }); }
});

import { storageOmitCases, storageOmitCoverage } from "./storage-quota-evidence";
test("omit 缺口要求完整矩阵、精确代次和单次写入证据；失败不覆盖", async () => {
  const record = { stage: "1B-5", sourceFingerprint: "test-omit", checkedAt: "test", status: "complete",
    passed: ["canonical-55-migration-ledger", "prior-objects-and-files-unchanged", ...storageOmitCases],
    visibilityBefore: "40", visibilityAfter: "52", expectedVisibilityDelta: "12",
    cases: [{ case: "mutation-single-execution", rows: 1, revision: 3 }, { case: "generation-read-retry", queries: 2 },
      { case: "generation-mutation-committed-response-rejected", queries: 1, mutationCommitted: true, automaticWriteReplay: false }] };
  assert.equal(storageOmitCoverage(record), true); assert.equal(storageOmitCoverage(undefined), false);
  const directory = await mkdtemp(path.join(tmpdir(), "areaforge-storage-evidence-")); const original = process.cwd();
  try {
    process.chdir(directory); await saveStorageQuotaEvidence(record);
    const file = path.join(directory, "output/storage-quota/runtime-evidence.json"); const saved = await readFile(file, "utf8");
    assert.equal(JSON.parse(saved).deferred.includes("prisma-omit-runtime"), false);
    for (const patch of [{ passed: record.passed.slice(1) }, { visibilityAfter: "51" }, { cases: record.cases.slice(1) }, { expectedVisibilityDelta: "11" }]) {
      assert.equal(storageOmitCoverage({ ...record, ...patch }), false);
      await assert.rejects(saveStorageQuotaEvidence({ ...record, ...patch }), /STORAGE_EVIDENCE_OMIT_PROTECTION/);
      assert.equal(await readFile(file, "utf8"), saved);
    }
    await saveStorageQuotaEvidence({ stage: "1A", status: "complete", sourceFingerprint: "new-source", checkedAt: "test", visibilityBefore: "50", visibilityAfter: "50" });
    const next = JSON.parse(await readFile(file, "utf8"));
    assert.equal(next.deferred.includes("prisma-omit-runtime"), true);
    assert.equal(next.history[0].sourceFingerprint, record.sourceFingerprint);
  } finally { process.chdir(original); await rm(directory, { recursive: true, force: true }); }
});
