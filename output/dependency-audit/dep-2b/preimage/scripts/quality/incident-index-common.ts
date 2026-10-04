import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { parseIndentedKeyValueRecord, parseList } from "./record-validator-common";

export interface IncidentIndexEntry {
  incidentId: string;
  recordPath: string;
  recordSha256: string;
  detectedAt: string;
  recordedAt: string;
  status: "open" | "mitigated" | "resolved" | "follow-up";
  environment: "production" | "staging" | "local" | "ci";
  severity: "p0" | "p1" | "p2" | "p3";
  incidentType: "health" | "update" | "backup" | "release" | "security" | "ai" | "upload" | "data" | "smoke" | "other";
  publicHealthStatus: "pass" | "warn" | "fail" | "unknown" | "not-checked";
  rollbackDecision: "not-needed" | "rollback" | "roll-forward" | "hold" | "defer";
  residualRiskIds: string[];
  followUpTasks: string[];
}

export interface IncidentIndexGroup {
  sourceSetSha256: string;
  latestIncidentId: string | null;
  incidents: IncidentIndexEntry[];
}

export interface IncidentIndex {
  schemaVersion: 2;
  mode: "read_only_incident_index";
  sourceRoot: string;
  sourcePattern: "incident-*/incident-record.txt";
  sourceSetSha256: string;
  active: IncidentIndexGroup;
  resolved: IncidentIndexGroup;
  doesNotProve: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    productionWriteAttempted: false;
    secretValuePrinted: false;
    indexWritten: false;
    incidentActionExecuted: false;
    residualLedgerUpdated: false;
  };
}

const sourcePattern = "incident-*/incident-record.txt" as const;
const recordDirectoryPattern = /^incident-.*$/;

export function buildIncidentIndex(sourceRoot: string): IncidentIndex {
  const resolvedRoot = resolveSafeIncidentSourceRoot(sourceRoot);
  const incidents = discoverRecords(resolvedRoot)
    .map((recordPath) => inspectRecord(resolvedRoot, recordPath))
    .sort(compareEntries);
  const duplicate = duplicateIncidentId(incidents);
  if (duplicate) throw new Error(`duplicate incident id: ${duplicate}`);
  const activeIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const resolvedIncidents = incidents.filter((incident) => incident.status === "resolved");

  return {
    schemaVersion: 2,
    mode: "read_only_incident_index",
    sourceRoot: displaySourceRoot(resolvedRoot),
    sourcePattern,
    sourceSetSha256: buildSourceSetSha256(incidents),
    active: buildGroup(activeIncidents),
    resolved: buildGroup(resolvedIncidents),
    doesNotProve: [
      "current production health",
      "active incident containment or recovery",
      "incident action execution",
      "rollback, updater apply, backup, restore, or migration execution",
      "residual risk closure",
      "incident completeness outside the fixed source pattern",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      indexWritten: false,
      incidentActionExecuted: false,
      residualLedgerUpdated: false,
    },
  };
}

export function resolveIncidentIndexSourceRoot(indexSourceRoot: string, explicitRoot?: string): string {
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

export function resolveSafeIncidentSourceRoot(sourceRoot: string, repositoryRoot = process.cwd()): string {
  const resolvedRoot = path.resolve(sourceRoot);
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  if (resolvedRoot === resolvedRepositoryRoot || resolvedRoot.startsWith(`${resolvedRepositoryRoot}${path.sep}`)) {
    const realRepositoryRoot = realpathSync.native(resolvedRepositoryRoot);
    const expectedRealRoot = path.join(realRepositoryRoot, path.relative(resolvedRepositoryRoot, resolvedRoot));
    const actualRealRoot = realpathSync.native(resolvedRoot);
    if (actualRealRoot !== expectedRealRoot) {
      throw new Error("incident source root must not traverse a repository-internal symlink");
    }
  }
  return resolvedRoot;
}

function discoverRecords(sourceRoot: string): string[] {
  let rootStat;
  try {
    rootStat = lstatSync(sourceRoot);
  } catch {
    throw new Error("incident source root must be a directory");
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("incident source root must be a regular directory");

  const records: string[] = [];
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!recordDirectoryPattern.test(entry.name)) continue;
    const candidatePath = path.join(sourceRoot, entry.name);
    const candidateStat = lstatSync(candidatePath);
    if (candidateStat.isSymbolicLink()) throw new Error(`incident directory must not be a symlink: ${entry.name}`);
    if (!candidateStat.isDirectory()) throw new Error(`incident candidate must be a regular directory: ${entry.name}`);

    const recordPath = path.join(candidatePath, "incident-record.txt");
    let recordStat;
    try {
      recordStat = lstatSync(recordPath);
    } catch {
      throw new Error(`incident record is missing: ${entry.name}/incident-record.txt`);
    }
    if (recordStat.isSymbolicLink()) throw new Error(`incident record must not be a symlink: ${entry.name}/incident-record.txt`);
    if (!recordStat.isFile()) throw new Error(`incident record must be a regular file: ${entry.name}/incident-record.txt`);
    records.push(recordPath);
  }
  return records.sort();
}

function inspectRecord(sourceRoot: string, recordPath: string): IncidentIndexEntry {
  const recordPathDisplay = displayRecordPath(sourceRoot, recordPath);
  const bytes = readFileSync(recordPath);
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`incident record must be valid UTF-8: ${recordPathDisplay}`);
  }

  const fields = parseIndentedKeyValueRecord(raw);
  const status = oneOf(required(fields, "status"), ["open", "mitigated", "resolved", "follow-up"] as const, "status");
  const postIncidentReview = required(fields, "postIncidentReview").toLowerCase();
  if (status === "resolved" && postIncidentReview !== "yes") {
    throw new Error(`resolved incident record postIncidentReview must be yes: ${recordPathDisplay}`);
  }
  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/incident-record-validate.ts", recordPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (validation.status !== 0) throw new Error(`incident record validation failed: ${recordPathDisplay}`);

  const detectedAt = offsetTimestamp(required(fields, "detectedAt"), "detectedAt");
  const recordedAt = offsetTimestamp(required(fields, "recordedAt"), "recordedAt");

  return {
    incidentId: required(fields, "incidentId"),
    recordPath: recordPathDisplay,
    recordSha256: `sha256:${sha256(bytes)}`,
    detectedAt,
    recordedAt,
    status,
    environment: oneOf(required(fields, "environment"), ["production", "staging", "local", "ci"] as const, "environment"),
    severity: oneOf(required(fields, "severity"), ["p0", "p1", "p2", "p3"] as const, "severity"),
    incidentType: oneOf(
      required(fields, "incidentType"),
      ["health", "update", "backup", "release", "security", "ai", "upload", "data", "smoke", "other"] as const,
      "incidentType",
    ),
    publicHealthStatus: oneOf(
      required(fields, "publicHealthStatus"),
      ["pass", "warn", "fail", "unknown", "not-checked"] as const,
      "publicHealthStatus",
    ),
    rollbackDecision: oneOf(
      required(fields, "rollbackDecision"),
      ["not-needed", "rollback", "roll-forward", "hold", "defer"] as const,
      "rollbackDecision",
    ),
    residualRiskIds: riskIds(required(fields, "residualRiskIds")),
    followUpTasks: stableList(required(fields, "followUpTasks")),
  };
}

function compareEntries(left: IncidentIndexEntry, right: IncidentIndexEntry): number {
  const recorded = Date.parse(right.recordedAt) - Date.parse(left.recordedAt);
  if (recorded !== 0) return recorded;
  const detected = Date.parse(right.detectedAt) - Date.parse(left.detectedAt);
  if (detected !== 0) return detected;
  const incidentId = compareBinary(left.incidentId, right.incidentId);
  return incidentId !== 0 ? incidentId : compareBinary(left.recordPath, right.recordPath);
}

function duplicateIncidentId(incidents: IncidentIndexEntry[]): string | null {
  const seen = new Set<string>();
  for (const incident of incidents) {
    if (seen.has(incident.incidentId)) return incident.incidentId;
    seen.add(incident.incidentId);
  }
  return null;
}

function buildSourceSetSha256(incidents: IncidentIndexEntry[]): string {
  const input = [...incidents]
    .sort((left, right) => compareBinary(left.recordPath, right.recordPath))
    .map((incident) => `${incident.recordPath}\0${incident.recordSha256.replace(/^sha256:/, "")}\n`)
    .join("");
  return `sha256:${sha256(input)}`;
}

function buildGroup(incidents: IncidentIndexEntry[]): IncidentIndexGroup {
  return {
    sourceSetSha256: buildSourceSetSha256(incidents),
    latestIncidentId: incidents[0]?.incidentId ?? null,
    incidents,
  };
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
  if (!value) throw new Error(`validated incident record is missing ${key}`);
  return value;
}

function oneOf<const T extends readonly string[]>(value: string, allowed: T, field: string): T[number] {
  const normalized = value.toLowerCase();
  if (!allowed.includes(normalized)) throw new Error(`validated incident record has invalid ${field}`);
  return normalized as T[number];
}

function riskIds(value: string): string[] {
  if (value.toLowerCase() === "none") return [];
  const values = parseList(value);
  if (values.length === 0 || values.some((item) => !/^AF-RISK-[A-Z]+-\d{3}$/.test(item))) {
    throw new Error("validated incident record has invalid residualRiskIds");
  }
  return [...new Set(values)].sort(compareBinary);
}

function stableList(value: string): string[] {
  if (value.toLowerCase() === "none") return [];
  const values = parseList(value);
  if (values.length === 0 || values.some((item) => !isSafeFollowUpReference(item))) {
    throw new Error("validated incident record has invalid followUpTasks");
  }
  return [...new Set(values)].sort(compareBinary);
}

function offsetTimestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`validated incident record ${field} must include Z or an explicit UTC offset`);
  }
  return value;
}

function isSafeFollowUpReference(value: string): boolean {
  if (path.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..")) return false;
  return /^(?:docs|tasks|workflow)\/[A-Za-z0-9._/-]+$/.test(value);
}

function compareBinary(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
