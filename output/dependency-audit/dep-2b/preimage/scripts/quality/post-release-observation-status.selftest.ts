import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPostReleaseObservationStatus } from "../ops/post-release-observation-status";
import {
  deriveD14Gate,
  deriveD30Gate,
  deriveOverallGate,
  type D14Checkpoint,
  type D30Checkpoint,
  type EvidenceReference,
  type PostReleaseObservationRecord,
} from "./post-release-observation-validate";

const repoRoot = process.cwd();
const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-post-release-observation-status-"));
const version = "1.2.3";
const releasedAt = "2026-07-16T10:30:00Z";
const gitCommit = "a".repeat(40);

try {
  const releasePath = `docs/development/release-v${version}-record.md`;
  const releaseBody = `releaseTag: v${version}\nreleasedAt: ${releasedAt}\ngitCommit: ${gitCommit}\n`;
  writeFixture(releasePath, releaseBody);
  const evidence = writeEvidence("evidence/status.json", "status evidence\n");

  const pending = buildRecord(releasePath, releaseBody, evidence, "pending");
  expectStatus(pending, "2026-07-29", "pending_observation");
  expectStatus(pending, "2026-07-30", "pending_observation");
  expectStatus(pending, "2026-07-31", "needs_attention");
  expectStatus(buildRecord(releasePath, releaseBody, evidence, "fail"), "2026-07-20", "blocked");
  const passed = buildRecord(releasePath, releaseBody, evidence, "pass");
  expectStatus(passed, "2026-08-16", "ready_for_human_review");
  expectStatus(withD14Status(passed, "incident", "open"), "2026-07-20", "blocked");
  expectStatus(withD14Status(passed, "errorBudget", "exhausted"), "2026-07-20", "blocked");

  const raw = JSON.stringify(pending, null, 2);
  const projection = buildPostReleaseObservationStatus(raw, { root, sourcePath: "observation.json", asOf: "2026-07-31" });
  const checkpoints = projection.checkpoints as Record<string, Record<string, unknown>>;
  assert(checkpoints.d14.dateStatus === "overdue", "D14 should be overdue");
  assert(checkpoints.d30.dateStatus === "upcoming", "D30 should remain upcoming");
  assert(projection.nextCheckpoint === "d14", "D14 should remain the next pending checkpoint");

  const recordPath = path.join(root, "observation.json");
  writeFileSync(recordPath, raw, "utf8");
  const before = treeFingerprint(root);
  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/post-release-observation-status.ts", recordPath, "--as-of", "2026-07-31", "--root", root], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.status !== 0) throw new Error(`status command failed: ${result.stderr}`);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  assert(output.status === "needs_attention", "CLI status should project overdue pending as needs_attention");
  const safety = output.safetyFacts as Record<string, unknown>;
  assert(safety.readOnly === true && safety.networkRequested === false && safety.fileWriteAttempted === false, "read-only safety facts mismatch");
  assert(treeFingerprint(root) === before, "status command must not write or mutate input files");

  const source = readFileSync(path.join(repoRoot, "scripts/ops/post-release-observation-status.ts"), "utf8");
  for (const forbidden of ["node:http", "node:https", "fetch(", "writeFile", "appendFile", "mkdir", "rmSync", "unlink"]) {
    assert(!source.includes(forbidden), `status source must not include ${forbidden}`);
  }
  console.log("post-release observation status selftest passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function expectStatus(record: PostReleaseObservationRecord, asOf: string, expected: string): void {
  const result = buildPostReleaseObservationStatus(JSON.stringify(record), { root, asOf });
  assert(result.status === expected, `expected ${expected} at ${asOf}, got ${String(result.status)}`);
}

function withD14Status(
  record: PostReleaseObservationRecord,
  key: "incident" | "errorBudget",
  status: "open" | "exhausted",
): PostReleaseObservationRecord {
  const changed = structuredClone(record);
  if (key === "incident") changed.checkpoints.d14.incident.status = status as "open";
  else changed.checkpoints.d14.errorBudget.status = status as "exhausted";
  changed.checkpoints.d14.gate = deriveD14Gate(changed.checkpoints.d14);
  changed.gate = deriveOverallGate(changed.checkpoints);
  return changed;
}

function buildRecord(releasePath: string, releaseBody: string, evidence: EvidenceReference, state: "pending" | "pass" | "fail"): PostReleaseObservationRecord {
  const d14 = d14Checkpoint("2026-07-30", state, evidence);
  const d30 = d30Checkpoint("2026-08-15", state === "fail" ? "pass" : state, evidence);
  const checkpoints = { d14, d30 };
  return {
    schemaVersion: 1,
    mode: "post_release_observation",
    release: { version, releaseTag: `v${version}`, releasedAt, gitCommit, releaseRecord: reference(releasePath, releaseBody) },
    checkpoints,
    gate: deriveOverallGate(checkpoints),
    safetyFacts: { readOnlyEvidence: true, networkRequested: false, productionWriteAttempted: false, residualLedgerUpdated: false, fileWriteAttempted: false },
  };
}

function d14Checkpoint(dueDate: string, state: "pending" | "pass" | "fail", evidence: EvidenceReference): D14Checkpoint {
  const pending = state === "pending";
  const value: D14Checkpoint = {
    dueDate,
    observedAt: pending ? null : `${dueDate}T12:00:00Z`,
    technicalObservation: item(state === "fail" ? "fail" : pending ? "pending_observation" : "pass", pending, evidence),
    incident: item(pending ? "pending_observation" : "none", pending, evidence),
    errorBudget: item(pending ? "pending_observation" : "within_budget", pending, evidence),
    gate: { status: "pending_observation", reasons: [] },
  };
  value.gate = deriveD14Gate(value);
  return value;
}

function d30Checkpoint(dueDate: string, state: "pending" | "pass", evidence: EvidenceReference): D30Checkpoint {
  const pending = state === "pending";
  const value: D30Checkpoint = {
    dueDate,
    observedAt: pending ? null : `${dueDate}T12:00:00Z`,
    productReview: item(pending ? "pending_observation" : "pass", pending, evidence),
    gate: { status: "pending_observation", reasons: [] },
  };
  value.gate = deriveD30Gate(value);
  return value;
}

function item<T extends string>(status: T, pending: boolean, evidence: EvidenceReference): { status: T; summary: string; evidence: EvidenceReference[] } {
  return { status, summary: pending ? "awaiting scheduled observation" : "evidence reviewed", evidence: pending ? [] : [evidence] };
}

function writeEvidence(relative: string, body: string): EvidenceReference {
  writeFixture(relative, body);
  return reference(relative, body);
}

function writeFixture(relative: string, body: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
}

function reference(relative: string, body: string): EvidenceReference {
  return { path: relative, sha256: `sha256:${createHash("sha256").update(body).digest("hex")}` };
}

function treeFingerprint(directory: string): string {
  const entries: string[] = [];
  visit(directory, directory, entries);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function visit(rootDir: string, current: string, entries: string[]): void {
  for (const name of readdirSync(current).sort()) {
    const absolute = path.join(current, name);
    const relative = path.relative(rootDir, absolute);
    const stat = statSync(absolute);
    if (stat.isDirectory()) visit(rootDir, absolute, entries);
    else entries.push(`${relative}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
