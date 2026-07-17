import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildResidualReviewDue, type Options } from "../ops/residual-review-due";
import {
  computeAcceptedExceptionBasisHash,
  type ResidualItemV2,
} from "./residual-ledger-common";

const root = mkdtempSync(path.join(tmpdir(), "areaforge-residual-review-due-"));

try {
  writeLedger(root, 2);
  const options: Options = {
    asOf: new Date("2050-01-01T00:00:00.000Z"),
    warnDays: 14,
    failOnOverdue: false,
    failOnDue: false,
    failOnDueSoon: false,
  };
  const projection = buildResidualReviewDue(options, root);
  assert(projection.counts.total === 4, "all valid V2 items must be counted");
  assert(
    projection.dueItems.some((item) => item.id === "AF-RISK-OPS-006" && item.executableNow),
    "due item must expose effective executable state",
  );
  assert(
    projection.nonEffectiveAcceptedExceptionItems.some((item) =>
      item.id === "AF-RISK-AI-001" && item.effectiveExceptionStatus === "expired"
    ),
    "expired accepted exception must be projected as attention",
  );
  assert(
    !projection.nonEffectiveAcceptedExceptionItems.some((item) => item.id === "AF-RISK-REL-001"),
    "effective accepted exception must not be projected as attention",
  );

  writeLedger(root, 1);
  expectThrow(() => buildResidualReviewDue(options, root), "invalid residual ledger schema V2", "V1 ledger must fail closed");
  writeLedger(root, 2, (raw) => raw.replace('"ownerSkills": [', '"ownerSkills": [null,'));
  expectThrow(
    () => buildResidualReviewDue(options, root),
    "invalid residual ledger schema V2",
    "invalid item must fail closed instead of being filtered",
  );
  rmSync(path.join(root, "docs/development/residual-risk-ledger.json"));
  expectThrow(() => buildResidualReviewDue(options, root), "ENOENT", "missing ledger must fail closed");

  console.log("PASS residual review due selftest");
} finally {
  rmSync(root, { force: true, recursive: true });
}

function writeLedger(rootDir: string, schemaVersion: number, mutate: (raw: string) => string = (raw) => raw): void {
  const items = [
    residualItem({
      id: "AF-RISK-OPS-001",
      type: "current-blocker",
      reviewAt: "2049-12-31",
      currentImpact: "overdue fixture",
      closeCondition: "fixture close condition",
      requiredEvidence: "fixture evidence",
      ownerSkills: ["areaforge-sre-ops"],
    }),
    residualItem({
      id: "AF-RISK-OPS-006",
      type: "current-blocker",
      reviewAt: "2050-01-10",
      currentImpact: "executable fixture",
      executableNow: true,
      closeCondition: "fixture close condition",
      requiredEvidence: "fixture evidence",
      ownerSkills: ["areaforge-sre-ops"],
      taskPromotionWaiver: {
        id: "AF-WAIVER-OPS-006",
        scope: "fixture projection",
        reason: "fixture has no task tree",
        approvedBy: "fixture-maintainer",
        approvedAt: "2049-12-20T00:00:00.000Z",
        expiresAt: "2050-01-05T00:00:00.000Z",
      },
    }),
    acceptedExceptionItem("AF-RISK-REL-001", "approved", "2050-02-01"),
    acceptedExceptionItem("AF-RISK-AI-001", "expired", "2049-12-31"),
  ];
  write(rootDir, "docs/development/residual-risk-ledger.md", "fixture residual ledger\n");
  write(rootDir, "docs/development/residual-risk-ledger.json", mutate(`${JSON.stringify({
    schemaVersion,
    source: "docs/development/residual-risk-ledger.md",
    items,
  }, null, 2)}\n`));
}

function residualItem(overrides: Partial<ResidualItemV2> & Pick<ResidualItemV2, "id" | "type" | "reviewAt" | "currentImpact" | "closeCondition" | "requiredEvidence" | "ownerSkills">): ResidualItemV2 {
  return {
    executableNow: false,
    taskRefs: [],
    taskPromotionWaiver: null,
    acceptedException: null,
    ...overrides,
  };
}

function acceptedExceptionItem(id: string, status: "approved" | "expired", expiresAt: string): ResidualItemV2 {
  const item = residualItem({
    id,
    type: "accepted-exception",
    reviewAt: "2050-03-01",
    currentImpact: `${status} accepted exception fixture`,
    closeCondition: "fixture close condition",
    requiredEvidence: "fixture evidence",
    ownerSkills: ["areaforge-ai-governance"],
  });
  item.acceptedException = {
    status,
    scope: "fixture scope",
    reason: "fixture reason",
    acceptedBy: "fixture-maintainer",
    acceptedAt: "2049-12-01T00:00:00.000Z",
    expiresAt,
    reopenConditions: ["fixture changes"],
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

function write(rootDir: string, file: string, content: string): void {
  const target = path.join(rootDir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function expectThrow(action: () => unknown, expected: string, message: string): void {
  try {
    action();
  } catch (error) {
    if (String(error).includes(expected)) return;
    throw new Error(`${message}: unexpected error ${String(error)}`);
  }
  throw new Error(`${message}: expected an error`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
