import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const repoRoot = process.cwd();
const admissionScript = path.join(repoRoot, "scripts/quality/release-admission.ts");
const tempRoot = mkdtempSync(path.join(tmpdir(), "areaforge-release-admission-"));

interface FixtureOptions {
  workspaceVersion?: string;
  missingWorkspaceVersion?: boolean;
  sideBranchTag?: boolean;
}

interface Fixture {
  root: string;
  tagCommit: string;
  mainCommit: string;
  marker: string;
}

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(options: FixtureOptions = {}): Fixture {
  const fixtureRoot = path.join(tempRoot, `fixture-${Math.random().toString(16).slice(2)}`);
  const origin = path.join(fixtureRoot, "origin.git");
  const source = path.join(fixtureRoot, "source");
  const clone = path.join(fixtureRoot, "clone");
  const marker = path.join(fixtureRoot, "marker");
  mkdirSync(fixtureRoot, { recursive: true });

  run("git", ["init", "--bare", origin], fixtureRoot);
  run("git", ["init", "-b", "main", source], fixtureRoot);
  run("git", ["config", "user.email", "selftest@example.invalid"], source);
  run("git", ["config", "user.name", "AreaForge selftest"], source);
  writeJson(path.join(source, "package.json"), {
    name: "@areasong/areaforge-selftest",
    version: "1.2.3",
    private: true,
  });
  writeFileSync(path.join(source, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(path.join(source, "packages", "one"), { recursive: true });
  const workspacePackage: Record<string, unknown> = {
    name: "@areaforge/selftest-one",
  };
  if (!options.missingWorkspaceVersion) workspacePackage.version = options.workspaceVersion ?? "1.2.3";
  writeJson(path.join(source, "packages", "one", "package.json"), workspacePackage);
  writeFileSync(path.join(source, "README.md"), "release admission selftest\n");
  run("git", ["add", "package.json", "pnpm-workspace.yaml", "packages/one/package.json", "README.md"], source);
  run("git", ["commit", "-m", "base"], source);
  const mainCommit = run("git", ["rev-parse", "HEAD"], source);
  run("git", ["remote", "add", "origin", origin], source);
  run("git", ["push", "origin", "main"], source);
  run("git", ["symbolic-ref", "HEAD", "refs/heads/main"], origin);

  let tagCommit = mainCommit;
  if (options.sideBranchTag) {
    run("git", ["switch", "-c", "side"], source);
    writeFileSync(path.join(source, "side.txt"), "side branch\n");
    run("git", ["add", "side.txt"], source);
    run("git", ["commit", "-m", "side"], source);
    tagCommit = run("git", ["rev-parse", "HEAD"], source);
    run("git", ["push", "origin", "side"], source);
  }
  run("git", ["tag", "v1.2.3"], source);
  run("git", ["push", "origin", "v1.2.3"], source);
  run("git", ["clone", "--branch", "main", origin, clone], fixtureRoot);
  run("git", options.sideBranchTag ? ["fetch", "origin", "main", "side"] : ["fetch", "origin", "main"], clone);

  return { root: clone, tagCommit, mainCommit, marker };
}

function runAdmission(fixture: Fixture, overrides: Record<string, string> = {}) {
  return spawnSync("pnpm", ["exec", "tsx", admissionScript], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AREAFORGE_RELEASE_ADMISSION_ROOT: fixture.root,
      AREAFORGE_RELEASE_TAG: "v1.2.3",
      AREAFORGE_WORKFLOW_SHA: fixture.tagCommit,
      AREAFORGE_DEFAULT_BRANCH: "main",
      AREAFORGE_EVENT_NAME: "push",
      ...overrides,
    },
  });
}

function assertReason(label: string, result: ReturnType<typeof runAdmission>, reason: string): void {
  assert.notEqual(result.status, 0, `${label} should fail`);
  assert.equal(result.stderr.trim(), reason, `${label} should emit stable reason code`);
}

function testNormal(): void {
  const fixture = createFixture();
  const result = runAdmission(fixture);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.deepEqual(output, {
    tag: "v1.2.3",
    version: "1.2.3",
    releaseCommit: fixture.tagCommit,
    defaultBranch: "main",
    eventName: "push",
    workspaceCount: 2,
  });
}

function testFailures(): void {
  const tagMismatch = createFixture();
  assertReason("tag/version mismatch", runAdmission(tagMismatch, { AREAFORGE_RELEASE_TAG: "v1.2.4" }), "TAG_VERSION_MISMATCH");

  const workspaceMismatch = createFixture({ workspaceVersion: "1.2.4" });
  assertReason("workspace mismatch", runAdmission(workspaceMismatch), "WORKSPACE_VERSION_MISMATCH");

  const missingWorkspaceVersion = createFixture({ missingWorkspaceVersion: true });
  assertReason("missing workspace version", runAdmission(missingWorkspaceVersion), "WORKSPACE_VERSION_MISMATCH");

  const sideBranch = createFixture({ sideBranchTag: true });
  assertReason("side branch tag", runAdmission(sideBranch), "TAG_NOT_ON_DEFAULT_BRANCH");

  const shaMismatch = createFixture();
  const replacement = shaMismatch.mainCommit.endsWith("0") ? "1" : "0";
  assertReason("workflow SHA mismatch", runAdmission(shaMismatch, { AREAFORGE_WORKFLOW_SHA: shaMismatch.mainCommit.replace(/.$/, replacement) }), "TAG_SHA_MISMATCH");
}

function testMaliciousTag(): void {
  const fixture = createFixture();
  const result = runAdmission(fixture, {
    AREAFORGE_RELEASE_TAG: "v1.2.3; touch ${AREAFORGE_RELEASE_ADMISSION_ROOT}/marker",
  });
  assertReason("malicious tag", result, "INVALID_TAG");
  assert.equal(existsSync(fixture.marker), false, "malicious tag must not execute marker side effect");
}

try {
  testNormal();
  testFailures();
  testMaliciousTag();
  console.log("release admission selftest passed");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
