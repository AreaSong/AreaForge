import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  readResidualLedgerV2,
  ResidualLedgerValidationError,
  type ResidualLedgerV2,
} from "./residual-ledger-common";

type TaskDirectory = "active" | "backlog" | "done";
type MetadataValue = string | boolean | string[];

const allowedKeys = new Set([
  "status",
  "phase",
  "blockers",
  "risk",
  "ownerSkill",
  "validation",
  "residualRiskIds",
  "releaseRequired",
  "evidenceClass",
  "preflightContract",
]);

const allowedEvidenceClasses = new Set([
  "source",
  "runtime",
  "release",
  "production",
  "docs-only",
  "local-smoke",
  "browser-review",
  "migration_preimage_candidate",
  "protocol_preimage_candidate",
  "runtime_preimage_candidate",
]);

const allowedStatuses: Record<TaskDirectory, Set<string>> = {
  active: new Set(["todo", "in-progress", "blocked"]),
  backlog: new Set(["backlog", "deferred", "blocked"]),
  done: new Set(["done"]),
};

const allowedPhases = new Set([
  "planning",
  "implementation",
  "awaiting-high-risk-confirmation",
  "awaiting-signed-release",
  "production-evidence",
  "complete",
]);

function main(): void {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const issues: string[] = [];
  let validated = 0;
  let legacy = 0;
  const ids = new Set<string>();
  const taskMetadata = new Map<string, Map<string, MetadataValue> | null>();
  const ledger = readLedger(root, issues);
  const residuals = new Map(ledger?.items.map((item) => [item.id, item]) ?? []);

  for (const directory of ["active", "backlog", "done"] as const) {
    const taskDir = path.join(root, "tasks", directory);
    if (!existsSync(taskDir)) {
      issues.push(`tasks/${directory}: directory is missing`);
      continue;
    }
    for (const name of readdirSync(taskDir).filter((value) => value.endsWith(".md")).sort()) {
      const relative = `tasks/${directory}/${name}`;
      const id = name.match(/^(\d{4})-/)?.[1];
      if (!id) {
        issues.push(`${relative}: filename must start with a four-digit task id`);
        continue;
      }
      if (ids.has(id)) issues.push(`${relative}: duplicate task id ${id}`);
      ids.add(id);

      const text = readFileSync(path.join(taskDir, name), "utf8");
      const metadata = parseMetadata(text, relative, issues);
      taskMetadata.set(relative, metadata);
      if (!metadata) {
        if (directory === "active") issues.push(`${relative}: active tasks require a yaml metadata block`);
        else legacy += 1;
        continue;
      }
      validated += 1;
      validateMetadata(root, relative, directory, metadata, residuals, issues);
    }
  }

  validateLedgerTaskRefs(ledger, taskMetadata, issues);

  if (issues.length > 0) {
    for (const issue of issues) console.error(`FAIL ${issue}`);
    console.error(`tasks workflow doctor failed: ${issues.length} issue(s), ${validated} metadata task(s), ${legacy} legacy task(s).`);
    process.exit(1);
  }

  console.log(`tasks workflow doctor passed: ${validated} metadata task(s) validated, ${legacy} legacy task(s) retained as read-only history.`);
}

function parseMetadata(text: string, relative: string, issues: string[]): Map<string, MetadataValue> | null {
  const match = text.match(/```yaml\s*\n([\s\S]*?)\n```/);
  if (!match) return null;
  const result = new Map<string, MetadataValue>();
  let listKey: string | null = null;
  for (const rawLine of match[1].split("\n")) {
    if (rawLine.trim() === "") continue;
    const listItem = rawLine.match(/^\s{2}-\s+(.+)$/);
    if (listItem) {
      if (!listKey) {
        issues.push(`${relative}: list item has no parent key`);
        continue;
      }
      const current = result.get(listKey);
      if (!Array.isArray(current)) {
        issues.push(`${relative}: ${listKey} must be a list`);
        continue;
      }
      current.push(listItem[1].trim());
      continue;
    }
    const field = rawLine.match(/^([A-Za-z][A-Za-z0-9]*):(?:\s*(.*))?$/);
    if (!field) {
      issues.push(`${relative}: unsupported yaml line: ${rawLine.trim()}`);
      listKey = null;
      continue;
    }
    const [, key, rawValue = ""] = field;
    if (result.has(key)) issues.push(`${relative}: duplicate metadata key ${key}`);
    if (!allowedKeys.has(key)) issues.push(`${relative}: unsupported metadata key ${key}`);
    if (rawValue === "") {
      result.set(key, []);
      listKey = key;
    } else if (rawValue === "[]") {
      result.set(key, []);
      listKey = null;
    } else if (rawValue === "true" || rawValue === "false") {
      result.set(key, rawValue === "true");
      listKey = null;
    } else {
      result.set(key, rawValue.trim());
      listKey = null;
    }
  }
  return result;
}

function validateMetadata(
  root: string,
  relative: string,
  directory: TaskDirectory,
  metadata: Map<string, MetadataValue>,
  residuals: Map<string, ResidualLedgerV2["items"][number]>,
  issues: string[],
): void {
  for (const key of ["status", "phase", "blockers", "risk", "ownerSkill", "validation", "residualRiskIds", "releaseRequired"]) {
    if (!metadata.has(key)) issues.push(`${relative}: missing metadata key ${key}`);
  }

  const status = stringValue(metadata, "status");
  if (status && !allowedStatuses[directory].has(status)) {
    issues.push(`${relative}: status ${status} is not valid for tasks/${directory}`);
  }
  const phase = stringValue(metadata, "phase");
  if (phase && !allowedPhases.has(phase)) issues.push(`${relative}: unsupported phase ${phase}`);
  const risk = stringValue(metadata, "risk");
  if (risk && !["low", "medium", "high"].includes(risk)) issues.push(`${relative}: risk must be low, medium, or high`);

  const ownerSkill = stringValue(metadata, "ownerSkill");
  if (ownerSkill && !existsSync(path.join(root, ".codex/skills-src", ownerSkill, "SKILL.md"))) {
    issues.push(`${relative}: ownerSkill ${ownerSkill} does not exist`);
  }

  const validation = listValue(metadata, "validation");
  if (validation && validation.length === 0) issues.push(`${relative}: validation must contain at least one command or evidence step`);
  const blockers = listValue(metadata, "blockers");
  if (blockers && status === "blocked" && blockers.length === 0) issues.push(`${relative}: blocked tasks require at least one blocker`);
  if (blockers && status === "done" && blockers.length > 0) issues.push(`${relative}: done tasks cannot retain blockers`);

  const residualIds = listValue(metadata, "residualRiskIds");
  for (const id of residualIds ?? []) {
    if (!/^AF-RISK-[A-Z]+-\d+$/.test(id)) issues.push(`${relative}: invalid residual risk id ${id}`);
    else {
      const residual = residuals.get(id);
      if (!residual) issues.push(`${relative}: residual risk id ${id} is absent from the ledger`);
      else if (!residual.taskRefs.includes(relative)) {
        issues.push(`${relative}: residual risk id ${id} must include reciprocal ledger taskRef ${relative}`);
      }
    }
  }

  const releaseRequired = metadata.get("releaseRequired");
  if (typeof releaseRequired !== "boolean") issues.push(`${relative}: releaseRequired must be true or false`);
  if (releaseRequired === true && risk === "high" && (residualIds?.length ?? 0) === 0) {
    issues.push(`${relative}: high-risk release tasks require at least one residualRiskId`);
  }

  const evidenceClass = stringValue(metadata, "evidenceClass");
  if (metadata.has("evidenceClass") && (!evidenceClass || !allowedEvidenceClasses.has(evidenceClass))) {
    issues.push(`${relative}: evidenceClass is unsupported`);
  }
  const preflightContract = stringValue(metadata, "preflightContract");
  if (metadata.has("preflightContract") && (!preflightContract || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*-V\d+$/.test(preflightContract))) {
    issues.push(`${relative}: preflightContract must be an uppercase versioned contract id`);
  }
}

function stringValue(metadata: Map<string, MetadataValue>, key: string): string | null {
  const value = metadata.get(key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function listValue(metadata: Map<string, MetadataValue>, key: string): string[] | null {
  const value = metadata.get(key);
  return Array.isArray(value) ? value : null;
}

function readLedger(root: string, issues: string[]): ResidualLedgerV2 | null {
  try {
    return readResidualLedgerV2({ root, validateTaskBindings: false });
  } catch (error) {
    if (error instanceof ResidualLedgerValidationError) {
      for (const issue of error.issues) issues.push(`residual ledger ${issue.field}: ${issue.message}`);
    } else {
      issues.push(`residual ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

function validateLedgerTaskRefs(
  ledger: ResidualLedgerV2 | null,
  taskMetadata: Map<string, Map<string, MetadataValue> | null>,
  issues: string[],
): void {
  if (!ledger) return;
  for (const item of ledger.items) {
    for (const taskRef of item.taskRefs) {
      const metadata = taskMetadata.get(taskRef);
      if (metadata === undefined) {
        issues.push(`residual ledger ${item.id}: taskRef ${taskRef} is not a discovered task file`);
        continue;
      }
      if (!metadata) {
        issues.push(`residual ledger ${item.id}: taskRef ${taskRef} must contain yaml metadata`);
        continue;
      }
      if (!(listValue(metadata, "residualRiskIds") ?? []).includes(item.id)) {
        issues.push(`residual ledger ${item.id}: taskRef ${taskRef} must include reciprocal residualRiskIds entry`);
      }
    }
  }
}

main();
