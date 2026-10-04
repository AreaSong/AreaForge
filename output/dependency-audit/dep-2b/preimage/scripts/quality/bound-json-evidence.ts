import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import { TextDecoder } from "node:util";
import { scanForSecrets, type ValidationIssue } from "./record-validator-common";

const maxEvidenceBytes = 1024 * 1024;

export type BoundJsonEvidence = {
  value: unknown;
  raw: string;
  absolutePath: string;
  contentHash: string;
};

export type BoundJsonEvidenceOptions = {
  baseDir: string;
  relativeFile: string;
  recordedHash: string;
  field: string;
  hashField?: string;
  issues: ValidationIssue[];
};

export function readBoundJsonEvidence(options: BoundJsonEvidenceOptions): BoundJsonEvidence | null {
  const { baseDir, relativeFile, recordedHash, field, issues } = options;
  if (!isSafeRelativePath(relativeFile)) {
    issues.push({ field, message: "must be a safe relative evidence path" });
    return null;
  }
  const base = path.resolve(baseDir);
  if (!isRealDirectory(base)) {
    issues.push({ field: "evidenceBaseDir", message: "must be a real non-symlink directory" });
    return null;
  }
  const absolutePath = path.resolve(base, relativeFile);
  if (!isInside(base, absolutePath) || hasSymlinkParent(base, relativeFile)) {
    issues.push({ field, message: "must remain inside the evidence directory without symlink parents" });
    return null;
  }
  if (!existsSync(absolutePath)) {
    issues.push({ field, message: "evidence file does not exist" });
    return null;
  }
  const expectedStat = lstatSync(absolutePath);
  if (expectedStat.isSymbolicLink() || !expectedStat.isFile()) {
    issues.push({ field, message: "must be a regular non-symlink file" });
    return null;
  }
  if (expectedStat.size > maxEvidenceBytes) {
    issues.push({ field, message: `must not exceed ${maxEvidenceBytes} bytes` });
    return null;
  }
  const realBase = realpathSync(base);
  const realFile = realpathSync(absolutePath);
  if (!isInside(realBase, realFile)) {
    issues.push({ field, message: "must not escape through a symlinked parent" });
    return null;
  }
  const bytes = readSameFileHandle(absolutePath, expectedStat, field, issues);
  if (!bytes) return null;
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (normalizeSha256(recordedHash) !== contentHash) {
    issues.push({ field: options.hashField ?? field.replace(/File$/, "Hash"), message: "must match evidence file content" });
  }
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    issues.push({ field, message: "must contain valid UTF-8" });
    return null;
  }
  const secretIssues: ValidationIssue[] = [];
  scanForSecrets(raw, secretIssues);
  for (const issue of secretIssues) issues.push({ field, message: issue.message });
  try {
    const value = JSON.parse(raw) as unknown;
    const duplicateKeys = new JsonDuplicateKeyScanner(raw).scan();
    for (const duplicate of duplicateKeys) {
      issues.push({ field, message: `must not contain duplicate JSON key ${duplicate}` });
    }
    if (duplicateKeys.length > 0) return null;
    return { value, raw, absolutePath: realFile, contentHash };
  } catch {
    issues.push({ field, message: "must contain valid JSON" });
    return null;
  }
}

function readSameFileHandle(
  file: string,
  expectedStat: Stats,
  field: string,
  issues: ValidationIssue[],
): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStat = fstatSync(descriptor);
    if (!openedStat.isFile() || openedStat.dev !== expectedStat.dev || openedStat.ino !== expectedStat.ino) {
      issues.push({ field, message: "evidence file changed during validation" });
      return null;
    }
    if (openedStat.size > maxEvidenceBytes) {
      issues.push({ field, message: `must not exceed ${maxEvidenceBytes} bytes` });
      return null;
    }
    const bytes = readBoundedDescriptor(descriptor, openedStat.size);
    if (!bytes) {
      issues.push({ field, message: "evidence file changed size while it was read" });
      return null;
    }
    const afterRead = fstatSync(descriptor);
    if (afterRead.dev !== openedStat.dev || afterRead.ino !== openedStat.ino || afterRead.size !== bytes.length) {
      issues.push({ field, message: "evidence file changed while it was read" });
      return null;
    }
    return bytes;
  } catch {
    issues.push({ field, message: "could not be opened as a stable non-symlink file" });
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function readBoundedDescriptor(descriptor: number, expectedSize: number): Buffer | null {
  const buffer = Buffer.alloc(expectedSize + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  return offset === expectedSize ? buffer.subarray(0, offset) : null;
}

class JsonDuplicateKeyScanner {
  private index = 0;
  private readonly duplicates: string[] = [];

  constructor(private readonly source: string) {}

  scan(): string[] {
    this.scanValue("$");
    return this.duplicates;
  }

  private scanValue(pathLabel: string): void {
    this.skipWhitespace();
    const token = this.source[this.index];
    if (token === "{") this.scanObject(pathLabel);
    else if (token === "[") this.scanArray(pathLabel);
    else if (token === '"') this.scanString();
    else this.scanPrimitive();
  }

  private scanObject(pathLabel: string): void {
    this.index += 1;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.source[this.index] === "}") {
      this.index += 1;
      return;
    }
    while (this.index < this.source.length) {
      this.skipWhitespace();
      const key = this.scanString();
      const childPath = `${pathLabel}[${JSON.stringify(key)}]`;
      if (keys.has(key)) this.duplicates.push(childPath);
      keys.add(key);
      this.skipWhitespace();
      this.index += 1; // colon; JSON.parse already proved the syntax.
      this.scanValue(childPath);
      this.skipWhitespace();
      if (this.source[this.index] === "}") {
        this.index += 1;
        return;
      }
      this.index += 1; // comma
    }
  }

  private scanArray(pathLabel: string): void {
    this.index += 1;
    this.skipWhitespace();
    if (this.source[this.index] === "]") {
      this.index += 1;
      return;
    }
    let itemIndex = 0;
    while (this.index < this.source.length) {
      this.scanValue(`${pathLabel}[${itemIndex}]`);
      itemIndex += 1;
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return;
      }
      this.index += 1; // comma
    }
  }

  private scanString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const token = this.source[this.index];
      if (token === "\\") {
        this.index += 2;
      } else if (token === '"') {
        this.index += 1;
        return JSON.parse(this.source.slice(start, this.index)) as string;
      } else {
        this.index += 1;
      }
    }
    return "";
  }

  private scanPrimitive(): void {
    while (this.index < this.source.length && !/[\s,\]}]/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && !value.split("/").includes("..")
    && path.posix.normalize(value) === value;
}

function isRealDirectory(value: string): boolean {
  return existsSync(value) && !lstatSync(value).isSymbolicLink() && lstatSync(value).isDirectory();
}

function isInside(base: string, candidate: string): boolean {
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

function hasSymlinkParent(base: string, relativeFile: string): boolean {
  let current = base;
  for (const segment of relativeFile.split("/").slice(0, -1)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

function normalizeSha256(value: string): string {
  const lower = value.toLowerCase();
  return lower.startsWith("sha256:") ? lower : `sha256:${lower}`;
}
