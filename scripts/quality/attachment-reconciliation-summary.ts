import { createHash } from "node:crypto";
import { constants, existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isPathInsideDirectory, parseAttachmentUri } from "../../packages/storage/src/index";

type ReconciliationRow = Record<string, string>;

export const attachmentReconciliationHeader = [
  "attachmentId",
  "noteId",
  "uri",
  "metadataHash",
  "fileHash",
  "metadataSizeBytes",
  "fileSizeBytes",
  "exists",
  "sizeMatches",
  "hashMatches",
  "action",
] as const;

const countKeys = [
  "databaseRecordCount",
  "uploadFileCount",
  "dbOnlyCount",
  "fileOnlyCount",
  "hashMismatchCount",
  "sizeMismatchCount",
  "invalidUriCount",
  "duplicateReferenceCount",
  "unsafeEntryCount",
  "unexpectedEntryCount",
] as const;

const requiredDoesNotProve = [
  "automatic orphan cleanup",
  "attachment metadata repair",
  "backup restore success outside the scanned directory",
  "production health",
] as const;

export type AttachmentReconciliationSummary = {
  schemaVersion: 1;
  mode: "read_only_attachment_reconciliation_summary";
  generatedAt: string;
  status: "pass" | "mismatch";
  action: "report_only";
  source: {
    reconciliationCsvSha256: string;
    uploadDirectory: "configured_private_upload_directory";
  };
  counts: {
    databaseRecordCount: number;
    uploadFileCount: number;
    dbOnlyCount: number;
    fileOnlyCount: number;
    hashMismatchCount: number;
    sizeMismatchCount: number;
    invalidUriCount: number;
    duplicateReferenceCount: number;
    unsafeEntryCount: number;
    unexpectedEntryCount: number;
  };
  fileOnlyEntryHashes: string[];
  unsafeEntryHashes: string[];
  doesNotProve: string[];
  safetyFacts: {
    readOnly: true;
    databaseWriteAttempted: false;
    uploadWriteAttempted: false;
    fileDeleted: false;
    fileMoved: false;
    metadataRepaired: false;
    fileContentIncluded: false;
    absolutePathIncluded: false;
    secretValuePrinted: false;
  };
  summaryHash: string;
};

export async function buildAttachmentReconciliationSummary(
  uploadDir: string,
  csvRaw: string,
  generatedAt = new Date().toISOString(),
): Promise<AttachmentReconciliationSummary> {
  const uploadRoot = await resolveSafeUploadRoot(uploadDir);
  const rows = parseCsv(csvRaw);
  const referencedNames = new Set<string>();
  const duplicateReferences = new Set<string>();
  let invalidUriCount = 0;
  let dbOnlyCount = 0;
  let hashMismatchCount = 0;
  let sizeMismatchCount = 0;

  for (const row of rows) {
    const storedName = parseAttachmentUri(row.uri ?? "");
    if (storedName) {
      if (referencedNames.has(storedName)) duplicateReferences.add(storedName);
      referencedNames.add(storedName);
    } else {
      invalidUriCount += 1;
    }
    if (row.exists !== "true") dbOnlyCount += 1;
    if (row.hashMatches !== "true") hashMismatchCount += 1;
    if (row.sizeMatches !== "true") sizeMismatchCount += 1;
  }

  const entries = await readdir(uploadRoot, { withFileTypes: true });
  const fileOnlyEntryHashes: string[] = [];
  const unsafeEntryHashes: string[] = [];
  let uploadFileCount = 0;
  let unexpectedEntryCount = 0;

  for (const entry of entries) {
    const entryHash = sha256(entry.name);
    const entryPath = path.join(uploadRoot, entry.name);
    const stat = await lstat(entryPath);
    if (stat.isSymbolicLink()) {
      unsafeEntryHashes.push(entryHash);
      continue;
    }
    if (!stat.isFile()) {
      unexpectedEntryCount += 1;
      unsafeEntryHashes.push(entryHash);
      continue;
    }
    const storedName = parseAttachmentUri(`upload://attachment/${entry.name}`);
    if (!storedName) {
      unsafeEntryHashes.push(entryHash);
      continue;
    }
    uploadFileCount += 1;
    if (!referencedNames.has(storedName)) fileOnlyEntryHashes.push(entryHash);
  }

  fileOnlyEntryHashes.sort();
  unsafeEntryHashes.sort();
  const counts = {
    databaseRecordCount: rows.length,
    uploadFileCount,
    dbOnlyCount,
    fileOnlyCount: fileOnlyEntryHashes.length,
    hashMismatchCount,
    sizeMismatchCount,
    invalidUriCount,
    duplicateReferenceCount: duplicateReferences.size,
    unsafeEntryCount: unsafeEntryHashes.length,
    unexpectedEntryCount,
  };
  const mismatch = Object.entries(counts)
    .filter(([key]) => !["databaseRecordCount", "uploadFileCount"].includes(key))
    .some(([, value]) => value > 0);
  const resultWithoutHash = {
    schemaVersion: 1 as const,
    mode: "read_only_attachment_reconciliation_summary" as const,
    generatedAt,
    status: mismatch ? "mismatch" as const : "pass" as const,
    action: "report_only" as const,
    source: {
      reconciliationCsvSha256: `sha256:${sha256(csvRaw)}`,
      uploadDirectory: "configured_private_upload_directory" as const,
    },
    counts,
    fileOnlyEntryHashes,
    unsafeEntryHashes,
    doesNotProve: [...requiredDoesNotProve],
    safetyFacts: {
      readOnly: true as const,
      databaseWriteAttempted: false as const,
      uploadWriteAttempted: false as const,
      fileDeleted: false as const,
      fileMoved: false as const,
      metadataRepaired: false as const,
      fileContentIncluded: false as const,
      absolutePathIncluded: false as const,
      secretValuePrinted: false as const,
    },
  };
  return { ...resultWithoutHash, summaryHash: computeAttachmentReconciliationSummaryHash(resultWithoutHash) };
}

export async function resolveSafeUploadRoot(uploadDir: string): Promise<string> {
  if (!path.isAbsolute(uploadDir)) throw new Error("UPLOAD_DIR must be absolute");
  const lexicalRoot = path.resolve(uploadDir);
  if (lexicalRoot === path.parse(lexicalRoot).root) throw new Error("UPLOAD_DIR must not be the filesystem root");
  const rootStat = await lstat(lexicalRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("UPLOAD_DIR must be a real directory, not a symlink");
  return realpath(lexicalRoot);
}

export async function writeReconciliationReport(
  uploadDir: string,
  outputPath: string,
  content: string,
  reservedPaths: readonly string[] = [],
): Promise<void> {
  const uploadRoot = await resolveSafeUploadRoot(uploadDir);
  const absoluteOutput = path.resolve(outputPath);
  if (reservedPaths.some((reserved) => path.resolve(reserved) === absoluteOutput)) {
    throw new Error("reconciliation report paths must be distinct");
  }
  if (isPathInsideDirectory(uploadRoot, absoluteOutput)) {
    throw new Error("reconciliation reports must be written outside UPLOAD_DIR");
  }
  const parent = path.dirname(absoluteOutput);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  const resolvedOutput = path.join(resolvedParent, path.basename(absoluteOutput));
  for (const reserved of reservedPaths) {
    const reservedParent = path.dirname(path.resolve(reserved));
    if (existsSync(reservedParent)) {
      const resolvedReserved = path.join(await realpath(reservedParent), path.basename(reserved));
      if (resolvedReserved === resolvedOutput) throw new Error("reconciliation report paths must be distinct");
    }
  }
  if (isPathInsideDirectory(uploadRoot, resolvedOutput)) {
    throw new Error("reconciliation reports must be written outside UPLOAD_DIR");
  }
  if (existsSync(resolvedOutput)) {
    const outputStat = await lstat(resolvedOutput);
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) throw new Error("reconciliation report target must be a regular file");
  }

  const temporaryPath = path.join(resolvedParent, `.${path.basename(resolvedOutput)}.${process.pid}.${Date.now()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, resolvedOutput);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function validateAttachmentReconciliationSummary(
  raw: string,
  expectedCsvRaw?: string,
): string[] {
  const issues: string[] = [];
  let body: AttachmentReconciliationSummary;
  try {
    body = JSON.parse(raw) as AttachmentReconciliationSummary;
  } catch {
    return ["summary must be valid JSON"];
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["summary must be a JSON object"];
  const expectedTopLevelKeys = ["schemaVersion", "mode", "generatedAt", "status", "action", "source", "counts", "fileOnlyEntryHashes", "unsafeEntryHashes", "doesNotProve", "safetyFacts", "summaryHash"].sort();
  if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(expectedTopLevelKeys)) issues.push("summary fields are incomplete or unknown");
  if (body.schemaVersion !== 1) issues.push("schemaVersion must be 1");
  if (body.mode !== "read_only_attachment_reconciliation_summary") issues.push("mode is invalid");
  if (!Number.isFinite(Date.parse(body.generatedAt))) issues.push("generatedAt must be ISO timestamp");
  if (!(["pass", "mismatch"] as const).includes(body.status)) issues.push("status is invalid");
  if (body.action !== "report_only") issues.push("action must be report_only");
  if (!/^sha256:[a-f0-9]{64}$/i.test(body.source?.reconciliationCsvSha256 ?? "")) issues.push("CSV hash is invalid");
  if (JSON.stringify(Object.keys(body.source ?? {}).sort()) !== JSON.stringify(["reconciliationCsvSha256", "uploadDirectory"].sort())) issues.push("source fields are incomplete or unknown");
  if (body.source?.uploadDirectory !== "configured_private_upload_directory") issues.push("uploadDirectory source is invalid");
  const countEntries = Object.entries(body.counts ?? {});
  const actualCountKeys = countEntries.map(([key]) => key).sort();
  const expectedCountKeys = [...countKeys].sort();
  if (JSON.stringify(actualCountKeys) !== JSON.stringify(expectedCountKeys) || countEntries.some(([, value]) => !Number.isInteger(value) || value < 0)) {
    issues.push("counts must contain the exact reconciliation count keys with non-negative integers");
  }
  if (body.counts?.fileOnlyCount !== body.fileOnlyEntryHashes?.length) issues.push("fileOnlyCount must match fileOnlyEntryHashes");
  if (body.counts?.unsafeEntryCount !== body.unsafeEntryHashes?.length) issues.push("unsafeEntryCount must match unsafeEntryHashes");
  validateHashList(body.fileOnlyEntryHashes, "fileOnlyEntryHashes", issues);
  validateHashList(body.unsafeEntryHashes, "unsafeEntryHashes", issues);
  if (JSON.stringify(body.doesNotProve) !== JSON.stringify(requiredDoesNotProve)) issues.push("doesNotProve is invalid");
  const mismatch = countEntries
    .filter(([key]) => !["databaseRecordCount", "uploadFileCount"].includes(key))
    .some(([, value]) => value > 0);
  if (body.status !== (mismatch ? "mismatch" : "pass")) issues.push("status must derive from mismatch counts");
  const expectedSafetyFacts: AttachmentReconciliationSummary["safetyFacts"] = {
    readOnly: true,
    databaseWriteAttempted: false,
    uploadWriteAttempted: false,
    fileDeleted: false,
    fileMoved: false,
    metadataRepaired: false,
    fileContentIncluded: false,
    absolutePathIncluded: false,
    secretValuePrinted: false,
  };
  const safetyKeys = Object.keys(expectedSafetyFacts).sort();
  if (JSON.stringify(Object.keys(body.safetyFacts ?? {}).sort()) !== JSON.stringify(safetyKeys) ||
    safetyKeys.some((key) => body.safetyFacts?.[key as keyof typeof expectedSafetyFacts] !== expectedSafetyFacts[key as keyof typeof expectedSafetyFacts])) {
    issues.push("safety facts are invalid");
  }
  if (expectedCsvRaw !== undefined) {
    if (body.source?.reconciliationCsvSha256 !== `sha256:${sha256(expectedCsvRaw)}`) issues.push("CSV hash does not match");
    try {
      const csvCounts = deriveCsvCounts(parseCsv(expectedCsvRaw));
      for (const key of ["databaseRecordCount", "dbOnlyCount", "hashMismatchCount", "sizeMismatchCount", "invalidUriCount", "duplicateReferenceCount"] as const) {
        if (body.counts?.[key] !== csvCounts[key]) issues.push(`${key} does not match reconciliation CSV`);
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "reconciliation CSV is invalid");
    }
  }
  const { summaryHash: _summaryHash, ...withoutHash } = body;
  if (body.summaryHash !== computeAttachmentReconciliationSummaryHash(withoutHash)) issues.push("summaryHash does not match canonical content");
  return issues;
}

export function parseAttachmentReconciliationCsv(raw: string): ReconciliationRow[] {
  return parseCsv(raw);
}

function parseCsv(raw: string): ReconciliationRow[] {
  const records = parseCsvRecords(raw);
  if (records.length === 0) throw new Error("reconciliation CSV is empty");
  const headers = records[0] ?? [];
  if (JSON.stringify(headers) !== JSON.stringify(attachmentReconciliationHeader)) {
    throw new Error("reconciliation CSV header is invalid");
  }
  return records.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`reconciliation CSV line ${index + 2} has an invalid column count`);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    validateCsvRow(row, index + 2);
    return row;
  });
}

function validateCsvRow(row: ReconciliationRow, lineNumber: number): void {
  if (!row.attachmentId) throw new Error(`reconciliation CSV line ${lineNumber} is missing attachmentId`);
  if (row.action !== "report_only") throw new Error(`reconciliation CSV line ${lineNumber} action must be report_only`);
  for (const key of ["exists", "sizeMatches", "hashMatches"] as const) {
    if (!["true", "false"].includes(row[key] ?? "")) throw new Error(`reconciliation CSV line ${lineNumber} ${key} must be true or false`);
  }
  if (!/^[a-f0-9]{64}$/i.test(row.metadataHash ?? "")) throw new Error(`reconciliation CSV line ${lineNumber} metadataHash is invalid`);
  if (row.fileHash && !/^[a-f0-9]{64}$/i.test(row.fileHash)) throw new Error(`reconciliation CSV line ${lineNumber} fileHash is invalid`);
  if (!/^\d+$/.test(row.metadataSizeBytes ?? "")) throw new Error(`reconciliation CSV line ${lineNumber} metadataSizeBytes is invalid`);
  if (row.fileSizeBytes && !/^\d+$/.test(row.fileSizeBytes)) throw new Error(`reconciliation CSV line ${lineNumber} fileSizeBytes is invalid`);
  if (row.exists === "false" && (row.fileHash || row.fileSizeBytes || row.sizeMatches !== "false" || row.hashMatches !== "false")) {
    throw new Error(`reconciliation CSV line ${lineNumber} missing-file flags are inconsistent`);
  }
  if (row.exists === "true" && (!row.fileHash || !row.fileSizeBytes)) {
    throw new Error(`reconciliation CSV line ${lineNumber} existing-file evidence is incomplete`);
  }
}

function deriveCsvCounts(rows: ReconciliationRow[]): Pick<AttachmentReconciliationSummary["counts"], "databaseRecordCount" | "dbOnlyCount" | "hashMismatchCount" | "sizeMismatchCount" | "invalidUriCount" | "duplicateReferenceCount"> {
  const references = new Set<string>();
  const duplicates = new Set<string>();
  let dbOnlyCount = 0;
  let hashMismatchCount = 0;
  let sizeMismatchCount = 0;
  let invalidUriCount = 0;
  for (const row of rows) {
    const storedName = parseAttachmentUri(row.uri ?? "");
    if (!storedName) invalidUriCount += 1;
    else if (references.has(storedName)) duplicates.add(storedName);
    if (storedName) references.add(storedName);
    if (row.exists !== "true") dbOnlyCount += 1;
    if (row.hashMatches !== "true") hashMismatchCount += 1;
    if (row.sizeMatches !== "true") sizeMismatchCount += 1;
  }
  return {
    databaseRecordCount: rows.length,
    dbOnlyCount,
    hashMismatchCount,
    sizeMismatchCount,
    invalidUriCount,
    duplicateReferenceCount: duplicates.size,
  };
}

function validateHashList(value: unknown, label: string, issues: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^[a-f0-9]{64}$/i.test(item))) {
    issues.push(`${label} must contain sha256 hex values`);
    return;
  }
  const normalized = value.map((item) => item.toLowerCase());
  if (new Set(normalized).size !== normalized.length) issues.push(`${label} must not contain duplicates`);
  if (JSON.stringify(normalized) !== JSON.stringify([...normalized].sort())) issues.push(`${label} must be sorted`);
}

function parseCsvRecords(raw: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"') {
      if (quoted && raw[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && raw[index + 1] === "\n") index += 1;
      cells.push(value);
      if (cells.some((cell) => cell.length > 0)) records.push(cells);
      cells = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (quoted) throw new Error("reconciliation CSV contains an unterminated quote");
  cells.push(value);
  if (cells.some((cell) => cell.length > 0)) records.push(cells);
  return records;
}

export function computeAttachmentReconciliationSummaryHash(value: Record<string, unknown>): string {
  const { summaryHash: _summaryHash, ...withoutHash } = value;
  return `sha256:${sha256(canonicalJson(withoutHash))}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const [uploadDir, csvPath, outputPath] = process.argv.slice(2).filter((arg) => arg !== "--");
  if (!uploadDir || !csvPath || !outputPath || !existsSync(csvPath)) {
    console.error("Usage: pnpm attachment:reconciliation:summary <upload-dir> <reconciliation.csv> <summary.json>");
    process.exit(2);
  }
  const csvRaw = readFileSync(csvPath, "utf8");
  const summary = await buildAttachmentReconciliationSummary(path.resolve(uploadDir), csvRaw);
  await writeReconciliationReport(uploadDir, outputPath, `${JSON.stringify(summary, null, 2)}\n`, [csvPath]);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== "pass") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown reconciliation summary error";
    console.error(`attachment reconciliation summary failed: ${message}`);
    process.exitCode = /^(UPLOAD_DIR|reconciliation CSV|reconciliation report)/.test(message) ? 2 : 3;
  }
}
