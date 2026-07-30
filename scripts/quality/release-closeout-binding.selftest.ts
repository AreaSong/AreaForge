import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { evaluateReleaseCloseoutBinding, isAllowedCloseoutPath } from "./release-closeout-binding";
import { V11_ACCESSIBILITY_CHECK_IDS, V11_JOURNEY_IDS } from "./v11-browser-evidence-contract";

const suiteRoot = mkdtempSync(path.join(os.tmpdir(), "areaforge-release-closeout-binding-"));

await main();

async function main(): Promise<void> {
  try {
    testExactAndEvidenceOnly();
    testAllowedTaskMove();
    testSourceAndHistoryDrift();
    testDirtyAndInvalidRefs();
    testPathAndContentBoundaries();
    await testEvidenceSizeBoundaries();
    testImageContentBoundaries();
    testModeDeleteCopyAndMergeBoundaries();
    testAllowlistSurface();
    testV11EvidenceOnlySurface();
    console.log("release closeout binding selftest passed.");
  } finally {
    rmSync(suiteRoot, { recursive: true, force: true });
  }
}

function testExactAndEvidenceOnly(): void {
  const repo = createRepository("exact");
  assertStatus(evaluate(repo), "exact");
  write(repo.root, "docs/development/residual-risk-ledger.md", "closed-evidence\n");
  write(repo.root, "docs/development/residual-closure-review-ops001.md", "reviewDecision: close\n");
  commit(repo.root, "evidence closeout");
  const closeout = evaluate(repo);
  assertStatus(closeout, "evidence_only");
  const expected = "docs/development/residual-closure-review-ops001.md,docs/development/residual-risk-ledger.md";
  if (closeout.changedPaths.join(",") !== expected) throw new Error(`unexpected changed paths: ${JSON.stringify(closeout)}`);
}

function testAllowedTaskMove(): void {
  const repo = createRepository("task-move");
  mkdirSync(path.join(repo.root, "tasks/done"), { recursive: true });
  git(repo.root, ["mv", "tasks/active/0019-update-request-expected-before-binding.md", "tasks/done/"]);
  commit(repo.root, "close OPS-005 task");
  assertStatus(evaluate(repo), "evidence_only");
}

function testSourceAndHistoryDrift(): void {
  const source = createRepository("source-drift");
  write(source.root, "apps/web/app.ts", "export const version = 2;\n");
  commit(source.root, "source drift");
  assertInvalid(evaluate(source), "apps/web/app.ts");

  const reverted = createRepository("reverted-source");
  write(reverted.root, "apps/web/app.ts", "export const version = 2;\n");
  commit(reverted.root, "temporary source drift");
  write(reverted.root, "apps/web/app.ts", "export const version = 1;\n");
  commit(reverted.root, "revert source drift");
  assertInvalid(evaluate(reverted), "apps/web/app.ts");
}

function testDirtyAndInvalidRefs(): void {
  const dirty = createRepository("dirty");
  write(dirty.root, "docs/development/residual-risk-ledger.md", "dirty\n");
  assertInvalid(evaluate(dirty), "clean worktree");

  const refs = createRepository("refs");
  assertInvalid(evaluateReleaseCloseoutBinding({ root: refs.root, releaseGitCommit: "bad" }), "40-character");
  git(refs.root, ["checkout", "-q", "--orphan", "unrelated"]);
  git(refs.root, ["rm", "-rf", "."]);
  write(refs.root, "docs/development/residual-risk-ledger.md", "unrelated\n");
  commit(refs.root, "unrelated root");
  assertInvalid(evaluate(refs), "evidence-only descendant");
}

function testPathAndContentBoundaries(): void {
  const env = createRepository("env-path");
  write(env.root, "docs/development/ops-001-production-readonly-20260718/.env", "SAFE=not-safe-here\n");
  commit(env.root, "forbidden env evidence");
  assertInvalid(evaluate(env), ".env");

  const secret = createRepository("secret-content");
  write(secret.root, "docs/development/residual-closure-review-secret.md", "DATABASE_URL=postgresql://user:pass@db/area\n");
  commit(secret.root, "secret content");
  assertInvalid(evaluate(secret), "database URL");

  const design = createRepository("design-path");
  write(design.root, "docs/development/ops-006-business-state-concurrency-design.md", "contract rewrite\n");
  commit(design.root, "rewrite contract after release");
  assertInvalid(evaluate(design), "non-evidence path");

  const task = createRepository("broad-task");
  write(task.root, "tasks/done/9999-arbitrary-source-change.md", "status: done\n");
  commit(task.root, "arbitrary task");
  assertInvalid(evaluate(task), "non-evidence path");
}

async function testEvidenceSizeBoundaries(): Promise<void> {
  const largeValid = createRepository("large-valid-image");
  const width = 650;
  const height = 650;
  const largeImage = await sharp(randomBytes(width * height * 3), {
    raw: { width, height, channels: 3 },
  }).png({ compressionLevel: 0 }).toBuffer();
  if (largeImage.length <= 1024 * 1024 || largeImage.length > 2_000_000) {
    throw new Error(`large PNG fixture is outside the expected range: ${largeImage.length}`);
  }
  write(largeValid.root, "output/playwright/ux-large.png", largeImage);
  commit(largeValid.root, "large but valid closeout screenshot");
  assertStatus(evaluate(largeValid), "evidence_only");

  const tooLarge = createRepository("too-large-image");
  const oversizedImage = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.alloc(2_000_001 - 8),
  ]);
  write(tooLarge.root, "output/playwright/ux-too-large.png", oversizedImage);
  commit(tooLarge.root, "oversized closeout screenshot");
  assertInvalid(evaluate(tooLarge), "too large");
}

function testImageContentBoundaries(): void {
  const magicOnly = createRepository("magic-only-image");
  write(magicOnly.root, "output/playwright/ux-magic-only.png", Buffer.from("89504e470d0a1a0a", "hex"));
  commit(magicOnly.root, "magic-only screenshot");
  assertInvalid(evaluate(magicOnly), "invalid image structure");

  const secretImage = createRepository("secret-image");
  write(secretImage.root, "output/playwright/ux-secret.png", Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    Buffer.from("DATABASE_URL=postgresql://user:pass@db/area\n"),
  ]));
  commit(secretImage.root, "secret-bearing screenshot");
  assertInvalid(evaluate(secretImage), "database URL");
}

function testModeDeleteCopyAndMergeBoundaries(): void {
  const executable = createRepository("executable");
  const executablePath = "docs/development/residual-closure-review-executable.md";
  write(executable.root, executablePath, "reviewDecision: close\n");
  chmodSync(path.join(executable.root, executablePath), 0o755);
  commit(executable.root, "executable evidence");
  assertInvalid(evaluate(executable), "100644");

  const symlink = createRepository("symlink");
  symlinkSync("residual-risk-ledger.md", path.join(symlink.root, "docs/development/residual-closure-review-link.md"));
  commit(symlink.root, "symlink evidence");
  assertInvalid(evaluate(symlink), "100644");

  const deleted = createRepository("delete");
  rmSync(path.join(deleted.root, "docs/development/residual-risk-ledger.md"));
  commit(deleted.root, "delete evidence");
  assertInvalid(evaluate(deleted), "cannot delete");

  const copied = createRepository("copy");
  copyFileSync(
    path.join(copied.root, "docs/development/residual-risk-ledger.md"),
    path.join(copied.root, "docs/development/residual-closure-review-copy.md"),
  );
  commit(copied.root, "copy existing evidence");
  assertInvalid(evaluate(copied), "cannot delete or copy");

  const merged = createRepository("merge");
  const baseBranch = git(merged.root, ["branch", "--show-current"]).trim();
  git(merged.root, ["checkout", "-qb", "evidence-branch"]);
  write(merged.root, "docs/development/residual-closure-review-branch.md", "reviewDecision: close\n");
  commit(merged.root, "branch evidence");
  git(merged.root, ["checkout", "-q", baseBranch]);
  write(merged.root, "docs/development/operational-readiness.md", "closeout state\n");
  commit(merged.root, "main evidence");
  git(merged.root, ["merge", "--no-ff", "-qm", "merge evidence", "evidence-branch"]);
  assertInvalid(evaluate(merged), "merge commit");
}

function testAllowlistSurface(): void {
  const allowed = [
    "docs/development/residual-closure-review-ops001.md",
    "docs/development/ops-001-production-readonly-20260718/prod-readonly-smoke-record.txt",
    "output/ops006/production-evidence-v0.1.8.json",
    "tasks/done/0020-business-state-concurrency.md",
  ];
  for (const file of allowed) {
    if (!isAllowedCloseoutPath(file)) throw new Error(`expected allowlisted path: ${file}`);
  }
  const denied = [
    "scripts/ops/unsafe-change.ts",
    "docs/development/ops-006-business-state-concurrency-design.md",
    "docs/development/ops-001-production-readonly-20260718/.env",
    "output/ops006/raw-production.log",
    "tasks/done/9999-arbitrary.md",
  ];
  for (const file of denied) {
    if (isAllowedCloseoutPath(file)) throw new Error(`expected denied path: ${file}`);
  }
}

function testV11EvidenceOnlySurface(): void {
  const evidenceRoot = "output/playwright/v11-browser-evidence-20260729";
  const allowedText = [
    "docs/development/v11-release-admission-record.md",
    "docs/development/v11-s2-ops006-007-gate-review.md",
    "docs/development/v11-accessibility-review-20260727.md",
    "docs/development/v11-compatibility-floor-evidence-20260727.md",
    "output/v11-compatibility/compatibility-floor-runtime-v1.1.0-20260727.json",
    "output/supply-chain/ci-supply-chain-v1.1.0-20260727.txt",
    "output/supply-chain/sc004-main-protection-readback-v1.1.0-20260727.json",
    "output/supply-chain/sc004-controlled-pr-v1.1.0-20260727.json",
    `${evidenceRoot}/v11-browser-journey-evidence.json`,
    `${evidenceRoot}/v11-accessibility-evidence.json`,
    `${evidenceRoot}/runtime-identity-v1.1.0.json`,
    ...V11_ACCESSIBILITY_CHECK_IDS.map((id) =>
      `${evidenceRoot}/observations/a11y-${id.toLowerCase()}.json`),
  ];
  const allowedImages = V11_JOURNEY_IDS.flatMap((journey) => [
    `${evidenceRoot}/screenshots/desktop-${journey}.png`,
    `${evidenceRoot}/screenshots/mobile-${journey}.png`,
  ]);
  const allowed = [...allowedText, ...allowedImages];
  for (const file of allowed) {
    if (!isAllowedCloseoutPath(file)) throw new Error(`expected v1.1 allowlisted path: ${file}`);
  }

  const repo = createRepository("v11-evidence-only");
  for (const file of allowedText) write(repo.root, file, `${file}\n`);
  for (const file of allowedImages) write(repo.root, file, minimalPng());
  commit(repo.root, "add v1.1 admission evidence");
  assertStatus(evaluate(repo), "evidence_only");

  const denied = [
    "docs/development/v11-release-admission-record-copy.md",
    "docs/development/archive/v11-accessibility-review-20260727.md",
    "docs/development/v11-compatibility-floor-evidence-20260727.json",
    "output/v11-compatibility/nested/compatibility-floor-runtime-v1.1.0-20260727.json",
    "output/v11-compatibility/compatibility-floor-runtime-v1.2.0-20260727.json",
    "output/supply-chain/ci-supply-chain-v1.1.1-20260727.txt",
    "output/supply-chain/sc004-main-protection-readback-v1.1.0-20260727.txt",
    "output/supply-chain/sc004-controlled-pr-v1.1.0-20260727.md",
    `${evidenceRoot}/v11-browser-journey-evidence.txt`,
    `${evidenceRoot}/nested/v11-accessibility-evidence.json`,
    `${evidenceRoot}/screenshots/desktop-secret.png`,
    `${evidenceRoot}/screenshots/mobile-login.jpg`,
    `${evidenceRoot}/observations/a11y-zoom-04.json`,
    `${evidenceRoot}/observations/a11y-zoom-01.txt`,
    `${evidenceRoot}/auth-state.json`,
  ];
  for (const file of denied) {
    if (isAllowedCloseoutPath(file)) throw new Error(`expected denied v1.1 path: ${file}`);
  }

  const nested = createRepository("v11-denied-nested");
  write(nested.root, denied[3] as string, "out-of-scope nested runtime\n");
  commit(nested.root, "add nested v1.1 runtime");
  assertInvalid(evaluate(nested), denied[3] as string);

  const wrongVersion = createRepository("v11-denied-version");
  write(wrongVersion.root, denied[5] as string, "out-of-scope release evidence\n");
  commit(wrongVersion.root, "add other-version supply-chain evidence");
  assertInvalid(evaluate(wrongVersion), denied[5] as string);
}

function minimalPng(): Buffer {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4, "ascii");
  ihdr.writeUInt32BE(1, 8);
  ihdr.writeUInt32BE(1, 12);
  ihdr[16] = 8;
  ihdr[17] = 6;
  const iend = Buffer.alloc(12);
  iend.write("IEND", 4, "ascii");
  return Buffer.concat([signature, ihdr, iend]);
}

function createRepository(name: string): { root: string; releaseCommit: string } {
  const root = path.join(suiteRoot, name);
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@areaforge.invalid"]);
  git(root, ["config", "user.name", "AreaForge selftest"]);
  write(root, "apps/web/app.ts", "export const version = 1;\n");
  write(root, "docs/development/residual-risk-ledger.md", "open\n");
  write(root, "docs/development/operational-readiness.md", "open\n");
  write(root, "tasks/active/0019-update-request-expected-before-binding.md", "status: in-progress\n");
  commit(root, "source");
  return { root, releaseCommit: git(root, ["rev-parse", "HEAD"]).trim() };
}

function evaluate(repo: { root: string; releaseCommit: string }) {
  return evaluateReleaseCloseoutBinding({ root: repo.root, releaseGitCommit: repo.releaseCommit });
}

function commit(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", message]);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function write(root: string, file: string, content: string | Buffer): void {
  const fullPath = path.join(root, file);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function assertStatus(result: { status: string }, expected: string): void {
  if (result.status !== expected) throw new Error(`expected ${expected}, got ${JSON.stringify(result)}`);
}

function assertInvalid(result: { status: string; issues: string[] }, fragment: string): void {
  if (result.status !== "invalid" || !result.issues.some((issue) => issue.includes(fragment))) {
    throw new Error(`expected invalid result containing ${fragment}: ${JSON.stringify(result)}`);
  }
}
