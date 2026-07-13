import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReleaseCloseoutAudit } from "../ops/release-closeout-audit";
import { validateReleaseCloseoutAudit } from "./release-closeout-audit-validate";

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
    const passValidator = () => ({ status: "pass" as const, command: "fixture validator", issueFields: [] });
    const ready = buildReleaseCloseoutAudit({ root, version, generatedAt: "2026-07-13T00:00:00Z", validatorRunner: passValidator });
    assert(ready.status === "ready_for_human_review", "ready fixture should reach human review");
    assert(validateReleaseCloseoutAudit(JSON.stringify(ready)).length === 0, "ready audit should validate");

    writeLedger(root, "current-blocker");
    const blockedResidual = buildReleaseCloseoutAudit({ root, version, validatorRunner: passValidator });
    assert(blockedResidual.status === "blocked", "current blocker residual should block closeout");
    assert(blockedResidual.residuals.currentBlockerIds.includes("AF-RISK-SC-001"), "current blocker should be projected");

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
    const validatorFailure = buildReleaseCloseoutAudit({
      root,
      version,
      validatorRunner: (script) => script.includes("release-evidence")
        ? { status: "fail", command: "fixture validator", issueFields: ["databaseBackupSha256"] }
        : passValidator(),
    });
    assert(validatorFailure.checks.releaseRecord.status === "blocked", "release validator failure should block closeout");

    const tampered = { ...ready, auditHash: `sha256:${"0".repeat(64)}` };
    assert(validateReleaseCloseoutAudit(JSON.stringify(tampered)).some((issue) => issue.field === "auditHash"), "tampered audit hash should fail validation");
    console.log("release closeout audit selftest passed.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root: string): void {
  writeText(root, "package.json", JSON.stringify({ name: "fixture", version }));
  writeReleaseRecord(root);
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

function writeLedger(root: string, firstType: string, includeSecond = true): void {
  const items = [
    residual("AF-RISK-SC-001", firstType),
    ...(includeSecond ? [residual("AF-RISK-REL-001", "accepted-exception")] : []),
  ];
  writeText(root, "docs/development/residual-risk-ledger.json", JSON.stringify({ schemaVersion: 1, items }));
}

function residual(id: string, type: string): Record<string, unknown> {
  return { id, type, reviewAt: "2026-08-01", ownerSkills: ["fixture-owner"] };
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
