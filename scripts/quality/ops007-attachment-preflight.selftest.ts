import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOps007AttachmentPreflight,
  ops007PreflightExitCode,
  type Ops007PreflightStatus,
} from "./ops007-attachment-preflight";

const repositoryRoot = process.cwd();
const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ops007-preflight-"));

try {
  copySources();

  const awaiting = expectStatus("awaiting_high_risk_confirmation");
  if (ops007PreflightExitCode(awaiting.status, false) !== 0) {
    throw new Error("OPS-007 projection mode must allow an awaiting confirmation result");
  }
  if (ops007PreflightExitCode(awaiting.status, true) !== 1) {
    throw new Error("OPS-007 strict mode must fail closed while awaiting high-risk confirmation");
  }
  if (ops007PreflightExitCode("invalid", false) !== 1) {
    throw new Error("OPS-007 invalid evidence must fail closed in projection mode");
  }
  if (awaiting.evidenceClass !== "protocol_preimage_candidate") {
    throw new Error("OPS-007 preflight must use protocol_preimage_candidate evidenceClass");
  }
  assertHashes(awaiting);
  assertClaimBoundaries(awaiting);

  expectSourceDrift(
    "tasks/backlog/0021-attachment-staging-intent.md",
    "phase: awaiting-high-risk-confirmation",
    "phase: implementation-authorized",
    "taskSha256",
    awaiting,
  );
  expectSourceDrift(
    "docs/development/ops-007-attachment-crash-window-design.md",
    "OPS-007-PREFLIGHT-CONTRACT-V1",
    "OPS-007-PREFLIGHT-CONTRACT-DRIFT",
    "designSha256",
    awaiting,
  );
  expectSourceDrift(
    "docs/development/high-risk-confirmation-packets.md",
    "OPS-007-PREFLIGHT-CONTRACT-V1",
    "OPS-007-PREFLIGHT-CONTRACT-DRIFT",
    "confirmationPacketSha256",
    awaiting,
  );
  expectSourceDrift(
    "prisma/schema.prisma",
    "storedName   String",
    "storedName   String @unique",
    "schemaSha256",
    awaiting,
  );

  const fixture = path.join(
    root,
    "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json",
  );
  const originalFixture = readFileSync(fixture, "utf8");
  writeFileSync(fixture, originalFixture.replace('"status": "pass"', '"status": "invalid"'));
  const fixtureDrift = expectStatus("invalid");
  if (fixtureDrift.evidence.fixtureFileSha256 === awaiting.evidence.fixtureFileSha256) {
    throw new Error("OPS-007 fixture file hash must change after fixture tampering");
  }
  if (fixtureDrift.evidence.sourceBindingHash === awaiting.evidence.sourceBindingHash) {
    throw new Error("OPS-007 sourceBindingHash must change after fixture tampering");
  }

  console.log("ops007 attachment preflight selftest passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function copySources(): void {
  const relativeFiles = [
    "tasks/backlog/0021-attachment-staging-intent.md",
    "docs/development/ops-007-attachment-crash-window-design.md",
    "docs/development/high-risk-confirmation-packets.md",
    "prisma/schema.prisma",
    "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json",
  ];
  for (const relative of relativeFiles) {
    const destination = path.join(root, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(repositoryRoot, relative), destination);
  }
}

function expectStatus(expected: Ops007PreflightStatus) {
  const result = buildOps007AttachmentPreflight({ root });
  if (result.status !== expected) {
    throw new Error(`expected OPS-007 status ${expected}, got ${result.status}: ${JSON.stringify(result.checks)}`);
  }
  return result;
}

function expectSourceDrift(
  relative: string,
  before: string,
  after: string,
  evidenceKey: "taskSha256" | "designSha256" | "confirmationPacketSha256" | "schemaSha256",
  baseline: ReturnType<typeof buildOps007AttachmentPreflight>,
): void {
  const file = path.join(root, relative);
  const original = readFileSync(file, "utf8");
  if (!original.includes(before)) throw new Error(`selftest source marker missing: ${relative}: ${before}`);
  writeFileSync(file, original.replace(before, after));
  const drift = expectStatus("invalid");
  if (drift.evidence[evidenceKey] === baseline.evidence[evidenceKey]) {
    throw new Error(`OPS-007 ${evidenceKey} must change after source drift`);
  }
  if (drift.evidence.sourceBindingHash === baseline.evidence.sourceBindingHash) {
    throw new Error("OPS-007 sourceBindingHash must change after source drift");
  }
  writeFileSync(file, original);
}

function assertHashes(result: ReturnType<typeof buildOps007AttachmentPreflight>): void {
  const hashes = [
    result.evidence.taskSha256,
    result.evidence.designSha256,
    result.evidence.confirmationPacketSha256,
    result.evidence.schemaSha256,
    result.evidence.fixtureFileSha256,
    result.evidence.fixtureHash,
    result.evidence.sourceBindingHash,
    result.evidence.implementationConfirmationPhraseSha256,
  ];
  if (hashes.some((value) => !value || !/^sha256:[a-f0-9]{64}$/.test(value))) {
    throw new Error("OPS-007 preflight must bind every source and fixture hash");
  }
}

function assertClaimBoundaries(result: ReturnType<typeof buildOps007AttachmentPreflight>): void {
  const required = [
    "candidate or applied database migration",
    "attachment runtime protocol implementation",
    "filesystem durability, atomic rename, fsync, or O_NOFOLLOW behavior",
    "production attachment safety or production state",
  ];
  for (const claim of required) {
    if (!result.doesNotProve.includes(claim)) {
      throw new Error(`OPS-007 preflight must explicitly exclude proof of ${claim}`);
    }
  }
  if (
    !result.safetyFacts.readOnly ||
    result.safetyFacts.databaseConnectionAttempted ||
    result.safetyFacts.uploadDirectoryReadAttempted ||
    result.safetyFacts.migrationAttempted ||
    result.safetyFacts.productionWriteAttempted ||
    result.safetyFacts.secretValueReadOrPrinted
  ) {
    throw new Error("OPS-007 preflight safety facts must remain strictly read-only and offline");
  }
}
