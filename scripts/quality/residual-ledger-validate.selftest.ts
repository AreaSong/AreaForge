import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  computeAcceptedExceptionBasisHash,
  effectiveExceptionStatus,
  effectiveExecutableNow,
  isAcceptedExceptionEffective,
  type AcceptedExceptionStatus,
  type ResidualItemV2,
} from "./residual-ledger-common";

type JsonRecord = Record<string, unknown>;

interface TestCase {
  name: string;
  mutate: (fixtureRoot: string, item: JsonRecord) => void;
  expectedExit: 0 | 1;
  expectedText: string;
}

const repoRoot = process.cwd();
const validatorPath = path.join(repoRoot, "scripts/quality/residual-ledger-validate.ts");
const tsxPath = path.join(repoRoot, "node_modules/.bin/tsx");
const futureDate = "2099-12-31";
const pastDate = "2000-01-01";

const cases: TestCase[] = [
  {
    name: "active reciprocal task supports executable residual",
    mutate: (fixtureRoot, item) => {
      item.executableNow = true;
      item.taskRefs = ["tasks/active/0001-active.md"];
      writeTask(fixtureRoot, "tasks/active/0001-active.md", [String(item.id)]);
    },
    expectedExit: 0,
    expectedText: "validation passed",
  },
  {
    name: "backlog task cannot support executable residual",
    mutate: (fixtureRoot, item) => {
      item.executableNow = true;
      item.taskRefs = ["tasks/backlog/0001-backlog.md"];
      writeTask(fixtureRoot, "tasks/backlog/0001-backlog.md", [String(item.id)]);
    },
    expectedExit: 1,
    expectedText: "true requires a tasks/active/*.md taskRef",
  },
  {
    name: "current waiver supports executable residual",
    mutate: (_fixtureRoot, item) => {
      item.executableNow = true;
      item.taskPromotionWaiver = waiver(futureDate);
    },
    expectedExit: 0,
    expectedText: "validation passed",
  },
  {
    name: "expired waiver is rejected",
    mutate: (_fixtureRoot, item) => {
      item.executableNow = true;
      item.reviewAt = futureDate;
      item.taskPromotionWaiver = waiver(pastDate);
    },
    expectedExit: 1,
    expectedText: "must not be expired on the current date",
  },
  {
    name: "active task missing reciprocal residual id is rejected",
    mutate: (fixtureRoot, item) => {
      item.executableNow = true;
      item.taskRefs = ["tasks/active/0001-active.md"];
      writeTask(fixtureRoot, "tasks/active/0001-active.md", []);
    },
    expectedExit: 1,
    expectedText: "true requires a tasks/active/*.md taskRef",
  },
  {
    name: "symlink taskRef is rejected",
    mutate: (fixtureRoot, item) => {
      item.executableNow = true;
      item.taskRefs = ["tasks/active/0001-link.md"];
      writeTask(fixtureRoot, "tasks/real-task.md", [String(item.id)]);
      mkdirSync(path.join(fixtureRoot, "tasks/active"), { recursive: true });
      symlinkSync("../real-task.md", path.join(fixtureRoot, "tasks/active/0001-link.md"));
    },
    expectedExit: 1,
    expectedText: "must not traverse or reference a symlink",
  },
  {
    name: "path escape is rejected",
    mutate: (_fixtureRoot, item) => {
      item.executableNow = true;
      item.taskRefs = ["../outside.md"];
    },
    expectedExit: 1,
    expectedText: "must not escape the repository root",
  },
  {
    name: "accepted exception basis drift is rejected",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      item.acceptedException = acceptedException(item, "approved");
      item.closeCondition = "changed after approval";
    },
    expectedExit: 1,
    expectedText: "does not match the canonical accepted-exception basis",
  },
  {
    name: "approved accepted exception is valid",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      item.acceptedException = acceptedException(item, "approved");
    },
    expectedExit: 0,
    expectedText: "validation passed",
  },
  {
    name: "revoked accepted exception is valid",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      item.acceptedException = acceptedException(item, "revoked");
    },
    expectedExit: 0,
    expectedText: "validation passed",
  },
  {
    name: "revoked accepted exception requires revocation metadata",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      const exception = acceptedException(item, "revoked");
      exception.revocationReason = null;
      item.acceptedException = exception;
    },
    expectedExit: 1,
    expectedText: "revocationReason: must be a non-empty string",
  },
  {
    name: "superseded accepted exception is valid",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      item.acceptedException = acceptedException(item, "superseded");
    },
    expectedExit: 0,
    expectedText: "validation passed",
  },
  {
    name: "superseded accepted exception requires successor",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      const exception = acceptedException(item, "superseded");
      exception.supersededBy = null;
      item.acceptedException = exception;
    },
    expectedExit: 1,
    expectedText: "supersededBy: must be a non-empty string",
  },
  {
    name: "expired accepted exception is valid",
    mutate: (_fixtureRoot, item) => {
      item.type = "accepted-exception";
      item.acceptedException = acceptedException(item, "expired");
    },
    expectedExit: 0,
    expectedText: "validation passed",
  },
];

let failures = 0;
for (const testCase of cases) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "areaforge-residual-v2-"));
  try {
    const item = baseItem();
    testCase.mutate(fixtureRoot, item);
    writeFixture(fixtureRoot, item);
    const before = snapshot(fixtureRoot);
    const result = spawnSync(tsxPath, [validatorPath], { cwd: fixtureRoot, encoding: "utf8" });
    const output = `${result.stdout}\n${result.stderr}`;
    const after = snapshot(fixtureRoot);
    const passed = result.status === testCase.expectedExit && output.includes(testCase.expectedText) && before === after;
    if (!passed) {
      failures += 1;
      console.error(`FAIL ${testCase.name}`);
      console.error(`expected exit=${testCase.expectedExit}, text=${JSON.stringify(testCase.expectedText)}, readonly=true`);
      console.error(`actual exit=${result.status}, readonly=${before === after}`);
      console.error(output.trim());
    } else {
      console.log(`PASS ${testCase.name}`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

runProjectionTests();

if (failures > 0) {
  console.error(`residual ledger V2 validator selftest failed: ${failures} case(s).`);
  process.exit(1);
}
console.log(`residual ledger V2 validator selftest passed: ${cases.length} cases, including readonly snapshot checks.`);

function runProjectionTests(): void {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "areaforge-residual-projection-"));
  try {
    const activeItem = baseItem();
    activeItem.executableNow = true;
    activeItem.taskRefs = ["tasks/active/0001-active.md"];
    writeTask(fixtureRoot, "tasks/active/0001-active.md", [String(activeItem.id)]);
    expectProjection(
      "effectiveExecutableNow accepts reciprocal active task",
      effectiveExecutableNow(activeItem as unknown as ResidualItemV2, { root: fixtureRoot }),
      true,
    );

    const waiverItem = baseItem();
    waiverItem.executableNow = true;
    waiverItem.taskPromotionWaiver = waiver(futureDate);
    expectProjection(
      "effectiveExecutableNow accepts current waiver",
      effectiveExecutableNow(waiverItem as unknown as ResidualItemV2, { now: new Date("2050-01-01T00:00:00Z") }),
      true,
    );
    expectProjection(
      "effectiveExecutableNow rejects expired waiver",
      effectiveExecutableNow(waiverItem as unknown as ResidualItemV2, { now: new Date("2100-01-01T00:00:00Z") }),
      false,
    );

    const approvedItem = exceptionItem("approved");
    expectProjection(
      "effectiveExceptionStatus preserves current approval",
      effectiveExceptionStatus(approvedItem, new Date("2050-01-01T00:00:00Z")),
      "approved",
    );
    expectProjection(
      "approved accepted exception is effective",
      isAcceptedExceptionEffective(approvedItem, new Date("2050-01-01T00:00:00Z")),
      true,
    );
    expectProjection(
      "effectiveExceptionStatus projects stale approval as expired",
      effectiveExceptionStatus(approvedItem, new Date("2100-01-01T00:00:00Z")),
      "expired",
    );
    expectProjection(
      "expired approval is not effective",
      isAcceptedExceptionEffective(approvedItem, new Date("2100-01-01T00:00:00Z")),
      false,
    );
    for (const status of ["revoked", "expired", "superseded"] as const) {
      const item = exceptionItem(status);
      expectProjection(
        `effectiveExceptionStatus preserves ${status}`,
        effectiveExceptionStatus(item, new Date("2050-01-01T00:00:00Z")),
        status,
      );
      expectProjection(
        `${status} accepted exception is not effective`,
        isAcceptedExceptionEffective(item, new Date("2050-01-01T00:00:00Z")),
        false,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function expectProjection(name: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${name}: expected=${String(expected)} actual=${String(actual)}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

function exceptionItem(status: AcceptedExceptionStatus): ResidualItemV2 {
  const item = baseItem();
  item.type = "accepted-exception";
  item.acceptedException = acceptedException(item, status);
  return item as unknown as ResidualItemV2;
}

function baseItem(): JsonRecord {
  return {
    id: "AF-RISK-AI-001",
    type: "current-blocker",
    reviewAt: futureDate,
    currentImpact: "fixture impact",
    executableNow: false,
    closeCondition: "fixture close condition",
    requiredEvidence: "fixture required evidence",
    ownerSkills: ["areaforge-ai-governance"],
    taskRefs: [],
    taskPromotionWaiver: null,
    acceptedException: null,
  };
}

function waiver(expiresAt: string): JsonRecord {
  return {
    id: "AF-WAIVER-001",
    scope: "temporary task promotion delay",
    reason: "fixture reason",
    approvedBy: "fixture-maintainer",
    approvedAt: pastDate,
    expiresAt,
  };
}

function acceptedException(item: JsonRecord, status: AcceptedExceptionStatus): JsonRecord {
  const value: JsonRecord = {
    status,
    scope: "fixture accepted scope",
    reason: "fixture accepted reason",
    acceptedBy: "fixture-maintainer",
    acceptedAt: "2000-01-01T08:00:00+08:00",
    expiresAt: futureDate,
    reopenConditions: ["source fact changes", "evidence expires"],
    basisHash: "",
    sourceRef: "docs/development/fixture-acceptance.md",
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    supersededBy: null,
  };
  if (status === "revoked") {
    value.revokedBy = "fixture-revoker";
    value.revokedAt = "2001-01-01";
    value.revocationReason = "fixture revocation";
  }
  if (status === "expired") {
    value.acceptedAt = "1999-01-01";
    value.expiresAt = pastDate;
  }
  if (status === "superseded") value.supersededBy = "AF-EXCEPTION-AI-002";
  value.basisHash = computeAcceptedExceptionBasisHash({
    ...item,
    acceptedException: value,
  } as unknown as ResidualItemV2);
  return value;
}

function writeFixture(fixtureRoot: string, item: JsonRecord): void {
  const id = String(item.id);
  const executable = item.executableNow === true ? "是" : "否";
  write(fixtureRoot, "docs/development/residual-risk-ledger.json", `${JSON.stringify({
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items: [item],
  }, null, 2)}\n`);
  write(fixtureRoot, "docs/development/residual-risk-ledger.md", [
    "| ID | 类型 | 复核时间 | 当前影响 | 可立即执行 | 关闭条件 | 所需证据 | Owner |",
    "|---|---|---|---|---|---|---|---|",
    `| ${id} | ${String(item.type)} | ${String(item.reviewAt)} | fixture | ${executable} | fixture | fixture | fixture |`,
    "",
  ].join("\n"));
  write(fixtureRoot, "tasks/indexes/residuals.md", `${id}\n`);
  write(fixtureRoot, "docs/development/operational-readiness.md", `${id}\n`);
  write(fixtureRoot, "docs/development/docs-100-completion-record.md", "fixture\n");
  write(fixtureRoot, "docs/development/validation-matrix.md", "fixture\n");
  write(fixtureRoot, "docs/development/long-term-operability-control-plane.md", "fixture\n");
}

function writeTask(fixtureRoot: string, relative: string, residualRiskIds: string[]): void {
  const residualLines = residualRiskIds.length === 0
    ? "residualRiskIds: []"
    : `residualRiskIds:\n${residualRiskIds.map((id) => `  - ${id}`).join("\n")}`;
  write(fixtureRoot, relative, `# Fixture Task\n\n\`\`\`yaml\nstatus: in-progress\n${residualLines}\n\`\`\`\n`);
}

function write(fixtureRoot: string, relative: string, body: string): void {
  const absolute = path.join(fixtureRoot, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}

function snapshot(directory: string): string {
  const entries: string[] = [];
  walk(directory, "", entries);
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

function walk(root: string, relative: string, entries: string[]): void {
  const current = path.join(root, relative);
  for (const name of readdirSync(current).sort()) {
    const childRelative = path.join(relative, name);
    const absolute = path.join(root, childRelative);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      entries.push(`link:${childRelative}:${readlinkSync(absolute)}`);
    } else if (stat.isDirectory()) {
      entries.push(`dir:${childRelative}`);
      walk(root, childRelative, entries);
    } else {
      entries.push(`file:${childRelative}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`);
    }
  }
}
