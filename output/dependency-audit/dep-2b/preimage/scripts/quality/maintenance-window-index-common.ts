import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseIndentedKeyValueRecord } from "./record-validator-common";

export interface MaintenanceWindowIndexEntry {
  windowId: string;
  recordPath: string;
  recordSha256: string;
  startedAt: string;
  finishedAt: string;
  cadence: string;
  environment: string;
  result: "pass" | "warn" | "fail" | "blocked";
  evidenceFreshnessStatus: "fresh" | "stale" | "unknown";
  evidenceFreshnessMaxAgeSeconds: number;
  latestEvidenceCheckedAt: string;
  dueResidualRiskIds: string[];
  residualRiskIds: string[];
}

export interface MaintenanceWindowIndex {
  schemaVersion: 1;
  mode: "read_only_maintenance_window_index";
  sourceRoot: string;
  sourcePattern: "maintenance-window-*/maintenance-window.txt";
  sourceSetSha256: string;
  latestWindowId: string | null;
  windows: MaintenanceWindowIndexEntry[];
  doesNotProve: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    productionWriteAttempted: false;
    secretValuePrinted: false;
    indexWritten: false;
    maintenanceActionExecuted: false;
    residualLedgerUpdated: false;
  };
}

const sourcePattern = "maintenance-window-*/maintenance-window.txt" as const;
const recordDirectoryPattern = /^maintenance-window-\d{8}(?:[-_].+)?$/;

export function buildMaintenanceWindowIndex(sourceRoot: string): MaintenanceWindowIndex {
  const resolvedRoot = path.resolve(sourceRoot);
  const windows = discoverRecords(resolvedRoot).map((recordPath) => inspectRecord(resolvedRoot, recordPath)).sort(compareEntries);
  const duplicate = duplicateWindowId(windows);
  if (duplicate) throw new Error(`duplicate maintenance window id: ${duplicate}`);

  return {
    schemaVersion: 1,
    mode: "read_only_maintenance_window_index",
    sourceRoot: displaySourceRoot(resolvedRoot),
    sourcePattern,
    sourceSetSha256: buildSourceSetSha256(windows),
    latestWindowId: windows[0]?.windowId ?? null,
    windows,
    doesNotProve: [
      "production health",
      "maintenance action execution",
      "updater apply, backup, restore, migration, or rollback execution",
      "residual risk closure",
      "current evidence freshness beyond the recorded maintenance fields",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      indexWritten: false,
      maintenanceActionExecuted: false,
      residualLedgerUpdated: false,
    },
  };
}

export function resolveIndexSourceRoot(indexSourceRoot: string, explicitRoot?: string): string {
  if (explicitRoot) return path.resolve(explicitRoot);
  if (indexSourceRoot === "<external-root>") throw new Error("an explicit source root is required for an external-root index");
  if (path.isAbsolute(indexSourceRoot) || indexSourceRoot.includes("..") || indexSourceRoot.includes("\\")) {
    throw new Error("index sourceRoot must be a safe repository-relative path");
  }
  const repositoryRoot = path.resolve(process.cwd());
  const resolved = path.resolve(repositoryRoot, indexSourceRoot);
  if (resolved !== repositoryRoot && !resolved.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new Error("index sourceRoot must resolve inside the repository");
  }
  return resolved;
}

function discoverRecords(sourceRoot: string): string[] {
  if (!existsSync(sourceRoot) || !lstatSync(sourceRoot).isDirectory()) throw new Error("maintenance window source root must be a directory");
  const records: string[] = [];
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!recordDirectoryPattern.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`maintenance window directory must not be a symlink: ${entry.name}`);
    if (!entry.isDirectory()) throw new Error(`maintenance window candidate must be a directory: ${entry.name}`);
    const recordPath = path.join(sourceRoot, entry.name, "maintenance-window.txt");
    if (!existsSync(recordPath)) throw new Error(`maintenance window record is missing: ${entry.name}/maintenance-window.txt`);
    if (!lstatSync(recordPath).isFile()) throw new Error(`maintenance window record must be a regular file: ${entry.name}/maintenance-window.txt`);
    records.push(recordPath);
  }
  return records.sort();
}

function inspectRecord(sourceRoot: string, recordPath: string): MaintenanceWindowIndexEntry {
  const recordPathDisplay = displayRecordPath(sourceRoot, recordPath);
  const bytes = readFileSync(recordPath);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`maintenance window record must be valid UTF-8: ${recordPathDisplay}`);
  }

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/maintenance-window-record-validate.ts", recordPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (validation.status !== 0) throw new Error(`maintenance window record validation failed: ${recordPathDisplay}`);
  const fields = parseIndentedKeyValueRecord(raw);
  const windowId = required(fields, "windowId");
  const startedAt = required(fields, "startedAt");
  const finishedAt = required(fields, "finishedAt");
  const result = oneOf(required(fields, "result"), ["pass", "warn", "fail", "blocked"] as const, "result");
  const freshness = oneOf(required(fields, "evidenceFreshnessStatus"), ["fresh", "stale", "unknown"] as const, "evidenceFreshnessStatus");
  const freshnessMaxAge = Number(required(fields, "evidenceFreshnessMaxAgeSeconds"));
  if (!Number.isInteger(freshnessMaxAge) || freshnessMaxAge <= 0) throw new Error(`invalid evidenceFreshnessMaxAgeSeconds: ${recordPathDisplay}`);

  return {
    windowId,
    recordPath: recordPathDisplay,
    recordSha256: `sha256:${sha256(bytes)}`,
    startedAt,
    finishedAt,
    cadence: required(fields, "cadence"),
    environment: required(fields, "environment"),
    result,
    evidenceFreshnessStatus: freshness,
    evidenceFreshnessMaxAgeSeconds: freshnessMaxAge,
    latestEvidenceCheckedAt: required(fields, "latestEvidenceCheckedAt"),
    dueResidualRiskIds: riskIds(required(fields, "dueResidualRiskIds")),
    residualRiskIds: riskIds(required(fields, "residualRiskIds")),
  };
}

function compareEntries(left: MaintenanceWindowIndexEntry, right: MaintenanceWindowIndexEntry): number {
  const finished = Date.parse(right.finishedAt) - Date.parse(left.finishedAt);
  if (finished !== 0) return finished;
  const started = Date.parse(right.startedAt) - Date.parse(left.startedAt);
  if (started !== 0) return started;
  const windowId = left.windowId.localeCompare(right.windowId);
  return windowId !== 0 ? windowId : left.recordPath.localeCompare(right.recordPath);
}

function duplicateWindowId(windows: MaintenanceWindowIndexEntry[]): string | null {
  const seen = new Set<string>();
  for (const window of windows) {
    if (seen.has(window.windowId)) return window.windowId;
    seen.add(window.windowId);
  }
  return null;
}

function buildSourceSetSha256(windows: MaintenanceWindowIndexEntry[]): string {
  const input = [...windows]
    .sort((left, right) => left.recordPath.localeCompare(right.recordPath))
    .map((window) => `${window.recordPath}\0${window.recordSha256.replace(/^sha256:/, "")}\n`)
    .join("");
  return `sha256:${sha256(input)}`;
}

function displaySourceRoot(sourceRoot: string): string {
  const repositoryRoot = path.resolve(process.cwd());
  if (sourceRoot === repositoryRoot) return ".";
  if (sourceRoot.startsWith(`${repositoryRoot}${path.sep}`)) return path.relative(repositoryRoot, sourceRoot).split(path.sep).join("/");
  return "<external-root>";
}

function displayRecordPath(sourceRoot: string, recordPath: string): string {
  const repositoryRoot = path.resolve(process.cwd());
  if (recordPath.startsWith(`${repositoryRoot}${path.sep}`)) return path.relative(repositoryRoot, recordPath).split(path.sep).join("/");
  return path.relative(sourceRoot, recordPath).split(path.sep).join("/");
}

function required(fields: Map<string, string>, key: string): string {
  const value = fields.get(key)?.trim();
  if (!value) throw new Error(`validated maintenance record is missing ${key}`);
  return value;
}

function oneOf<const T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  const normalized = value.toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`validated maintenance record has invalid ${field}`);
  return normalized as T[number];
}

function riskIds(value: string): string[] {
  if (value.toLowerCase() === "none") return [];
  return [...new Set(value.match(/AF-RISK-[A-Z]+-\d{3}/g) ?? [])].sort();
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
