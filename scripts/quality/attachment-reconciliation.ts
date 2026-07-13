import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient } from "../../packages/db/src/index";
import { createSafeAttachmentFilePath, parseAttachmentUri } from "../../packages/storage/src/index";
import {
  buildAttachmentReconciliationSummary,
  resolveSafeUploadRoot,
  writeReconciliationReport,
} from "./attachment-reconciliation-summary";

interface AttachmentRow {
  attachmentId: string;
  noteId: string;
  uri: string;
  metadataHash: string;
  fileHash: string;
  metadataSizeBytes: string;
  fileSizeBytes: string;
  exists: string;
  sizeMatches: string;
  hashMatches: string;
  action: "report_only";
}

const header = [
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

async function main(): Promise<void> {
  const { uploadDir, outputPath, summaryOutputPath, databaseUrl } = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient(databaseUrl);

  try {
    const uploadRoot = await resolveSafeUploadRoot(uploadDir);
    if (summaryOutputPath && summaryOutputPath === outputPath) {
      throw new Error("CSV and summary output paths must be distinct");
    }
    const rows = await buildRows(uploadRoot, prisma);
    const csv = serializeCsv(rows);
    const summary = await buildAttachmentReconciliationSummary(uploadRoot, csv);
    await writeReconciliationReport(uploadRoot, outputPath, csv, summaryOutputPath ? [summaryOutputPath] : []);
    if (summaryOutputPath) {
      await writeReconciliationReport(uploadRoot, summaryOutputPath, `${JSON.stringify(summary, null, 2)}\n`, [outputPath]);
    }

    const mismatches = rows.filter((row) =>
      row.exists !== "true" || row.sizeMatches !== "true" || row.hashMatches !== "true",
    );
    console.log(`attachment reconciliation wrote ${rows.length} row(s) to ${outputPath}; mismatches=${mismatches.length}; fileOnly=${summary.counts.fileOnlyCount}; unsafeEntries=${summary.counts.unsafeEntryCount}; action=report_only`);

    if (mismatches.length > 0 || summary.status === "mismatch") {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function buildRows(uploadDir: string, prisma: ReturnType<typeof createPrismaClient>): Promise<AttachmentRow[]> {
  const attachments = await prisma.attachment.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      noteId: true,
      uri: true,
      hash: true,
      sizeBytes: true,
    },
  });

  return Promise.all(
    attachments.map(async (attachment) => {
      const storedName = parseAttachmentUri(attachment.uri);
      const file = storedName ? await readAttachmentFile(uploadDir, storedName) : null;
      const exists = Boolean(file);
      const fileHash = file ? createHash("sha256").update(file).digest("hex") : "";
      const fileSizeBytes = file ? String(file.length) : "";

      return {
        attachmentId: attachment.id,
        noteId: attachment.noteId ?? "",
        uri: attachment.uri,
        metadataHash: attachment.hash,
        fileHash,
        metadataSizeBytes: String(attachment.sizeBytes),
        fileSizeBytes,
        exists: String(exists),
        sizeMatches: String(exists && fileSizeBytes === String(attachment.sizeBytes)),
        hashMatches: String(exists && fileHash === attachment.hash),
        action: "report_only",
      };
    }),
  );
}

async function readAttachmentFile(uploadDir: string, storedName: string): Promise<Buffer | null> {
  let safePath: ReturnType<typeof createSafeAttachmentFilePath>;
  try {
    safePath = createSafeAttachmentFilePath(uploadDir, storedName);
  } catch {
    return null;
  }

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(safePath.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const fileStat = await handle.stat();
    if (!fileStat.isFile()) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function serializeCsv(rows: AttachmentRow[]): string {
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvCell(row[key])).join(",")),
    "",
  ].join("\n");
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function parseArgs(args: string[]): { uploadDir: string; outputPath: string; summaryOutputPath: string | null; databaseUrl: string | undefined } {
  const databaseUrlFlag = args.indexOf("--database-url");
  const databaseUrl = databaseUrlFlag >= 0 ? args[databaseUrlFlag + 1] : undefined;
  const summaryOutputFlag = args.indexOf("--summary-output");
  const summaryOutput = summaryOutputFlag >= 0 ? args[summaryOutputFlag + 1] : undefined;
  const positional = args.filter((_, index) =>
    (databaseUrlFlag < 0 || (index !== databaseUrlFlag && index !== databaseUrlFlag + 1)) &&
    (summaryOutputFlag < 0 || (index !== summaryOutputFlag && index !== summaryOutputFlag + 1)),
  );
  const [uploadDir, outputPath] = positional;

  if (!uploadDir || !outputPath || (databaseUrlFlag >= 0 && !databaseUrl) || (summaryOutputFlag >= 0 && !summaryOutput)) {
    console.error("Usage: pnpm exec tsx scripts/quality/attachment-reconciliation.ts <upload-dir> <output-csv> [--summary-output <summary.json>] [--database-url <DATABASE_URL>]");
    process.exit(2);
  }

  if (!path.isAbsolute(uploadDir)) {
    console.error("UPLOAD_DIR must be an absolute path.");
    process.exit(2);
  }

  return {
    uploadDir: path.resolve(uploadDir),
    outputPath: path.resolve(outputPath),
    summaryOutputPath: summaryOutput ? path.resolve(summaryOutput) : null,
    databaseUrl,
  };
}

try {
  await main();
} catch (error) {
  console.error(`attachment reconciliation failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 3;
}
