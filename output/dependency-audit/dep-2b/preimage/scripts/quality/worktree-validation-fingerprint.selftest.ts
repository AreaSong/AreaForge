import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildWorktreeValidationFingerprint } from "./worktree-validation-fingerprint";

const root = mkdtempSync(path.join(tmpdir(), "areaforge-worktree-fingerprint-"));

try {
  git(["init"]);
  git(["config", "user.email", "fixture@example.invalid"]);
  git(["config", "user.name", "AreaForge fixture"]);
  writeFileSync(path.join(root, "tracked.txt"), "v1\n");
  git(["add", "tracked.txt"]);
  git(["commit", "-m", "fixture"]);

  const clean = fingerprint();
  assert(clean.worktreeState === "clean", "initial repository should be clean");

  writeFileSync(path.join(root, "tracked.txt"), "v2\n");
  const firstDirty = fingerprint();
  assert(firstDirty.changedPaths.includes("tracked.txt"), "tracked modification should be included");
  writeFileSync(path.join(root, "tracked.txt"), "v3\n");
  const secondDirty = fingerprint();
  assert(firstDirty.worktreeHash !== secondDirty.worktreeHash, "same dirty path with new content must change worktree hash");

  git(["add", "tracked.txt"]);
  const staged = fingerprint();
  assert(staged.worktreeHash !== secondDirty.worktreeHash, "staging state must change worktree hash");

  writeFileSync(path.join(root, "untracked.txt"), "one\n");
  const untrackedOne = fingerprint();
  writeFileSync(path.join(root, "untracked.txt"), "two\n");
  const untrackedTwo = fingerprint();
  assert(untrackedOne.changedPaths.includes("untracked.txt"), "untracked file should be included");
  assert(untrackedOne.worktreeHash !== untrackedTwo.worktreeHash, "untracked content changes must change worktree hash");

  renameSync(path.join(root, "tracked.txt"), path.join(root, "renamed.txt"));
  const renamed = fingerprint();
  assert(renamed.changedPaths.includes("renamed.txt"), "rename target should be included");
  unlinkSync(path.join(root, "renamed.txt"));
  const deleted = fingerprint();
  assert(deleted.worktreeHash !== renamed.worktreeHash, "delete after rename must change worktree hash");

  const commandChanged = buildWorktreeValidationFingerprint(root, "pnpm check; pnpm docs:readiness", "full");
  assert(commandChanged.digest !== deleted.digest, "commands and profile must affect fingerprint digest");
  console.log("worktree validation fingerprint selftest passed.");
} finally {
  rmSync(root, { force: true, recursive: true });
}

function fingerprint() {
  return buildWorktreeValidationFingerprint(root, "pnpm check", "targeted");
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
