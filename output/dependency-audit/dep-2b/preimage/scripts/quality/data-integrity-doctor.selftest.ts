import {
  buildDataIntegrityDoctor,
  computeDataIntegrityDoctorHash,
  sanitizeDataIntegrityDoctorFailure,
  type DataIntegritySnapshot,
} from "../ops/data-integrity-doctor";
import { validateDataIntegrityDoctor } from "./data-integrity-doctor-validate";
import type { AttachmentReconciliationSummary } from "./attachment-reconciliation-summary";

const cleanSnapshot: DataIntegritySnapshot = {
  activeSessionCount: 1,
  staleActiveSessionCount: 0,
  runningWithPausedAtCount: 0,
  pausedWithoutPausedAtCount: 0,
  activeWithEndedAtCount: 0,
  terminalWithoutEndedAtCount: 0,
  terminalWithPausedAtCount: 0,
  negativeSessionMetricsCount: 0,
  doneWithoutCompletedAtCount: 0,
  nonDoneWithCompletedAtCount: 0,
  doneWithDebtCount: 0,
  negativeTaskMinutesCount: 0,
};

function main(): void {
  const clean = buildDataIntegrityDoctor({
    snapshot: cleanSnapshot,
    attachmentSummary: attachmentSummary("pass"),
    generatedAt: "2026-07-15T00:00:00.000Z",
    databaseReadAttempted: false,
  });
  assert(clean.status.overall === "pass" && clean.status.native === "integrity_clean", "clean snapshot should pass");
  assert(clean.counts.total === 5 && clean.counts.pass === 5, "clean check counts should be exact");
  assert(clean.safetyFacts.networkRequested === false && clean.safetyFacts.databaseWriteAttempted === false, "fixture safety facts should stay read-only");
  assert(/^sha256:[a-f0-9]{64}$/.test(clean.doctorHash), "doctor hash should be canonical sha256");
  assert(validateDataIntegrityDoctor(JSON.stringify(clean)).length === 0, "clean doctor output should validate");

  const failed = buildDataIntegrityDoctor({
    snapshot: {
      ...cleanSnapshot,
      activeSessionCount: 2,
      pausedWithoutPausedAtCount: 1,
      doneWithoutCompletedAtCount: 1,
      nonDoneWithCompletedAtCount: 1,
    },
    attachmentSummary: attachmentSummary("mismatch"),
    generatedAt: "2026-07-15T00:00:00.000Z",
    databaseReadAttempted: false,
  });
  assert(failed.status.overall === "fail" && failed.counts.fail === 4, "conflicting state and attachment mismatch should fail four checks");
  assert(failed.checks.every((item) => !JSON.stringify(item).includes("task title")), "doctor output must not include object content");

  const partial = buildDataIntegrityDoctor({
    snapshot: { ...cleanSnapshot, staleActiveSessionCount: 1 },
    generatedAt: "2026-07-15T00:00:00.000Z",
    databaseReadAttempted: false,
  });
  assert(partial.status.overall === "warn" && partial.status.native === "integrity_attention", "stale session and skipped attachment should warn");
  assert(partial.counts.warn === 1 && partial.counts.skipped === 1, "warning and skipped counts should remain distinct");
  assert(validateDataIntegrityDoctor(JSON.stringify({ ...clean, doctorHash: `sha256:${"0".repeat(64)}` })).includes("doctorHash does not match canonical content"), "tampered doctor hash must fail validation");

  const injectedDetails = clone(clean);
  injectedDetails.checks[0].details.taskId = "task-123";
  rehash(injectedDetails);
  assert(validateDataIntegrityDoctor(JSON.stringify(injectedDetails)).some((issue) => issue.includes("fields are incomplete or unknown")), "object identifiers in details must fail closed even with a recomputed hash");

  const inconsistentSource = clone(clean);
  inconsistentSource.source.database = "configured_read_only_query";
  rehash(inconsistentSource);
  assert(validateDataIntegrityDoctor(JSON.stringify(inconsistentSource)).some((issue) => issue.includes("safetyFacts.networkRequested")), "database source and safety facts must remain consistent");

  const forgedStatus = clone(clean);
  forgedStatus.status.overall = "warn";
  rehash(forgedStatus);
  assert(validateDataIntegrityDoctor(JSON.stringify(forgedStatus)).includes("status.overall does not match checks"), "derived status must not be forgeable");

  const forgedAttachment = clone(clean);
  forgedAttachment.checks[4].details.mismatchCount = 1;
  rehash(forgedAttachment);
  assert(validateDataIntegrityDoctor(JSON.stringify(forgedAttachment)).includes("checks[4].status does not match detail counts"), "attachment mismatch counts must not remain pass after rehashing");

  const runtimeFailure = sanitizeDataIntegrityDoctorFailure(new Error("connect ECONNREFUSED database.invalid:5432"));
  assert(runtimeFailure.exitCode === 3 && runtimeFailure.message === "read-only database query failed", "runtime errors must be reduced to a static redacted category");

  console.log("data integrity doctor selftest passed.");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rehash(value: ReturnType<typeof buildDataIntegrityDoctor>): void {
  value.doctorHash = computeDataIntegrityDoctorHash(value as unknown as Record<string, unknown>);
}

function attachmentSummary(status: "pass" | "mismatch"): AttachmentReconciliationSummary {
  const mismatch = status === "mismatch" ? 1 : 0;
  return {
    schemaVersion: 1,
    mode: "read_only_attachment_reconciliation_summary",
    generatedAt: "2026-07-15T00:00:00.000Z",
    status,
    action: "report_only",
    source: {
      reconciliationCsvSha256: `sha256:${"a".repeat(64)}`,
      uploadDirectory: "configured_private_upload_directory",
    },
    counts: {
      databaseRecordCount: 1,
      uploadFileCount: 1,
      dbOnlyCount: mismatch,
      fileOnlyCount: 0,
      hashMismatchCount: 0,
      sizeMismatchCount: 0,
      invalidUriCount: 0,
      duplicateReferenceCount: 0,
      unsafeEntryCount: 0,
      unexpectedEntryCount: 0,
    },
    fileOnlyEntryHashes: [],
    unsafeEntryHashes: [],
    doesNotProve: [
      "automatic orphan cleanup",
      "attachment metadata repair",
      "backup restore success outside the scanned directory",
      "production health",
    ],
    safetyFacts: {
      readOnly: true,
      databaseWriteAttempted: false,
      uploadWriteAttempted: false,
      fileDeleted: false,
      fileMoved: false,
      metadataRepaired: false,
      fileContentIncluded: false,
      absolutePathIncluded: false,
      secretValuePrinted: false,
    },
    summaryHash: `sha256:${"b".repeat(64)}`,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

main();
