import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { floorCommit } from "./v11-compatibility-floor-manifest";

const root = process.cwd();
const databaseUrl = required("DATABASE_URL");
const expectedDatabaseName = required("AREAFORGE_V11_COMPATIBILITY_EXPECTED_DATABASE_NAME");
const resultFile = optionalAbsolutePath("AREAFORGE_V11_COMPATIBILITY_RESULT_FILE");
const evidenceRecord = process.env.AREAFORGE_V11_COMPATIBILITY_EVIDENCE_RECORD?.trim();
const nodeMajor = Number(process.versions.node.split(".")[0]);

assert.equal(nodeMajor, 24, "compatibility floor orchestration must run on the Node.js 24 CI baseline");
assert(expectedDatabaseName.includes("v11compat"), "compatibility database name must contain v11compat");
assert.equal(git(["rev-parse", "--show-toplevel"]), root, "orchestration must run from the repository root");
if (resultFile && isInside(root, resultFile)) {
  throw new Error("AREAFORGE_V11_COMPATIBILITY_RESULT_FILE must be outside the repository");
}
if (resultFile && existsSync(resultFile)) {
  throw new Error("compatibility result file already exists");
}

const temporaryRoot = mkdtempSync(path.join(realTemporaryRoot(), "areaforge-v11compat-"));
const floorRoot = path.join(temporaryRoot, "floor");
const stateFile = path.join(temporaryRoot, "compatibility-state.json");
const uploadDir = path.join(temporaryRoot, "uploads");
let worktreeAdded = false;

const sharedEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  AREAFORGE_V11_COMPATIBILITY_FLOOR_ISOLATED_DB: "1",
  AREAFORGE_V11_COMPATIBILITY_EXPECTED_DATABASE_NAME: expectedDatabaseName,
  AREAFORGE_V11_COMPATIBILITY_STATE_FILE: stateFile,
  AREAFORGE_V11_COMPATIBILITY_EVIDENCE_RECORD: evidenceRecord ?? "",
  TSX_TSCONFIG_PATH: path.join(root, "apps/web/tsconfig.json"),
  APP_ENV: "production",
  APP_URL: "http://127.0.0.1:3999",
  APP_VERSION: "0.1.9",
  AUTH_SESSION_SECRET: "v11-compatibility-local-only-secret-20260727",
  UPLOAD_DIR: uploadDir,
  AI_ENABLED: "false",
};

try {
  mkdirSync(uploadDir, { recursive: true });
  run("pnpm", ["db:migrate:deploy"], root, sharedEnv);
  run("pnpm", ["ops:v11:compatibility-floor:runtime:selftest", "seed"], root, sharedEnv);

  run("git", ["worktree", "add", "--detach", floorRoot, floorCommit], root, sharedEnv);
  worktreeAdded = true;
  run("pnpm", ["install", "--frozen-lockfile"], floorRoot, sharedEnv);
  run("pnpm", ["db:generate"], floorRoot, sharedEnv);
  run("pnpm", ["build"], floorRoot, sharedEnv);

  const probeEnv = {
    ...sharedEnv,
    AREAFORGE_V11_COMPATIBILITY_FLOOR_ROOT: floorRoot,
    TSX_TSCONFIG_PATH: path.join(floorRoot, "apps/web/tsconfig.json"),
  };
  run("pnpm", ["ops:v11:compatibility-floor:runtime:selftest", "probe"], root, probeEnv);
  run("pnpm", ["db:migrate:deploy"], root, sharedEnv);
  run("pnpm", ["ops:v11:compatibility-floor:runtime:selftest", "validate"], root, sharedEnv);

  const state = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
  if (resultFile) {
    writeFileSync(resultFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  console.log(JSON.stringify({
    schemaVersion: "v11-compatibility-floor-orchestration-v1",
    status: "pass",
    expectedDatabaseName,
    nodeVersion: process.versions.node,
    floorCommit,
    resultFileWritten: Boolean(resultFile),
    state,
  }, null, 2));
  console.log("PASS v1.1 compatibility floor orchestration");
} finally {
  if (worktreeAdded) {
    execFileSync("git", ["worktree", "remove", "--force", floorRoot], { cwd: root, stdio: "inherit" });
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  console.log(`[v11 compatibility] ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, env, stdio: "inherit", maxBuffer: 64 * 1024 * 1024 });
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalAbsolutePath(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  if (!path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  return value;
}

function realTemporaryRoot(): string {
  return execFileSync("realpath", [tmpdir()], { encoding: "utf8" }).trim();
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}
