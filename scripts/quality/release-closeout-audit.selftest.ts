import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReleaseCloseoutAudit } from "../ops/release-closeout-audit";
import { validateReleaseCloseoutAudit } from "./release-closeout-audit-validate";
import {
  computeAcceptedExceptionBasisHash,
  type AcceptedExceptionStatus,
  type ResidualItemV2,
} from "./residual-ledger-common";

const version = "1.2.3";
const commit = "a".repeat(40);
const webDigest = `ghcr.io/areasong/areaforge-web:v${version}@sha256:${"b".repeat(64)}`;
const migrationDigest = `ghcr.io/areasong/areaforge-migration:v${version}@sha256:${"c".repeat(64)}`;
const previousImage = `ghcr.io/areasong/areaforge-web:v1.2.2@sha256:${"d".repeat(64)}`;
const bundleHash = `sha256:${"e".repeat(64)}`;

function main(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-release-closeout-audit-"));
  try {
    writeFixture(root);
    const validatorScripts: string[] = [];
    const passValidator = (script?: string) => {
      if (script) validatorScripts.push(script);
      return { status: "pass" as const, command: "fixture validator", issueFields: [] };
    };
    const pending = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(pending.status === "pending_observation", "valid D14 observation should remain pending");
    assert(pending.checks.postReleaseObservation.validator.command === "fixture validator", "observation validator fixture should be used");
    assert(validatorScripts.includes("scripts/quality/post-release-observation-validate.ts"), "observation validator path should match the contract");
    assert(pending.source.inputHashes.some((item) => item.key === "postReleaseObservation"), "observation source hash should be bound");
    assert(pending.pendingBy.some((item) => item.startsWith("postReleaseObservation:")), "pending observation must be projected separately from blockers");
    assert(pending.blockedBy.length === 0 && pending.attentionBy.length === 0, "clean pending fixture must not fabricate blockers or attention items");
    assert(pending.checks.residualLedger.status === "pass", "legal V2 residual ledger should pass the strict reader");
    assert(pending.residuals.acceptedExceptions.some((item) => item.id === "AF-RISK-REL-001" && item.effective), "current approved exception should be accepted");
    assert(validateReleaseCloseoutAudit(JSON.stringify(pending)).length === 0, "pending audit should validate");

    rmSync(path.join(root, "docs/development/residual-risk-ledger.json"));
    const missingLedger = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(missingLedger.checks.residualLedger.status === "blocked", "missing residual ledger should block explicitly");
    assert(missingLedger.checks.residualLedger.issues.length > 0, "missing residual ledger should retain reader issues");
    assert(missingLedger.residuals.missingLedgerIds.length === 0, "missing ledger must not masquerade as an empty ledger");
    assert(missingLedger.checks.residualConsistency.status === "blocked", "missing ledger should fail residual consistency closed");
    assert(validateReleaseCloseoutAudit(JSON.stringify(missingLedger)).length === 0, "missing-ledger blocked audit should validate");

    writeV1Ledger(root);
    const v1Ledger = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(v1Ledger.checks.residualLedger.status === "blocked", "schema V1 residual ledger should be rejected");
    assert(v1Ledger.checks.residualLedger.issues.some((issue) => issue.field === "schemaVersion"), "V1 rejection should identify schemaVersion");
    assert(validateReleaseCloseoutAudit(JSON.stringify(v1Ledger)).length === 0, "V1-rejected blocked audit should validate");

    writeLedger(root, "closed-evidence", true, "approved", true);
    const basisDrift = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(basisDrift.checks.residualLedger.status === "blocked", "accepted exception basis drift should invalidate the V2 ledger");
    assert(basisDrift.checks.residualLedger.issues.some((issue) => issue.field.endsWith("basisHash")), "basis drift should retain the canonical hash issue");
    assert(validateReleaseCloseoutAudit(JSON.stringify(basisDrift)).length === 0, "basis-drift blocked audit should validate");

    writeLedger(root, "closed-evidence", true, "approved");
    const approvedException = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(approvedException.checks.residualConsistency.status === "pass", "current approved accepted exception should pass closeout residual semantics");
    assert(approvedException.residuals.blockedAcceptedExceptionIds.length === 0, "approved exception should not be blocked");

    for (const status of ["expired", "revoked", "superseded"] as const) {
      writeLedger(root, "closed-evidence", true, status);
      const rejectedException = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-16T00:00:00Z", validatorRunner: passValidator });
      assert(rejectedException.checks.residualLedger.status === "pass", `${status} exception fixture should remain a legal V2 ledger`);
      assert(rejectedException.checks.residualConsistency.status === "blocked", `${status} accepted exception should fail closeout closed`);
      assert(rejectedException.residuals.blockedAcceptedExceptionIds.includes("AF-RISK-REL-001"), `${status} exception should be projected as blocked`);
      assert(validateReleaseCloseoutAudit(JSON.stringify(rejectedException)).length === 0, `${status} blocked audit should validate`);
    }

    writeLedger(root, "current-blocker");
    const blockedResidual = buildReleaseCloseoutAudit({ root, version, validatorRunner: passValidator });
    assert(blockedResidual.status === "blocked", "current blocker residual should block closeout");
    assert(blockedResidual.residuals.currentBlockerIds.includes("AF-RISK-SC-001"), "current blocker should be projected");
    assert(blockedResidual.blockedBy.some((item) => item.startsWith("residualConsistency:")), "blocked residual must be projected in blockedBy");

    writeLedger(root, "closed-evidence", false);
    const missingResidual = buildReleaseCloseoutAudit({ root, version, validatorRunner: passValidator });
    assert(missingResidual.status === "blocked", "missing ledger residual should block closeout");
    assert(missingResidual.residuals.missingLedgerIds.includes("AF-RISK-REL-001"), "missing residual ID should be reported");

    writeLedger(root, "closed-evidence");
    writeSupplyRecord(root, { gitCommit: "f".repeat(40) });
    const identityMismatch = buildReleaseCloseoutAudit({ root, version, validatorRunner: passValidator });
    assert(identityMismatch.checks.identityConsistency.status === "blocked", "identity mismatch should block closeout");

    writeSupplyRecord(root);
    writeReleaseRecord(root, { operationalEvidenceBundleHash: `sha256:${"f".repeat(64)}` });
    const hashMismatch = buildReleaseCloseoutAudit({ root, version, validatorRunner: passValidator });
    assert(hashMismatch.checks.operationalEvidence.status === "blocked", "operational evidence hash mismatch should block closeout");

    writeReleaseRecord(root);
    writeObservation(root, "fail");
    const thresholdFailure = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(thresholdFailure.checks.postReleaseObservation.status === "blocked", "explicit real threshold failure should block closeout");

    writeObservation(root, "pending", { version: "1.2.4", releaseTag: "v1.2.4" });
    const observationIdentityFailure = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(observationIdentityFailure.checks.postReleaseObservation.status === "blocked", "observation identity mismatch should block closeout");

    writeObservation(root, "pending", { releasedAt: "2026-07-02T10:30:00Z" });
    const observationReleaseTimeFailure = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(observationReleaseTimeFailure.checks.postReleaseObservation.status === "blocked", "observation release timestamp mismatch should block closeout");

    writeObservation(root, "pending", {}, `sha256:${"0".repeat(64)}`);
    const observationHashFailure = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-14T00:00:00Z", validatorRunner: passValidator });
    assert(observationHashFailure.checks.postReleaseObservation.status === "blocked", "observation source hash mismatch should block closeout");

    writeObservation(root);
    const expiredMissing = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-16T00:00:00Z", validatorRunner: passValidator });
    assert(expiredMissing.status === "needs_attention", "expired missing observation should need attention");
    assert(expiredMissing.attentionBy.some((item) => item.startsWith("postReleaseObservation:")), "expired observation must be projected in attentionBy");

    writeObservation(root, "pass");
    const ready = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-08-01T00:00:00Z", validatorRunner: passValidator });
    assert(ready.status === "ready_for_human_review", "completed D14/D30 observation should reach human review");

    writeObservation(root);
    writeReleaseRecord(root);
    const validatorFailure = buildReleaseCloseoutAudit({
      root,
      version,
      validatorRunner: (script) => script.includes("release-evidence")
        ? { status: "fail", command: "fixture validator", issueFields: ["databaseBackupSha256"] }
        : passValidator(),
    });
    assert(validatorFailure.checks.releaseRecord.status === "blocked", "release validator failure should block closeout");

    const tampered = { ...pending, auditHash: `sha256:${"0".repeat(64)}` };
    assert(validateReleaseCloseoutAudit(JSON.stringify(tampered)).some((issue) => issue.field === "auditHash"), "tampered audit hash should fail validation");
    console.log("release closeout audit selftest passed.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root: string): void {
  writeText(root, "package.json", JSON.stringify({ name: "fixture", version }));
  writeReleaseRecord(root);
  writeObservation(root);
  writeSupplyRecord(root);
  writeText(root, `docs/development/operational-evidence-bundle-v${version}.json`, JSON.stringify({
    schemaVersion: 1,
    status: "ready",
    bundleHash: bundleHash.slice("sha256:".length),
    summary: { overall: "pass" },
  }));
  writeLedger(root, "closed-evidence");
}

function writeReleaseRecord(root: string, overrides: Record<string, string> = {}): void {
  const values = {
    releaseTag: `v${version}`,
    gitCommit: commit,
    releasedAt: "2026-07-01T10:30:00Z",
    webImageDigest: webDigest,
    migrationImageDigest: migrationDigest,
    residualRiskIds: "AF-RISK-SC-001,AF-RISK-REL-001",
    operationalEvidenceBundlePath: `docs/development/operational-evidence-bundle-v${version}.json`,
    operationalEvidenceBundleHash: bundleHash,
    rollbackTargetVersion: "1.2.2",
    previousAppVersion: "1.2.2",
    rollbackTargetImage: previousImage,
    previousImage,
    ...overrides,
  };
  writeText(root, `docs/development/release-v${version}-record.md`, record(values));
}

const observationPath = `docs/development/post-release-observation-v${version}.json`;

function writeObservation(
  root: string,
  state: "pending" | "pass" | "fail" = "pending",
  releaseOverrides: Record<string, unknown> = {},
  releaseRecordHash?: string,
): void {
  const releaseRecordPath = `docs/development/release-v${version}-record.md`;
  const releaseRaw = readFileSync(path.join(root, releaseRecordPath), "utf8");
  const d14 = checkpoint("2026-07-15", state);
  const d30 = checkpoint("2026-07-31", state === "fail" ? "pass" : state);
  const observation = {
    schemaVersion: 1,
    mode: "post_release_observation",
    release: {
      version,
      releaseTag: `v${version}`,
      gitCommit: commit,
      releasedAt: "2026-07-01T10:30:00Z",
      releaseRecord: { path: releaseRecordPath, sha256: releaseRecordHash ?? sourceHash(releaseRaw) },
      ...releaseOverrides,
    },
    checkpoints: { d14, d30 },
    gate: state === "fail"
      ? { status: "fail", reasons: ["d14_failed"] }
      : state === "pass"
        ? { status: "pass", reasons: ["d14_and_d30_passed"] }
        : { status: "pending_observation", reasons: ["d14_pending_observation", "d30_pending_observation"] },
    safetyFacts: {
      readOnlyEvidence: true,
      networkRequested: false,
      productionWriteAttempted: false,
      residualLedgerUpdated: false,
      fileWriteAttempted: false,
    },
  };
  writeText(root, observationPath, JSON.stringify(observation));
}

function checkpoint(dueDate: string, state: "pending" | "pass" | "fail"): Record<string, unknown> {
  const pending = state === "pending";
  const failed = state === "fail";
  const gate = failed
    ? { status: "fail", reasons: ["observation_failed"] }
    : pending
      ? { status: "pending_observation", reasons: ["observation_pending"] }
      : { status: "pass", reasons: ["checkpoint_observation_passed"] };
  if (dueDate === "2026-07-15") return {
    dueDate,
    observedAt: pending ? null : `${dueDate}T12:00:00Z`,
    technicalObservation: observationItem(failed ? "fail" : pending ? "pending_observation" : "pass", pending),
    incident: observationItem(pending ? "pending_observation" : "none", pending),
    errorBudget: observationItem(pending ? "pending_observation" : "within_budget", pending),
    gate,
  };
  return {
    dueDate,
    observedAt: pending ? null : `${dueDate}T12:00:00Z`,
    productReview: observationItem(failed ? "fail" : pending ? "pending_observation" : "pass", pending),
    gate,
  };
}

function observationItem(status: string, pending: boolean): Record<string, unknown> {
  return { status, summary: pending ? "awaiting scheduled observation" : "fixture evidence reviewed", evidence: pending ? [] : ["fixture/evidence.json"] };
}

function sourceHash(raw: string): string {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function writeSupplyRecord(root: string, overrides: Record<string, string> = {}): void {
  const values = {
    releaseTag: `v${version}`,
    packageVersion: version,
    gitCommit: commit,
    webImageDigest: webDigest,
    migrationImageDigest: migrationDigest,
    residualRiskIds: "AF-RISK-SC-001",
    ...overrides,
  };
  writeText(root, `docs/development/release-supply-chain-v${version}.md`, record(values));
}

function writeLedger(
  root: string,
  firstType: string,
  includeSecond = true,
  exceptionStatus: AcceptedExceptionStatus = "approved",
  driftBasis = false,
): void {
  const items = [
    residual("AF-RISK-SC-001", firstType),
    ...(includeSecond ? [acceptedExceptionResidual("AF-RISK-REL-001", exceptionStatus, driftBasis)] : []),
  ];
  writeText(root, "docs/development/residual-risk-ledger.json", JSON.stringify({
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items,
  }));
}

function writeV1Ledger(root: string): void {
  writeText(root, "docs/development/residual-risk-ledger.json", JSON.stringify({
    schemaVersion: 1,
    items: [{ id: "AF-RISK-SC-001", type: "closed-evidence", reviewAt: "2026-12-31", ownerSkills: ["fixture-owner"] }],
  }));
}

function residual(id: string, type: string): ResidualItemV2 {
  return {
    id,
    type: type as ResidualItemV2["type"],
    reviewAt: "2026-12-31",
    currentImpact: "fixture residual impact",
    executableNow: false,
    closeCondition: "fixture close condition",
    requiredEvidence: "fixture evidence",
    ownerSkills: ["fixture-owner"],
    taskRefs: [],
    taskPromotionWaiver: null,
    acceptedException: null,
  };
}

function acceptedExceptionResidual(
  id: string,
  status: AcceptedExceptionStatus,
  driftBasis: boolean,
): ResidualItemV2 {
  const item = residual(id, "accepted-exception");
  item.acceptedException = {
    status,
    scope: "release closeout fixture",
    reason: "fixture exception rationale",
    acceptedBy: "fixture-maintainer",
    acceptedAt: "2026-01-01T00:00:00Z",
    expiresAt: status === "expired" ? "2026-07-10T00:00:00Z" : "2026-12-31T00:00:00Z",
    reopenConditions: ["fixture condition changes"],
    basisHash: `sha256:${"0".repeat(64)}`,
    sourceRef: "fixture/accepted-exception.md",
    revokedBy: status === "revoked" ? "fixture-maintainer" : null,
    revokedAt: status === "revoked" ? "2026-07-10T00:00:00Z" : null,
    revocationReason: status === "revoked" ? "fixture revocation" : null,
    supersededBy: status === "superseded" ? "AF-RISK-REL-099" : null,
  };
  item.acceptedException.basisHash = driftBasis
    ? `sha256:${"f".repeat(64)}`
    : computeAcceptedExceptionBasisHash(item);
  return item;
}

function record(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}: ${value}`).join("\n");
}

function writeText(root: string, file: string, body: string): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body, "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main();
