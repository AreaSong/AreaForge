import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSupportBundlePreview } from "../ops/support-bundle-preview";
import {
  computeAcceptedExceptionBasisHash,
  type ResidualItemV2,
} from "./residual-ledger-common";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-support-bundle-preview-"));

try {
  const previewPath = path.join(tempDir, "support-bundle-preview.json");
  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/support-bundle-preview.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("generate support bundle preview", generated, 0);
  writeFileSync(previewPath, generated.stdout);

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", previewPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate support bundle preview", validation, 0);
  if (!validation.stdout.includes("supportBundlePreviewRecordHash: sha256:")) {
    fail("support bundle preview validation hash missing");
  }

  const parsed = JSON.parse(generated.stdout) as Record<string, unknown>;
  if (!Array.isArray(parsed.doesNotProve) || !parsed.doesNotProve.includes("updater apply completion")) {
    fail("support bundle preview non-proof boundary missing");
  }
  const unsafePath = path.join(tempDir, "support-bundle-preview-unsafe.json");
  writeFileSync(unsafePath, JSON.stringify({
    ...parsed,
    exportOpen: true,
    safetyFacts: {
      ...(parsed.safetyFacts as Record<string, unknown>),
      exportOpen: true,
      supportBundleExported: true,
    },
  }, null, 2));
  const unsafeValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", unsafePath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("unsafe support bundle preview fails", unsafeValidation, 1);

  const invalidExceptionPath = path.join(tempDir, "support-bundle-preview-invalid-exception.json");
  const residualProjection = parsed.residuals as Record<string, unknown>;
  writeFileSync(invalidExceptionPath, JSON.stringify({
    ...parsed,
    residuals: {
      ...residualProjection,
      nonEffectiveAcceptedExceptionItems: [{
        id: "AF-RISK-AI-001",
        reviewAt: "2026-08-01",
        effectiveExceptionStatus: "approved",
        ownerSkills: ["areaforge-ai-governance"],
        closeCondition: "fixture close condition",
        requiredEvidence: "fixture evidence",
      }],
    },
  }, null, 2));
  const invalidExceptionValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", invalidExceptionPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("invalid accepted exception projection fails", invalidExceptionValidation, 1);
  if (!invalidExceptionValidation.stderr.includes("residuals.nonEffectiveAcceptedExceptionItems[0].effectiveExceptionStatus")) {
    fail("support preview validator did not identify invalid accepted exception status");
  }

  const secretPath = path.join(tempDir, "support-bundle-preview-secret.json");
  writeFileSync(secretPath, `${generated.stdout}\nAI_API_KEY=sk-testsecretvalue1234567890`);
  const secretValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", secretPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("secret-bearing support bundle preview fails", secretValidation, 1);

  const fixtureRoot = path.join(tempDir, "fixture-root");
  writeFixture(fixtureRoot);
  const fixturePreview = buildSupportBundlePreview({
    root: fixtureRoot,
    now: new Date("2050-01-01T12:00:00.000Z"),
    generatedAt: "2050-01-01T12:00:00.000Z",
  });
  if (!fixturePreview.residuals.dueSoonOrExecutable.some((item) => item.id === "AF-RISK-OPS-006" && item.executableNow)) {
    fail("effective executable residual missing from support preview");
  }
  if (!fixturePreview.residuals.nonEffectiveAcceptedExceptionItems.some((item) =>
    item.id === "AF-RISK-AI-001" && item.effectiveExceptionStatus === "expired"
  )) {
    fail("non-effective accepted exception missing from support preview");
  }
  if (!fixturePreview.residuals.dueSoonOrExecutable.some((item) => item.id === "AF-RISK-AI-001")) {
    fail("non-effective accepted exception must be projected into dueSoonOrExecutable");
  }
  if (fixturePreview.residuals.nonEffectiveAcceptedExceptionItems.some((item) => item.id === "AF-RISK-REL-001")) {
    fail("effective accepted exception must not be projected as attention");
  }

  writeFileSync(path.join(fixtureRoot, "docs/development/residual-risk-ledger.json"), fixtureLedgerJson(1));
  expectThrow("V1 support ledger fails closed", () => buildSupportBundlePreview({ root: fixtureRoot }), "invalid residual ledger schema V2");
  writeFileSync(
    path.join(fixtureRoot, "docs/development/residual-risk-ledger.json"),
    fixtureLedgerJson(2).replace('"ownerSkills": [', '"ownerSkills": [null,'),
  );
  expectThrow("invalid support ledger item fails closed", () => buildSupportBundlePreview({ root: fixtureRoot }), "invalid residual ledger schema V2");
  rmSync(path.join(fixtureRoot, "docs/development/residual-risk-ledger.json"));
  expectThrow("missing support ledger fails closed", () => buildSupportBundlePreview({ root: fixtureRoot }), "ENOENT");

  console.log("support bundle preview selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected exit ${expected}, got ${result.status}`);
    console.error(String(result.stdout).trim());
    console.error(String(result.stderr).trim());
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function writeFixture(fixtureRoot: string): void {
  write(fixtureRoot, "package.json", JSON.stringify({ name: "@areasong/areaforge", version: "0.1.7" }));
  write(fixtureRoot, "docs/development/residual-risk-ledger.md", "fixture residual ledger\n");
  write(fixtureRoot, "docs/development/residual-risk-ledger.json", fixtureLedgerJson(2));
}

function fixtureLedgerJson(schemaVersion: number): string {
  const executable = residualItem({
    id: "AF-RISK-OPS-006",
    type: "current-blocker",
    reviewAt: "2050-01-15",
    currentImpact: "fixture executable residual",
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
      expiresAt: "2050-01-10T00:00:00.000Z",
    },
  });
  return `${JSON.stringify({
    schemaVersion,
    source: "docs/development/residual-risk-ledger.md",
    items: [
      executable,
      acceptedExceptionItem("AF-RISK-REL-001", "approved", "2050-02-01"),
      acceptedExceptionItem("AF-RISK-AI-001", "expired", "2049-12-31"),
    ],
  }, null, 2)}\n`;
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

function expectThrow(label: string, action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    if (String(error).includes(expected)) return;
    fail(`${label}: unexpected error ${String(error)}`);
  }
  fail(`${label}: expected an error`);
}
