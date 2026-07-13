import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildAttachmentReconciliationSummary,
  computeAttachmentReconciliationSummaryHash,
  validateAttachmentReconciliationSummary,
  writeReconciliationReport,
} from "./attachment-reconciliation-summary";

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-attachment-summary-"));
  try {
    const uploadDir = path.join(root, "uploads");
    mkdirSync(uploadDir);
    const storedName = "abcdefghijklmnop.pdf";
    writeFileSync(path.join(uploadDir, storedName), "pdf");
    const passCsv = csvRow(storedName, "true", "true", "true");
    const pass = await buildAttachmentReconciliationSummary(uploadDir, passCsv, "2026-07-13T00:00:00Z");
    assert(pass.status === "pass", "matching database/file state should pass");
    assert(validateAttachmentReconciliationSummary(JSON.stringify(pass), passCsv).length === 0, "pass summary should validate");

    const missing = await buildAttachmentReconciliationSummary(uploadDir, csvRow("missing-file.pdf", "false", "false", "false"));
    assert(missing.status === "mismatch" && missing.counts.dbOnlyCount === 1, "missing file should be DB-only mismatch");

    const orphanName = "qrstuvwxyzABCDEF.png";
    writeFileSync(path.join(uploadDir, orphanName), "orphan");
    const orphan = await buildAttachmentReconciliationSummary(uploadDir, passCsv);
    assert(orphan.counts.fileOnlyCount === 1, "orphan file should be detected");

    const mismatch = await buildAttachmentReconciliationSummary(uploadDir, csvRow(storedName, "true", "false", "false"));
    assert(mismatch.counts.hashMismatchCount === 1 && mismatch.counts.sizeMismatchCount === 1, "hash and size mismatches should be counted");

    symlinkSync(path.join(uploadDir, storedName), path.join(uploadDir, "symlink-entry.pdf"));
    const unsafe = await buildAttachmentReconciliationSummary(uploadDir, passCsv);
    assert(unsafe.counts.unsafeEntryCount === 1, "symlink should be unsafe");

    const tampered = { ...pass, summaryHash: `sha256:${"0".repeat(64)}` };
    assert(validateAttachmentReconciliationSummary(JSON.stringify(tampered), passCsv).includes("summaryHash does not match canonical content"), "tampered summary hash should fail");

    const forgedCounts = { ...pass, counts: { ...pass.counts, databaseRecordCount: 2 } };
    forgedCounts.summaryHash = computeAttachmentReconciliationSummaryHash(forgedCounts);
    assert(validateAttachmentReconciliationSummary(JSON.stringify(forgedCounts), passCsv).includes("databaseRecordCount does not match reconciliation CSV"), "CSV-derived counts must not be forgeable");

    const duplicateCsv = [passCsv.trimEnd(), passCsv.split("\n")[1], ""].join("\n");
    const duplicate = await buildAttachmentReconciliationSummary(uploadDir, duplicateCsv);
    assert(duplicate.counts.duplicateReferenceCount === 1 && duplicate.status === "mismatch", "duplicate file references should be mismatches");

    await assertRejects(() => buildAttachmentReconciliationSummary(uploadDir, passCsv.replace("report_only", "delete")), "non-report_only CSV must fail closed");

    const multilineCsv = passCsv.replace(
      `upload://attachment/${storedName}`,
      `"upload://attachment/invalid\nname.pdf"`,
    );
    const multiline = await buildAttachmentReconciliationSummary(uploadDir, multilineCsv);
    assert(multiline.counts.invalidUriCount === 1, "quoted multiline CSV fields should parse as one record");

    const reportPath = path.join(root, "reports", "summary.json");
    await writeReconciliationReport(uploadDir, reportPath, "report\n");
    assert(readFileSync(reportPath, "utf8") === "report\n", "report should be atomically written outside UPLOAD_DIR");
    await assertRejects(() => writeReconciliationReport(uploadDir, path.join(uploadDir, "overwrite.pdf"), "unsafe"), "reports inside UPLOAD_DIR must fail closed");
    await assertRejects(() => writeReconciliationReport(uploadDir, reportPath, "unsafe", [reportPath]), "identical report paths must fail closed");

    const reportSymlink = path.join(root, "report-link.json");
    symlinkSync(path.join(uploadDir, storedName), reportSymlink);
    await assertRejects(() => writeReconciliationReport(uploadDir, reportSymlink, "unsafe"), "symlink report targets must fail closed");

    const uploadAlias = path.join(root, "uploads-alias");
    symlinkSync(uploadDir, uploadAlias);
    await assertRejects(() => buildAttachmentReconciliationSummary(uploadAlias, passCsv), "symlink upload roots must fail closed");
    console.log("attachment reconciliation summary selftest passed.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function csvRow(storedName: string, exists: string, sizeMatches: string, hashMatches: string): string {
  const hash = "a".repeat(64);
  return [
    "attachmentId,noteId,uri,metadataHash,fileHash,metadataSizeBytes,fileSizeBytes,exists,sizeMatches,hashMatches,action",
    `att1,note1,upload://attachment/${storedName},${hash},${exists === "true" ? hash : ""},3,${exists === "true" ? "3" : ""},${exists},${sizeMatches},${hashMatches},report_only`,
    "",
  ].join("\n");
}

async function assertRejects(run: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await main();
