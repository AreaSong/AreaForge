import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";

export type ValidationProfile = "docs-only" | "targeted" | "full" | "custom";

export type WorktreeValidationFingerprint = {
  algorithm: "sha256";
  gitHead: string;
  worktreeState: "clean" | "dirty";
  worktreeHash: string;
  changedPaths: string[];
  commands: string[];
  profile: ValidationProfile;
  digest: string;
};

export function buildWorktreeValidationFingerprint(
  root: string,
  commandsValue: string,
  profile: ValidationProfile,
): WorktreeValidationFingerprint {
  const gitHead = git(root, ["rev-parse", "HEAD"]).trim();
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const trackedDiff = git(root, ["diff", "--binary", "--full-index", "--no-ext-diff", "HEAD", "--"]);
  const trackedPaths = nulList(git(root, ["diff", "--name-only", "-z", "HEAD", "--"]));
  const untrackedPaths = nulList(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const untracked = untrackedPaths.sort().map((file) => describeUntracked(root, file));
  const worktreeHash = sha256(JSON.stringify({
    statusSha256: sha256(status),
    trackedDiffSha256: sha256(trackedDiff),
    untracked,
  }));
  const commands = normalizeValidationCommands(commandsValue);
  const digest = sha256(JSON.stringify({ gitHead, worktreeHash, changedPaths, commands, profile }));
  return {
    algorithm: "sha256",
    gitHead,
    worktreeState: status.length === 0 ? "clean" : "dirty",
    worktreeHash,
    changedPaths,
    commands,
    profile,
    digest,
  };
}

export function normalizeValidationCommands(value: string): string[] {
  return value.split(";").map((command) => command.trim().replace(/\s+/g, " ")).filter(Boolean);
}

function describeUntracked(root: string, file: string): Record<string, string> {
  const absolute = path.join(root, file);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) return { path: file, kind: "symlink", target: readlinkSync(absolute) };
  if (stat.isFile()) return { path: file, kind: "file", sha256: sha256(readFileSync(absolute)) };
  return { path: file, kind: "other" };
}

function nulList(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
