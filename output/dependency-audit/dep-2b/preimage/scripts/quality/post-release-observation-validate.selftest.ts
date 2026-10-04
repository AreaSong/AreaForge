import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deriveD14Gate,
  deriveD30Gate,
  deriveOverallGate,
  validatePostReleaseObservation,
  type D14Checkpoint,
  type D30Checkpoint,
  type EvidenceReference,
  type PostReleaseObservationRecord,
} from "./post-release-observation-validate";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-post-release-observation-validator-"));
const version = "1.2.3";
const releasePath = `docs/development/release-v${version}-record.md`;
const gitCommit = "a".repeat(40);
const releasedAt = "2026-07-16T10:30:00Z";

try {
  const releaseBody = `releaseTag: v${version}\nreleasedAt: ${releasedAt}\ngitCommit: ${gitCommit}\n`;
  writeFixture(releasePath, releaseBody);
  const technicalEvidence = writeEvidence("evidence/technical.json", "technical pass\n");
  const incidentEvidence = writeEvidence("evidence/incident.json", "no incident\n");
  const budgetEvidence = writeEvidence("evidence/error-budget.json", "within budget\n");
  const productEvidence = writeEvidence("evidence/product-review.json", "product review pass\n");
  const evidence = { technicalEvidence, incidentEvidence, budgetEvidence, productEvidence };

  const pending = buildRecord(releaseBody, evidence);
  expectPass(pending, "pending observation is a legal waiting state");
  assert(pending.gate.status === "pending_observation", "pending must not be projected as fail");

  const passed = buildRecord(releaseBody, evidence, "pass");
  expectPass(passed, "completed D14/D30 observations");
  const failed = buildRecord(releaseBody, evidence, "fail");
  expectPass(failed, "explicit D14 technical failure");

  expectFail({ ...pending, unexpected: true }, "unknown top-level key", "record");
  expectFail(patch(pending, (body) => { (body.checkpoints.d14 as unknown as Record<string, unknown>).productReview = body.checkpoints.d30.productReview; }), "D30 field in D14", "checkpoints.d14");
  expectFail(patch(pending, (body) => { (body.checkpoints.d30 as unknown as Record<string, unknown>).technicalObservation = body.checkpoints.d14.technicalObservation; }), "D14 field in D30", "checkpoints.d30");
  expectFail(patch(pending, (body) => { body.checkpoints.d14.dueDate = "2026-07-29"; }), "incorrect D14 date", "checkpoints.d14.dueDate");
  expectFail(patch(pending, (body) => { body.release.releaseRecord.path = "docs/development/other-release.md"; }), "non-canonical Release record path", "release.releaseRecord.path");
  expectFail(patch(pending, (body) => { body.release.releaseTag = "v1.2.4"; }), "Release record tag mismatch", "release.releaseRecord.releaseTag");
  expectFail(patch(pending, (body) => { body.release.releasedAt = "2026-07-17T10:30:00Z"; }), "Release record timestamp mismatch", "release.releaseRecord.releasedAt");
  expectFail(patch(pending, (body) => { body.release.gitCommit = "b".repeat(40); }), "Release record identity mismatch", "release.releaseRecord.gitCommit");
  expectFail(patch(pending, (body) => { body.release.releaseRecord.sha256 = `sha256:${"0".repeat(64)}`; }), "Release record hash mismatch", "release.releaseRecord.sha256");
  expectFail(patch(pending, (body) => { body.gate = { status: "pass", reasons: ["d14_and_d30_passed"] }; }), "forged overall gate", "gate.status");
  expectFail(patch(pending, (body) => { body.checkpoints.d14.gate = { status: "fail", reasons: ["technical_observation_failed"] }; }), "forged D14 gate", "checkpoints.d14.gate.status");
  expectFail(patch(passed, (body) => { body.checkpoints.d30.productReview.evidence = []; }), "completed observation without evidence", "checkpoints.d30.productReview.evidence");
  expectFail(patch(passed, (body) => { body.checkpoints.d14.technicalObservation.evidence[0]!.path = "../outside.json"; }), "unsafe evidence path", "checkpoints.d14.technicalObservation.evidence[0].path");
  expectFail(patch(passed, (body) => { body.checkpoints.d14.technicalObservation.evidence[0]!.sha256 = `sha256:${"0".repeat(64)}`; }), "evidence hash mismatch", "checkpoints.d14.technicalObservation.evidence[0].sha256");
  expectFail(patch(passed, (body) => { (body.checkpoints.d14.technicalObservation.evidence[0] as unknown as Record<string, unknown>).extra = true; }), "unknown evidence field", "checkpoints.d14.technicalObservation.evidence[0]");

  mkdirSync(path.join(root, "evidence/directory"));
  expectFail(patch(passed, (body) => { body.checkpoints.d14.technicalObservation.evidence[0] = reference("evidence/directory", "directory"); }), "directory evidence", "checkpoints.d14.technicalObservation.evidence[0].path");
  symlinkSync(path.join(root, technicalEvidence.path), path.join(root, "evidence/link.json"));
  expectFail(patch(passed, (body) => { body.checkpoints.d14.technicalObservation.evidence[0] = { path: "evidence/link.json", sha256: technicalEvidence.sha256 }; }), "symlink evidence", "checkpoints.d14.technicalObservation.evidence[0].path");
  console.log("post-release observation validator selftest passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

type EvidenceSet = {
  technicalEvidence: EvidenceReference;
  incidentEvidence: EvidenceReference;
  budgetEvidence: EvidenceReference;
  productEvidence: EvidenceReference;
};

function buildRecord(releaseBody: string, evidence: EvidenceSet, state: "pending" | "pass" | "fail" = "pending"): PostReleaseObservationRecord {
  const d14 = d14Checkpoint("2026-07-30", state, evidence);
  const d30 = d30Checkpoint("2026-08-15", state === "fail" ? "pass" : state, evidence.productEvidence);
  const checkpoints = { d14, d30 };
  return {
    schemaVersion: 1,
    mode: "post_release_observation",
    release: {
      version,
      releaseTag: `v${version}`,
      releasedAt,
      gitCommit,
      releaseRecord: reference(releasePath, releaseBody),
    },
    checkpoints,
    gate: deriveOverallGate(checkpoints),
    safetyFacts: { readOnlyEvidence: true, networkRequested: false, productionWriteAttempted: false, residualLedgerUpdated: false, fileWriteAttempted: false },
  };
}

function d14Checkpoint(dueDate: string, state: "pending" | "pass" | "fail", evidence: EvidenceSet): D14Checkpoint {
  const pending = state === "pending";
  const value: D14Checkpoint = {
    dueDate,
    observedAt: pending ? null : `${dueDate}T12:00:00Z`,
    technicalObservation: item(state === "fail" ? "fail" : pending ? "pending_observation" : "pass", pending, evidence.technicalEvidence),
    incident: item(pending ? "pending_observation" : "none", pending, evidence.incidentEvidence),
    errorBudget: item(pending ? "pending_observation" : "within_budget", pending, evidence.budgetEvidence),
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
  return { status, summary: pending ? "awaiting scheduled observation" : "selftest evidence reviewed", evidence: pending ? [] : [evidence] };
}

function expectPass(value: PostReleaseObservationRecord, label: string): void {
  const issues = validatePostReleaseObservation(JSON.stringify(value), { root });
  if (issues.length > 0) throw new Error(`${label} should pass: ${JSON.stringify(issues)}`);
}

function expectFail(value: unknown, label: string, field: string): void {
  const issues = validatePostReleaseObservation(JSON.stringify(value), { root });
  if (!issues.some((issue) => issue.field === field)) throw new Error(`${label} should fail at ${field}: ${JSON.stringify(issues)}`);
}

function patch(record: PostReleaseObservationRecord, mutate: (body: PostReleaseObservationRecord) => void): PostReleaseObservationRecord {
  const body = structuredClone(record);
  mutate(body);
  return body;
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
