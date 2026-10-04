import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildResidualPromotionPreview,
  verifyResidualPromotionPreviewHash,
} from "../ops/residual-promotion-preview";
import {
  computeAcceptedExceptionBasisHash,
  type ResidualItemV2,
} from "./residual-ledger-common";

function main(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-residual-promotion-preview-"));
  try {
    writeFixture(root);
    const before = snapshot(root);
    const preview = buildResidualPromotionPreview({
      root,
      now: new Date("2050-01-05T12:00:00.000Z"),
      generatedAt: "2050-01-05T12:00:00.000Z",
    });
    assert(preview.status === "needs_attention", "non-effective exception should require attention");
    assert(preview.source.validationStatus === "valid" && preview.source.schemaVersion === 2, "valid V2 source must be bound");
    assert(record(preview, "AF-RISK-OPS-001").promotionState === "active_task_bound", "active task binding missing");
    assert(record(preview, "AF-RISK-OPS-002").promotionState === "waiver_backed", "current waiver should be projected");
    assert(record(preview, "AF-RISK-OPS-002").eligibleForHumanPromotionReview, "waiver-backed residual should be reviewable for promotion");
    assert(record(preview, "AF-RISK-OPS-003").promotionState === "backlog_bound_not_executable", "backlog state missing");
    assert(record(preview, "AF-RISK-REL-001").promotionState === "accepted_exception_effective", "approved exception projection missing");
    assert(record(preview, "AF-RISK-REL-002").promotionState === "accepted_exception_non_effective", "expired exception projection missing");
    assert(preview.records.every((item) => !item.writesTask && !item.writesLedger), "preview must not authorize writes");
    assert(verifyResidualPromotionPreviewHash(preview), "preview hash should verify");
    assert(!verifyResidualPromotionPreviewHash({ ...preview, status: "blocked" }), "tampered preview must fail hash verification");
    assert(JSON.stringify(snapshot(root)) === JSON.stringify(before), "preview must not mutate fixture files");

    write(root, "docs/development/residual-risk-ledger.json", JSON.stringify({ schemaVersion: 1, items: [] }));
    const v1 = buildResidualPromotionPreview({ root, now: new Date("2050-01-05T12:00:00.000Z") });
    assert(v1.status === "blocked" && v1.source.validationStatus === "invalid", "V1 ledger must fail closed");
    assert(v1.blockedBy.some((item) => item.field === "schemaVersion"), "V1 issue should identify schemaVersion");

    rmSync(path.join(root, "docs/development/residual-risk-ledger.json"));
    const missing = buildResidualPromotionPreview({ root });
    assert(missing.status === "blocked" && missing.source.validationStatus === "missing", "missing ledger must fail closed");
    assert(verifyResidualPromotionPreviewHash(missing), "blocked preview hash should verify");
    console.log("PASS residual promotion preview selftest");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root: string): void {
  write(root, "docs/development/residual-risk-ledger.md", "fixture ledger\n");
  write(root, "tasks/active/0001-active.md", task("AF-RISK-OPS-001"));
  write(root, "tasks/backlog/0002-backlog.md", task("AF-RISK-OPS-003"));
  const items = [
    residual({
      id: "AF-RISK-OPS-001",
      type: "current-blocker",
      executableNow: true,
      taskRefs: ["tasks/active/0001-active.md"],
    }),
    residual({
      id: "AF-RISK-OPS-002",
      type: "monitoring-gap",
      executableNow: true,
      taskPromotionWaiver: {
        id: "AF-WAIVER-OPS-002",
        scope: "fixture promotion review",
        reason: "temporary execution before task promotion",
        approvedBy: "fixture-maintainer",
        approvedAt: "2050-01-01T00:00:00.000Z",
        expiresAt: "2050-01-10T00:00:00.000Z",
      },
    }),
    residual({
      id: "AF-RISK-OPS-003",
      type: "deferred-work",
      taskRefs: ["tasks/backlog/0002-backlog.md"],
    }),
    acceptedException("AF-RISK-REL-001", "approved", "2050-02-01T00:00:00.000Z"),
    acceptedException("AF-RISK-REL-002", "expired", "2049-12-31T00:00:00.000Z"),
  ];
  write(root, "docs/development/residual-risk-ledger.json", `${JSON.stringify({
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items,
  }, null, 2)}\n`);
}

function residual(overrides: Partial<ResidualItemV2> & Pick<ResidualItemV2, "id" | "type">): ResidualItemV2 {
  const { id, type, ...rest } = overrides;
  return {
    id,
    type,
    reviewAt: "2050-01-15",
    currentImpact: "fixture residual impact",
    executableNow: false,
    closeCondition: "fixture close condition",
    requiredEvidence: "fixture evidence",
    ownerSkills: ["areaforge-residual-ledger"],
    taskRefs: [],
    taskPromotionWaiver: null,
    acceptedException: null,
    ...rest,
  };
}

function acceptedException(
  id: string,
  status: "approved" | "expired",
  expiresAt: string,
): ResidualItemV2 {
  const item = residual({ id, type: "accepted-exception" });
  item.acceptedException = {
    status,
    scope: "fixture accepted exception",
    reason: "fixture rationale",
    acceptedBy: "fixture-maintainer",
    acceptedAt: "2049-12-01T00:00:00.000Z",
    expiresAt,
    reopenConditions: ["fixture source changes"],
    basisHash: "",
    sourceRef: "docs/development/residual-risk-ledger.md",
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    supersededBy: null,
  };
  item.acceptedException.basisHash = computeAcceptedExceptionBasisHash(item);
  return item;
}

function task(residualId: string): string {
  return `# Fixture\n\n\`\`\`yaml\nresidualRiskIds:\n  - ${residualId}\n\`\`\`\n`;
}

function record(preview: ReturnType<typeof buildResidualPromotionPreview>, id: string) {
  const found = preview.records.find((item) => item.residualId === id);
  if (!found) throw new Error(`missing preview record ${id}`);
  return found;
}

function snapshot(root: string): Record<string, string> {
  const files = [
    "docs/development/residual-risk-ledger.md",
    "docs/development/residual-risk-ledger.json",
    "tasks/active/0001-active.md",
    "tasks/backlog/0002-backlog.md",
  ];
  return Object.fromEntries(files.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
}

function write(root: string, file: string, content: string): void {
  const target = path.join(root, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main();
