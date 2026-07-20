import { execFileSync } from "node:child_process";
import path from "node:path";

export type ReleaseCloseoutBindingStatus = "exact" | "evidence_only" | "invalid";

export interface ReleaseCloseoutBindingResult {
  status: ReleaseCloseoutBindingStatus;
  releaseGitCommit: string;
  currentGitCommit: string;
  worktreeClean: boolean;
  changedPaths: string[];
  issues: string[];
}

export interface ReleaseCloseoutBindingOptions {
  root: string;
  releaseGitCommit: string;
  currentGitCommit?: string;
  requireCleanWorktree?: boolean;
}

type CommitChange = {
  status: string;
  paths: string[];
};

const commitPattern = /^[a-f0-9]{40}$/i;
const maxCloseoutEvidenceBytes = 2_000_000;

const exactAllowedPaths = new Set([
  "README.md",
  "docs/README.md",
  "docs/development/long-term-operability-control-plane.md",
  "docs/development/operational-readiness.md",
  "docs/development/residual-risk-ledger.json",
  "docs/development/residual-risk-ledger.md",
  "tasks/README.md",
  "tasks/indexes/residuals.md",
  "workflow/README.md",
]);

const allowedTaskFiles = new Set([
  "0014-deployment-backup-release.md",
  "0019-update-request-expected-before-binding.md",
  "0020-business-state-concurrency.md",
  "0023-github-main-protection.md",
  "0024-ux-residual-closure-review.md",
]);

const allowedPathPatterns = [
  /^docs\/development\/(?:release|release-supply-chain)-v\d+\.\d+\.\d+[^/]*\.(?:md|txt|json)$/,
  /^docs\/development\/operational-evidence-bundle-v\d+\.\d+\.\d+[^/]*\.json$/,
  /^docs\/development\/ops-001-production-readonly-[^/]+\/(?:prod-readonly-smoke-record\.txt|redacted-update-status\.json|operational-evidence-bundle\.json|ops-001-closure-packet\.txt|ops001-preflight-after-closure\.json)$/,
  /^docs\/development\/ops-(?:005|006)-production-evidence-v\d+\.\d+\.\d+[^/]*\.(?:md|txt|json)$/,
  /^docs\/development\/residual-closure-review-[^/]+\.(?:md|txt|json)$/,
  /^docs\/development\/product-experience-review-[^/]+\.(?:md|txt|json)$/,
  /^docs\/development\/release-closeout-audit-[^/]+\.json$/,
  /^output\/ops005\/(?:[A-Za-z0-9._-]+\/)*(?:production-evidence|operational-evidence|decision-history|v2-check|processing-reconciliation)[A-Za-z0-9._-]*\.(?:json|md|txt)$/,
  /^output\/ops006\/(?:concurrency-runtime|data-integrity-(?:before|after)|production-evidence|rollout|concurrency-probe|doctor-(?:before|after))[A-Za-z0-9._-]*\.(?:json|md|txt)$/,
  /^output\/supply-chain\/residual-review-AF-RISK-(?:SC-001|SC-002|SC-004)-[^/]+\.(?:md|txt|json)$/,
  /^output\/playwright\/(?:[A-Za-z0-9._-]+\/)*(?:runtime-identity[^/]*\.json|(?:ux-|desktop-|mobile-)[^/]+\.(?:png|jpe?g|webp))$/,
];

const secretLikePatterns = [
  { label: "database URL", pattern: /postgres(?:ql)?:\/\/[^\s"']+/i },
  { label: "secret assignment", pattern: /(?:DATABASE_URL|AI_API_KEY|AUTH_SESSION_SECRET|COSIGN_PASSWORD)\s*=\s*[^\s<]+/i },
  { label: "private key", pattern: /-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/i },
  { label: "token", pattern: /\b(?:sk-|rk-|sess-|ghp_|github_pat_)[A-Za-z0-9_-]{16,}/i },
  { label: "authorization or cookie material", pattern: /(?:set-cookie|authorization\s*:\s*bearer|cookie\s*:\s*)/i },
  { label: "raw attachment or provider content", pattern: /["'](?:rawResponse|attachmentContent|uploadBody)["']\s*:/i },
];

export function evaluateReleaseCloseoutBinding(
  options: ReleaseCloseoutBindingOptions,
): ReleaseCloseoutBindingResult {
  const root = path.resolve(options.root);
  const releaseGitCommit = options.releaseGitCommit.trim();
  const currentGitCommit = (options.currentGitCommit?.trim() || git(root, ["rev-parse", "HEAD"])).trim();
  const worktreeClean = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).trim().length === 0;
  const base = {
    releaseGitCommit,
    currentGitCommit,
    worktreeClean,
    changedPaths: [] as string[],
  };
  const issues: string[] = [];

  validateCommitInputs(root, releaseGitCommit, currentGitCommit, issues);
  if (issues.length > 0) return { ...base, status: "invalid", issues };

  if (releaseGitCommit === currentGitCommit) {
    if (options.requireCleanWorktree !== false && !worktreeClean) {
      issues.push("exact release binding requires a clean worktree");
    }
    return { ...base, status: issues.length === 0 ? "exact" : "invalid", issues };
  }

  if (!isAncestor(root, releaseGitCommit, currentGitCommit)) {
    issues.push("currentGitCommit must be the release commit or an evidence-only descendant");
  }
  if (!worktreeClean) issues.push("evidence-only closeout binding requires a clean worktree");

  const commits = commitsBetween(root, releaseGitCommit, currentGitCommit);
  const changedPaths = new Set<string>();
  for (const commit of commits) {
    validateCommitShape(root, commit, issues);
    for (const change of commitChanges(root, commit)) {
      for (const file of change.paths) changedPaths.add(file);
      validateChange(root, commit, change, issues);
    }
  }

  const sortedPaths = [...changedPaths].sort();
  base.changedPaths = sortedPaths;
  return {
    ...base,
    status: issues.length === 0 ? "evidence_only" : "invalid",
    issues: unique(issues),
  };
}

export function isAllowedCloseoutPath(file: string): boolean {
  if (!isSafeRelativePath(file)) return false;
  if (exactAllowedPaths.has(file)) return true;
  if (isAllowedTaskPath(file)) return true;
  return allowedPathPatterns.some((pattern) => pattern.test(file));
}

function validateCommitInputs(root: string, release: string, current: string, issues: string[]): void {
  if (!commitPattern.test(release)) issues.push("releaseGitCommit must be a 40-character commit SHA");
  if (!commitPattern.test(current)) issues.push("currentGitCommit must be a 40-character commit SHA");
  if (!commitPattern.test(release) || !commitPattern.test(current)) return;
  if (!commitExists(root, release)) issues.push("releaseGitCommit does not resolve to a commit");
  if (!commitExists(root, current)) issues.push("currentGitCommit does not resolve to a commit");
}

function validateCommitShape(root: string, commit: string, issues: string[]): void {
  const parents = git(root, ["rev-list", "--parents", "-n", "1", commit]).split(/\s+/).filter(Boolean);
  if (parents.length !== 2) issues.push(`evidence-only closeout cannot contain merge commit: ${commit}`);
}

function validateChange(root: string, commit: string, change: CommitChange, issues: string[]): void {
  const status = change.status[0] ?? "";
  if (status === "D" || status === "C") {
    issues.push(`evidence-only closeout cannot delete or copy files: ${change.paths.join(", ")}`);
    return;
  }
  if (!new Set(["A", "M", "R"]).has(status)) {
    issues.push(`evidence-only closeout does not permit Git status ${change.status}: ${change.paths.join(", ")}`);
    return;
  }
  if (status === "R" && !change.paths.every(isAllowedTaskPath)) {
    issues.push(`evidence-only closeout only permits task moves: ${change.paths.join(", ")}`);
  }
  for (const file of change.paths) {
    if (!isAllowedCloseoutPath(file)) {
      issues.push(`non-evidence path changed after Release: ${file}`);
    }
  }
  const filesAtCommit = status === "R" ? change.paths.slice(-1) : change.paths;
  for (const file of filesAtCommit) {
    if (isAllowedCloseoutPath(file)) validateFileAtCommit(root, commit, file, issues);
  }
}

function validateFileAtCommit(root: string, commit: string, file: string, issues: string[]): void {
  const tree = git(root, ["ls-tree", "-r", commit, "--", file]).trim();
  const mode = tree.split(/\s+/, 1)[0] ?? "";
  if (mode !== "100644") {
    issues.push(`closeout evidence must be a regular 100644 file: ${file}`);
    return;
  }
  const object = `${commit}:${file}`;
  const declaredSize = Number.parseInt(git(root, ["cat-file", "-s", object]).trim(), 10);
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
    issues.push(`closeout evidence file size is invalid: ${file}`);
    return;
  }
  if (declaredSize > maxCloseoutEvidenceBytes) {
    issues.push(`closeout evidence file is too large: ${file}`);
    return;
  }
  const content = gitBuffer(root, ["show", object]);
  if (content.byteLength !== declaredSize) {
    issues.push(`closeout evidence file size changed while reading: ${file}`);
    return;
  }
  if (isImagePath(file)) {
    scanSecretLikeContent(file, content.toString("latin1"), issues);
    if (!hasExpectedImageStructure(file, content)) issues.push(`screenshot has an invalid image structure: ${file}`);
    return;
  }
  const text = content.toString("utf8");
  if (text.includes("\u0000")) {
    issues.push(`closeout evidence must be text or an approved image: ${file}`);
    return;
  }
  scanSecretLikeContent(file, text, issues);
}

function isAllowedTaskPath(file: string): boolean {
  return /^tasks\/(?:active|backlog|done)\/[^/]+\.md$/.test(file)
    && allowedTaskFiles.has(path.posix.basename(file));
}

function isSafeRelativePath(file: string): boolean {
  return file.length > 0
    && !path.posix.isAbsolute(file)
    && !file.includes("\\")
    && !file.split("/").includes("..")
    && path.posix.normalize(file) === file;
}

function isImagePath(file: string): boolean {
  return /\.(?:png|jpe?g|webp)$/i.test(file);
}

function hasExpectedImageStructure(file: string, content: Buffer): boolean {
  if (/\.png$/i.test(file)) return hasPngStructure(content);
  if (/\.jpe?g$/i.test(file)) return hasJpegStructure(content);
  return hasWebpStructure(content);
}

function hasPngStructure(content: Buffer): boolean {
  if (!content.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return false;
  let offset = 8;
  let firstChunk = true;
  while (offset + 12 <= content.length) {
    const length = content.readUInt32BE(offset);
    const type = content.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > content.length) return false;
    if (firstChunk) {
      if (type !== "IHDR" || length !== 13) return false;
      if (content.readUInt32BE(offset + 8) === 0 || content.readUInt32BE(offset + 12) === 0) return false;
      firstChunk = false;
    }
    if (type === "IEND") return length === 0 && end === content.length;
    offset = end;
  }
  return false;
}

function hasJpegStructure(content: Buffer): boolean {
  if (content.length < 12 || content[0] !== 0xff || content[1] !== 0xd8
    || content.at(-2) !== 0xff || content.at(-1) !== 0xd9) return false;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensionsFound = false;
  while (offset < content.length - 2) {
    if (content[offset] !== 0xff) return false;
    while (content[offset] === 0xff) offset += 1;
    const marker = content[offset] ?? 0;
    offset += 1;
    if (marker === 0xda) return dimensionsFound;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > content.length) return false;
    const length = content.readUInt16BE(offset);
    if (length < 2 || offset + length > content.length) return false;
    if (startOfFrame.has(marker)) {
      if (length < 7 || content.readUInt16BE(offset + 3) === 0 || content.readUInt16BE(offset + 5) === 0) return false;
      dimensionsFound = true;
    }
    offset += length;
  }
  return false;
}

function hasWebpStructure(content: Buffer): boolean {
  if (content.length < 20 || content.subarray(0, 4).toString("ascii") !== "RIFF"
    || content.subarray(8, 12).toString("ascii") !== "WEBP") return false;
  const declaredSize = content.readUInt32LE(4) + 8;
  const chunkType = content.subarray(12, 16).toString("ascii");
  const chunkSize = content.readUInt32LE(16);
  const paddedChunkSize = chunkSize + (chunkSize % 2);
  return declaredSize === content.length
    && new Set(["VP8 ", "VP8L", "VP8X"]).has(chunkType)
    && 20 + paddedChunkSize <= content.length;
}

function scanSecretLikeContent(file: string, content: string, issues: string[]): void {
  for (const item of secretLikePatterns) {
    if (item.pattern.test(content)) issues.push(`${file} must not contain ${item.label}`);
  }
}

function commitsBetween(root: string, from: string, to: string): string[] {
  return git(root, ["rev-list", "--reverse", "--ancestry-path", `${from}..${to}`])
    .split(/\r?\n/)
    .filter(Boolean);
}

function commitChanges(root: string, commit: string): CommitChange[] {
  const output = git(root, [
    "diff-tree", "--root", "--no-commit-id", "--name-status", "-r",
    "--find-renames", "--find-copies", "--find-copies-harder", commit,
  ]);
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const fields = line.split("\t");
    const status = fields[0] ?? "";
    return { status, paths: status.startsWith("R") ? fields.slice(1) : [fields[1] ?? ""] };
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function gitBuffer(root: string, args: string[]): Buffer {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "buffer",
    maxBuffer: maxCloseoutEvidenceBytes + 1024,
  });
}

function commitExists(root: string, commit: string): boolean {
  try {
    git(root, ["cat-file", "-e", `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function isAncestor(root: string, from: string, to: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", from, to], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
