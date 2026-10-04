import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, lstatSync, mkdtempSync, openSync, readFileSync, readlinkSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

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
  excludedPaths: string[] = [],
  gitHeadOverride?: string,
): WorktreeValidationFingerprint {
  const gitHead = gitHeadOverride ?? git(root, ["rev-parse", "HEAD"]).trim();
  const pathspec = [".", ...excludedPaths.map((file) => `:(exclude)${file}`)];
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspec]);
  const trackedDiffSha256 = hashGitDiff(root, pathspec);
  const trackedPaths = nulList(git(root, ["diff", "--name-only", "-z", "HEAD", "--", ...pathspec]));
  const untrackedPaths = nulList(git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec]));
  const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])].sort();
  const untracked = untrackedPaths.sort().map((file) => describeUntracked(root, file));
  const worktreeHash = sha256(JSON.stringify({
    statusSha256: sha256(status),
    trackedDiffSha256,
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

function hashGitDiff(root: string, pathspec: string[]): string {
  const directory = mkdtempSync(path.join(tmpdir(), "areaforge-git-diff-"));
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path.join(directory, "diff"), "wx+", 0o600);
    // 大量产物可能超过 execFileSync 缓冲上限；完整保留差异并分块计算原有 UTF-8 摘要。
    execFileSync("git", ["diff", "--binary", "--full-index", "--no-ext-diff", "HEAD", "--", ...pathspec], {
      cwd: root, stdio: ["ignore", descriptor, "pipe"],
    });
    const hash = createHash("sha256");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    let length: number;
    while ((length = readSync(descriptor, buffer, 0, buffer.length, position)) > 0) {
      hash.update(decoder.write(buffer.subarray(0, length)));
      position += length;
    }
    hash.update(decoder.end());
    return `sha256:${hash.digest("hex")}`;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
