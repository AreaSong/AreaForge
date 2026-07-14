import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveSafeIncidentSourceRoot } from "./incident-index-common";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-incident-index-"));

try {
  const validRoot = path.join(tempDir, "valid");
  writeRecord(validRoot, "incident-20260712-health", createRecord({
    incidentId: "incident-20260712-health",
    detectedAt: "2026-07-12T01:00:00Z",
    recordedAt: "2026-07-12T02:00:00Z",
    severity: "p2",
    incidentType: "health",
  }));
  writeRecord(validRoot, "incident-20260713-update", createRecord({
    incidentId: "incident-20260713-update",
    detectedAt: "2026-07-13T01:00:00Z",
    recordedAt: "2026-07-13T02:00:00Z",
    severity: "p1",
    incidentType: "update",
  }));
  writeFileSync(path.join(validRoot, "incident-index.json"), "{}\n");
  writeFileSync(path.join(validRoot, "incident-record-template.md"), "# template\n");

  const generated = run(["exec", "tsx", "scripts/ops/incident-index.ts", validRoot]);
  expectStatus("generate two-record index", generated, 0);
  const index = JSON.parse(generated.stdout) as Record<string, unknown>;
  assert(index.mode === "read_only_resolved_incident_index", "index mode mismatch");
  assert(index.sourcePattern === "incident-*/incident-record.txt", "source pattern mismatch");
  assert(index.latestIncidentId === "incident-20260713-update", "latest incident mismatch");
  assert(Array.isArray(index.incidents) && index.incidents.length === 2, "index should contain two records");

  const generatedAgain = run(["exec", "tsx", "scripts/ops/incident-index.ts", validRoot]);
  expectStatus("deterministic rebuild", generatedAgain, 0);
  assert(generated.stdout === generatedAgain.stdout, "rebuilding the same source set must be byte-identical");
  const generatedUtc = run(["exec", "tsx", "scripts/ops/incident-index.ts", validRoot], { TZ: "UTC" });
  const generatedShanghai = run(["exec", "tsx", "scripts/ops/incident-index.ts", validRoot], { TZ: "Asia/Shanghai" });
  expectStatus("UTC rebuild", generatedUtc, 0);
  expectStatus("Asia/Shanghai rebuild", generatedShanghai, 0);
  assert(generatedUtc.stdout === generatedShanghai.stdout, "timezone changes must not affect deterministic ordering");

  const indexPath = path.join(tempDir, "incident-index.json");
  writeFileSync(indexPath, generated.stdout);
  expectStatus("validate current index", run(["exec", "tsx", "scripts/quality/incident-index-validate.ts", indexPath, validRoot]), 0);

  writeRecord(validRoot, "incident-20260713-update", createRecord({
    incidentId: "incident-20260713-update",
    detectedAt: "2026-07-13T01:00:00Z",
    recordedAt: "2026-07-13T02:00:00Z",
    severity: "p2",
    incidentType: "update",
  }));
  expectStatus("source drift invalidates saved index", run(["exec", "tsx", "scripts/quality/incident-index-validate.ts", indexPath, validRoot]), 1);

  const duplicateRoot = path.join(tempDir, "duplicate");
  writeRecord(duplicateRoot, "incident-20260714-a", createRecord({ incidentId: "incident-duplicate", recordedAt: "2026-07-14T02:00:00Z" }));
  writeRecord(duplicateRoot, "incident-20260714-b", createRecord({ incidentId: "incident-duplicate", recordedAt: "2026-07-14T03:00:00Z" }));
  const duplicate = run(["exec", "tsx", "scripts/ops/incident-index.ts", duplicateRoot]);
  expectStatus("duplicate incident id fails", duplicate, 1);
  assert(duplicate.stdout.trim() === "", "duplicate failure must not emit a partial index");
  assert(duplicate.stderr.includes("duplicate incident id"), "duplicate failure must be explicit");

  const unresolvedRoot = path.join(tempDir, "unresolved");
  writeRecord(unresolvedRoot, "incident-20260715-open", createRecord({ status: "mitigated", postIncidentReview: "no" }));
  const unresolved = run(["exec", "tsx", "scripts/ops/incident-index.ts", unresolvedRoot]);
  expectStatus("unresolved incident fails", unresolved, 1);
  assert(unresolved.stderr.includes("status must be resolved"), "unresolved failure must be explicit");

  const noReviewRoot = path.join(tempDir, "no-review");
  writeRecord(noReviewRoot, "incident-20260715-no-review", createRecord({ postIncidentReview: "no" }));
  const noReview = run(["exec", "tsx", "scripts/ops/incident-index.ts", noReviewRoot]);
  expectStatus("resolved incident without review fails", noReview, 1);
  assert(noReview.stderr.includes("postIncidentReview must be yes"), "post-review failure must be explicit");

  const invalidResidualRoot = path.join(tempDir, "invalid-residual");
  writeRecord(invalidResidualRoot, "incident-20260715-invalid-residual", createRecord({ residualRiskIds: "AF-RISK-OPS-004, typo-risk-id" }));
  const invalidResidual = run(["exec", "tsx", "scripts/ops/incident-index.ts", invalidResidualRoot]);
  expectStatus("partial invalid residual id fails", invalidResidual, 1);
  assert(invalidResidual.stderr.includes("incident record validation failed"), "invalid residual failure must be explicit");

  const invalidFollowUpRoot = path.join(tempDir, "invalid-follow-up");
  writeRecord(invalidFollowUpRoot, "incident-20260715-invalid-follow-up", createRecord({ followUpTasks: "private operator notes" }));
  const invalidFollowUp = run(["exec", "tsx", "scripts/ops/incident-index.ts", invalidFollowUpRoot]);
  expectStatus("free-text follow-up fails", invalidFollowUp, 1);
  assert(invalidFollowUp.stderr.includes("incident record validation failed"), "invalid follow-up failure must be explicit");

  const missingRecordRoot = path.join(tempDir, "missing-record");
  mkdirSync(path.join(missingRecordRoot, "incident-20260715-missing"), { recursive: true });
  const missingRecord = run(["exec", "tsx", "scripts/ops/incident-index.ts", missingRecordRoot]);
  expectStatus("incident directory without record fails", missingRecord, 1);
  assert(missingRecord.stderr.includes("incident record is missing"), "missing record failure must be explicit");

  const invalidUtf8Root = path.join(tempDir, "invalid-utf8");
  const invalidUtf8Dir = path.join(invalidUtf8Root, "incident-20260716-invalid");
  mkdirSync(invalidUtf8Dir, { recursive: true });
  writeFileSync(path.join(invalidUtf8Dir, "incident-record.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
  const invalidUtf8 = run(["exec", "tsx", "scripts/ops/incident-index.ts", invalidUtf8Root]);
  expectStatus("invalid UTF-8 record fails", invalidUtf8, 1);
  assert(invalidUtf8.stderr.includes("must be valid UTF-8"), "invalid UTF-8 failure must be explicit");

  testSymlinksWhenSupported();
  testRepositoryAncestorSymlinkWhenSupported();

  const emptyRoot = path.join(tempDir, "empty");
  mkdirSync(emptyRoot);
  const empty = run(["exec", "tsx", "scripts/ops/incident-index.ts", emptyRoot]);
  expectStatus("empty index", empty, 0);
  const emptyIndex = JSON.parse(empty.stdout) as { latestIncidentId?: unknown; incidents?: unknown[] };
  assert(emptyIndex.latestIncidentId === null && emptyIndex.incidents?.length === 0, "empty index must be explicit and valid");

  const unknownFieldIndex = JSON.parse(generated.stdout) as Record<string, unknown>;
  unknownFieldIndex.unknownField = true;
  const unknownFieldPath = path.join(tempDir, "unknown-field-index.json");
  writeFileSync(unknownFieldPath, `${JSON.stringify(unknownFieldIndex, null, 2)}\n`);
  const unknownField = run(["exec", "tsx", "scripts/quality/incident-index-validate.ts", unknownFieldPath, validRoot]);
  expectStatus("unknown index field fails", unknownField, 1);
  assert(unknownField.stderr.includes("missing or unknown top-level fields"), "unknown field failure must be explicit");

  const missingFieldIndex = JSON.parse(generated.stdout) as Record<string, unknown>;
  delete missingFieldIndex.sourceSetSha256;
  const missingFieldPath = path.join(tempDir, "missing-field-index.json");
  writeFileSync(missingFieldPath, `${JSON.stringify(missingFieldIndex, null, 2)}\n`);
  const missingField = run(["exec", "tsx", "scripts/quality/incident-index-validate.ts", missingFieldPath, validRoot]);
  expectStatus("missing index field fails", missingField, 1);
  assert(missingField.stderr.includes("missing or unknown top-level fields"), "missing field failure must be explicit");

  const secretIndex = JSON.parse(generated.stdout) as { doesNotProve: string[] };
  secretIndex.doesNotProve.push("DATABASE_URL=postgresql://user:password@example/db");
  const secretIndexPath = path.join(tempDir, "secret-index.json");
  writeFileSync(secretIndexPath, `${JSON.stringify(secretIndex, null, 2)}\n`);
  const secret = run(["exec", "tsx", "scripts/quality/incident-index-validate.ts", secretIndexPath, validRoot]);
  expectStatus("secret-like index content fails", secret, 1);
  assert(secret.stderr.includes("must not contain DATABASE_URL"), "secret scan failure must be explicit");

  console.log("incident index selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

interface RecordOptions {
  incidentId?: string;
  detectedAt?: string;
  recordedAt?: string;
  severity?: "p0" | "p1" | "p2" | "p3";
  status?: "resolved" | "mitigated";
  incidentType?: "health" | "update";
  postIncidentReview?: "yes" | "no";
  residualRiskIds?: string;
  followUpTasks?: string;
}

function writeRecord(sourceRoot: string, directory: string, record: string): void {
  const recordDir = path.join(sourceRoot, directory);
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(path.join(recordDir, "incident-record.txt"), record);
}

function createRecord(options: RecordOptions = {}): string {
  const incidentId = options.incidentId ?? "incident-20260715-selftest";
  const detectedAt = options.detectedAt ?? "2026-07-15T01:00:00Z";
  const recordedAt = options.recordedAt ?? "2026-07-15T02:00:00Z";
  const severity = options.severity ?? "p2";
  const status = options.status ?? "resolved";
  const incidentType = options.incidentType ?? "health";
  const postIncidentReview = options.postIncidentReview ?? "yes";
  return [
    `incidentId: ${incidentId}`,
    `detectedAt: ${detectedAt}`,
    `recordedAt: ${recordedAt}`,
    "operator: selftest",
    "environment: production",
    `severity: ${severity}`,
    `status: ${status}`,
    `incidentType: ${incidentType}`,
    "source: redacted selftest evidence",
    "evidenceClass: local",
    "publicHealthStatus: pass",
    "userImpact: redacted selftest impact",
    "containmentAction: held action during selftest",
    "recoveryAction: verified local fixture only",
    "rollbackDecision: not-needed",
    `readinessSummaryHash: sha256:${"a".repeat(64)}`,
    `evidenceBundleHash: sha256:${"b".repeat(64)}`,
    `alertPreviewHash: sha256:${"c".repeat(64)}`,
    "highRiskConfirmation: not-applicable",
    `residualRiskIds: ${options.residualRiskIds ?? (status === "resolved" ? "none" : "AF-RISK-OPS-004")}`,
    `followUpTasks: ${options.followUpTasks ?? "tasks/indexes/residuals.md, docs/development/incident-record-template.md"}`,
    `postIncidentReview: ${postIncidentReview}`,
    "safetyFacts:",
    "  productionWriteAttempted: no",
    "  serverCommandAttempted: no",
    "  backupRestoreAttempted: no",
    "  migrationAttempted: no",
    "  updaterApplyAttempted: no",
    "  rollbackAttempted: no",
    "  secretValuePrinted: no",
    "  realStudyContentIncluded: no",
    "",
  ].join("\n");
}

function testSymlinksWhenSupported(): void {
  const targetRoot = path.join(tempDir, "symlink-target");
  writeRecord(targetRoot, "incident-target", createRecord());

  const directoryLinkRoot = path.join(tempDir, "directory-link-root");
  mkdirSync(directoryLinkRoot);
  try {
    symlinkSync(path.join(targetRoot, "incident-target"), path.join(directoryLinkRoot, "incident-linked"), "dir");
  } catch (error) {
    if (isUnsupportedSymlink(error)) return;
    throw error;
  }
  const directoryLink = run(["exec", "tsx", "scripts/ops/incident-index.ts", directoryLinkRoot]);
  expectStatus("symlink incident directory fails", directoryLink, 1);
  assert(directoryLink.stderr.includes("directory must not be a symlink"), "directory symlink failure must be explicit");

  const recordLinkRoot = path.join(tempDir, "record-link-root");
  const recordLinkDir = path.join(recordLinkRoot, "incident-linked-record");
  mkdirSync(recordLinkDir, { recursive: true });
  symlinkSync(path.join(targetRoot, "incident-target", "incident-record.txt"), path.join(recordLinkDir, "incident-record.txt"), "file");
  const recordLink = run(["exec", "tsx", "scripts/ops/incident-index.ts", recordLinkRoot]);
  expectStatus("symlink incident record fails", recordLink, 1);
  assert(recordLink.stderr.includes("record must not be a symlink"), "record symlink failure must be explicit");
}

function isUnsupportedSymlink(error: unknown): boolean {
  return error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code));
}

function testRepositoryAncestorSymlinkWhenSupported(): void {
  const repositoryRoot = path.join(tempDir, "repository-root");
  const outsideRoot = path.join(tempDir, "outside-root");
  const outsideRecords = path.join(outsideRoot, "records");
  mkdirSync(outsideRecords, { recursive: true });
  mkdirSync(path.join(repositoryRoot, "container"), { recursive: true });
  try {
    symlinkSync(outsideRoot, path.join(repositoryRoot, "container", "link"), "dir");
  } catch (error) {
    if (isUnsupportedSymlink(error)) return;
    throw error;
  }
  let rejected = false;
  try {
    resolveSafeIncidentSourceRoot(path.join(repositoryRoot, "container", "link", "records"), repositoryRoot);
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("repository-internal symlink");
  }
  assert(rejected, "repository-internal ancestor symlink must be rejected");
}

function run(args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync("pnpm", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env, NO_COLOR: "1" } }) as SpawnSyncReturns<string>;
}

function expectStatus(label: string, result: SpawnSyncReturns<string>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${String(result.status)}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
