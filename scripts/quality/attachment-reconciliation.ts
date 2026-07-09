import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPrismaClient } from "../../packages/db/src/index";
import { createSafeAttachmentFilePath, isPathInsideDirectory, parseAttachmentUri } from "../../packages/storage/src/index";

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
  const { uploadDir, outputPath, databaseUrl } = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient(databaseUrl);

  try {
    const rows = await buildRows(uploadDir, prisma);
    const csv = serializeCsv(rows);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, csv, { encoding: "utf8", flag: "w" });

    const mismatches = rows.filter((row) =>
      row.exists !== "true" || row.sizeMatches !== "true" || row.hashMatches !== "true",
    );
    console.log(`attachment reconciliation wrote ${rows.length} row(s) to ${outputPath}; mismatches=${mismatches.length}; action=report_only`);

    if (mismatches.length > 0) {
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

  if (!existsSync(safePath.filePath)) return null;

  try {
    const root = await realpath(safePath.uploadRoot);
    const fileStat = await lstat(safePath.filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) return null;

    const resolvedFile = await realpath(safePath.filePath);
    if (!isPathInsideDirectory(root, resolvedFile)) return null;

    return await readFile(resolvedFile);
  } catch {
    return null;
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

function parseArgs(args: string[]): { uploadDir: string; outputPath: string; databaseUrl: string | undefined } {
  const databaseUrlFlag = args.indexOf("--database-url");
  const databaseUrl = databaseUrlFlag >= 0 ? args[databaseUrlFlag + 1] : undefined;
  const positional = args.filter((_, index) =>
    databaseUrlFlag >= 0 ? index !== databaseUrlFlag && index !== databaseUrlFlag + 1 : true,
  );
  const [uploadDir, outputPath] = positional;

  if (!uploadDir || !outputPath || (databaseUrlFlag >= 0 && !databaseUrl)) {
    console.error("Usage: pnpm exec tsx scripts/quality/attachment-reconciliation.ts <upload-dir> <output-csv> [--database-url <DATABASE_URL>]");
    process.exit(2);
  }

  if (!path.isAbsolute(uploadDir)) {
    console.error("UPLOAD_DIR must be an absolute path.");
    process.exit(2);
  }

  return {
    uploadDir: path.resolve(uploadDir),
    outputPath: path.resolve(outputPath),
    databaseUrl,
  };
}

await main();
