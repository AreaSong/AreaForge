import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Evidence = { stage: string; sourceFingerprint: string; checkedAt: string; [key: string]: unknown };
export const storageOmitCases = ["native-projection-equivalence", "frozen-root-owner-workspace-pagination-count",
  "required-and-optional-relations", "positive-internal-identity-projection", "mutation-single-execution",
  "interactive-and-batch-transactions", "generation-read-retry", "generation-mutation-committed-response-rejected",
  "logical-restore-projection", "existing-required-relation-consumer", "consumer-failure-restores-freeze"];
export function storageOmitCoverage(record: Evidence | undefined): boolean {
  const passed = Array.isArray(record?.passed) ? record.passed : [];
  const cases = Array.isArray(record?.cases) ? record.cases : [];
  return record?.stage === "1B-5" && record.status === "complete"
    && ["canonical-55-migration-ledger", "prior-objects-and-files-unchanged", ...storageOmitCases].every(name => passed.includes(name))
    && typeof record.visibilityBefore === "string" && /^(0|[1-9][0-9]*)$/.test(record.visibilityBefore)
    && typeof record.visibilityAfter === "string" && /^(0|[1-9][0-9]*)$/.test(record.visibilityAfter)
    && record.expectedVisibilityDelta === "12" && BigInt(record.visibilityAfter) - BigInt(record.visibilityBefore) === 12n
    && cases.some(row => row.case === "mutation-single-execution" && row.rows === 1 && row.revision === 3)
    && cases.some(row => row.case === "generation-read-retry" && row.queries === 2)
    && cases.some(row => row.case === "generation-mutation-committed-response-rejected" && row.queries === 1 && row.mutationCommitted === true && row.automaticWriteReplay === false);
}
export function storageReleaseCoverage(record: Evidence | undefined) {
  const passed = Array.isArray(record?.passed) ? record.passed : [];
  const cases = Array.isArray(record?.cases) ? record.cases : [];
  const base = record?.stage === "1B-4" && record.status === "complete" && passed.includes("canonical-55-migration-ledger")
    && passed.includes("prior-objects-and-files-unchanged");
  const covered = (prefixes: string[]) => base && prefixes.every(prefix => ["staging", "final"].every(suffix => {
    const name = prefix + "-" + suffix;
    return passed.includes(name) && cases.some(row => row.case === name && row.totalUnlinks === 1 && row.committedReleaseCas === 1);
  }));
  return { precommit: covered(["precommit-sigkill", "precommit-commit"]),
    concurrent: covered(["concurrent-commit", "concurrent-rollback", "concurrent-released"]) };
}
/** 保留阶段原始记录；聚合的 currentStages 只收录本次同指纹证据。 */
export async function saveStorageQuotaEvidence(record: Evidence) {
  if (record.stage === "1B-5" && record.status === "complete" && !storageOmitCoverage(record)) throw new Error("STORAGE_EVIDENCE_OMIT_PROTECTION");
  if (["1A", "1B-1", "1B-4"].includes(record.stage) && record.status === "complete"
    && (typeof record.visibilityBefore !== "string" || !/^(0|[1-9][0-9]*)$/.test(record.visibilityBefore)
      || record.visibilityBefore !== record.visibilityAfter)) throw new Error("STORAGE_EVIDENCE_PRIOR_PROTECTION");
  const file = path.resolve("output/storage-quota/runtime-evidence.json");
  let history: Evidence[] = [];
  try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    history = previous.schemaVersion === 2 ? previous.history : [previous];
    if (!Array.isArray(history)) throw new Error("STORAGE_EVIDENCE_INVALID");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  history.push(record);
  const currentStages: Record<string, Evidence> = {};
  for (const entry of history) if (entry.sourceFingerprint === record.sourceFingerprint) currentStages[entry.stage] = entry;
  const release = storageReleaseCoverage(currentStages["1B-4"]);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ schemaVersion: 2, scope: "STORAGE stage-specific local evidence",
    sourceFingerprint: record.sourceFingerprint, checkedAt: record.checkedAt, overallStorageStatus: "partial", currentStages, history,
    deferred: ["dependency-audit", ...(currentStages["1B-2"]?.status === "complete" ? [] : ["1B-2-freeze-deletion"]),
      ...(currentStages["1B-3"]?.status === "complete" ? [] : ["trusted-ledger-restore"]),
      ...(release.precommit ? [] : ["release-cas-precommit"]), ...(release.concurrent ? [] : ["concurrent-release-cas"]),
      ...(storageOmitCoverage(currentStages["1B-5"]) ? [] : ["prisma-omit-runtime"]), "full-browser", "final-source-package-validation"], productionTouched: false }, null, 2) + "\n");
}
