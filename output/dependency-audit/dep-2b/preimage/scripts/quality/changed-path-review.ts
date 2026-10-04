import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

type ReviewTier = "routine" | "protected-path" | "high-risk";

type ChangeGroup = {
  key: string;
  tier: ReviewTier;
  sourceFacts: string[];
  minimumValidation: string[];
};

type ClassifiedPath = ChangeGroup & {
  path: string;
};

type ReviewReport = {
  schemaVersion: 1;
  mode: "read_only_changed_path_review";
  source: { kind: "worktree" | "git-range"; base?: string };
  paths: ClassifiedPath[];
  tiers: Record<ReviewTier, string[]>;
  requiredSourceFacts: string[];
  minimumValidation: string[];
  highRiskConfirmationRequired: boolean;
  doesNotProve: string[];
  safetyFacts: {
    readOnly: true;
    networkRequested: false;
    serverCommandAttempted: false;
    productionWriteAttempted: false;
    secretValuePrinted: false;
    gitWriteAttempted: false;
  };
};

const groups: Array<{ matches: (file: string) => boolean; group: ChangeGroup }> = [
  {
    matches: (file) => file === "prisma/schema.prisma" || file.startsWith("prisma/migrations/") || file.startsWith("packages/db/"),
    group: {
      key: "database-migration",
      tier: "high-risk",
      sourceFacts: ["docs/architecture/data-model.md", "docs/development/runtime-write-boundary.md"],
      minimumValidation: ["pnpm db:validate", "pnpm risk:preflight", "pnpm check"],
    },
  },
  {
    matches: (file) => file.startsWith("packages/storage/") || file.startsWith("apps/web/app/api/attachments/") || file.includes("attachments-service"),
    group: {
      key: "file-storage",
      tier: "high-risk",
      sourceFacts: ["docs/architecture/file-storage.md", "docs/security/file-ai-safety.md"],
      minimumValidation: ["pnpm risk:preflight", "pnpm check"],
    },
  },
  {
    matches: (file) => file.startsWith("packages/ai/") || file.includes("/api/ai/") || file.includes("stage-adjustment-drafts/ai"),
    group: {
      key: "ai-privacy",
      tier: "high-risk",
      sourceFacts: ["docs/architecture/ai-boundary.md", "docs/security/file-ai-safety.md"],
      minimumValidation: ["pnpm risk:preflight", "pnpm --filter @areaforge/ai test", "pnpm check"],
    },
  },
  {
    matches: (file) => file.includes("/api/auth") || file.includes("auth/") || file.includes("session"),
    group: {
      key: "authentication",
      tier: "high-risk",
      sourceFacts: ["docs/architecture/auth-security.md", "docs/security/threat-model.md"],
      minimumValidation: ["pnpm risk:preflight", "pnpm check"],
    },
  },
  {
    matches: (file) => file.startsWith("ops/") || file.startsWith("docker-compose") || file.startsWith("infra/docker/") || file.startsWith("docs/deployment/"),
    group: {
      key: "release-ops",
      tier: "high-risk",
      sourceFacts: ["docs/development/production-release-runbook.md", "docs/development/runtime-write-boundary.md"],
      minimumValidation: ["pnpm github-release-updater:preflight", "pnpm ops:readiness", "pnpm check"],
    },
  },
  {
    matches: (file) => file.startsWith(".github/") || file === "package.json" || file.startsWith("scripts/quality/") || file.startsWith("scripts/ops/") || file.startsWith("docs/development/") || file === "AGENTS.md" || file === "CODE_REVIEW.md" || file === "SECURITY.md" || file === "SUPPORT.md",
    group: {
      key: "governance-control-plane",
      tier: "protected-path",
      sourceFacts: ["docs/development/governance-boundary-matrix.md", "docs/development/validation-matrix.md"],
      minimumValidation: ["pnpm governance:preflight", "pnpm docs:readiness", "git diff --check"],
    },
  },
];

const routineGroup: ChangeGroup = {
  key: "routine",
  tier: "routine",
  sourceFacts: ["docs/development/validation-matrix.md"],
  minimumValidation: ["pnpm check", "git diff --check"],
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const files = options.pathsFile
    ? readPathsFile(options.pathsFile)
    : options.base
      ? collectRangePaths(options.base)
      : collectWorktreePaths();
  const report = buildReport(files, options.base);
  if (options.summary) {
    printSummary(report);
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

export function buildReport(files: string[], base?: string): ReviewReport {
  const paths = [...new Set(files.filter(Boolean))].sort().map((file) => classifyPath(file));
  const tiers: Record<ReviewTier, string[]> = {
    routine: [],
    "protected-path": [],
    "high-risk": [],
  };
  for (const item of paths) {
    tiers[item.tier].push(item.path);
  }

  return {
    schemaVersion: 1,
    mode: "read_only_changed_path_review",
    source: base ? { kind: "git-range", base } : { kind: "worktree" },
    paths,
    tiers,
    requiredSourceFacts: unique(paths.flatMap((item) => item.sourceFacts)),
    minimumValidation: unique(paths.flatMap((item) => item.minimumValidation)),
    highRiskConfirmationRequired: tiers["high-risk"].length > 0,
    doesNotProve: [
      "high-risk confirmation exists",
      "production health",
      "all repository paths were reviewed",
      "git worktree cleanliness",
      "updater apply",
      "backup/restore",
      "migration",
      "rollback",
    ],
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
      gitWriteAttempted: false,
    },
  };
}

export function classifyPath(file: string): ClassifiedPath {
  const group = groups.find((candidate) => candidate.matches(file))?.group ?? routineGroup;
  return { ...group, path: redactPath(file) };
}

function parseArgs(args: string[]): { base?: string; pathsFile?: string; summary: boolean } {
  let base: string | undefined;
  let pathsFile: string | undefined;
  let summary = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base") {
      base = args[index + 1];
      index += 1;
    } else if (arg === "--paths-file") {
      pathsFile = args[index + 1];
      index += 1;
    } else if (arg === "--summary") {
      summary = true;
    } else {
      usage();
    }
  }
  if ((base === undefined && args.includes("--base")) || (pathsFile === undefined && args.includes("--paths-file")) || (base && pathsFile)) {
    usage();
  }
  return { base, pathsFile, summary };
}

function collectWorktreePaths(): string[] {
  return unique([
    ...gitLines(["diff", "--name-only", "HEAD"]),
    ...gitLines(["ls-files", "--others", "--exclude-standard"]),
  ]);
}

function collectRangePaths(base: string): string[] {
  return gitLines(["diff", "--name-only", `${base}...HEAD`]);
}

function readPathsFile(file: string): string[] {
  return readFileSync(path.resolve(file), "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function gitLines(args: string[]): string[] {
  const result = spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`changed path review failed to run git ${args.join(" ")}`);
    console.error(result.stderr.trim());
    process.exit(2);
  }
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function printSummary(report: ReviewReport): void {
  console.log("AreaForge changed path review");
  console.log(`source: ${report.source.kind}${report.source.base ? ` base=${report.source.base}` : ""}`);
  for (const tier of ["routine", "protected-path", "high-risk"] as const) {
    console.log(`${tier}: ${report.tiers[tier].length === 0 ? "none" : report.tiers[tier].join(", ")}`);
  }
  console.log(`highRiskConfirmationRequired: ${report.highRiskConfirmationRequired}`);
  console.log(`requiredSourceFacts: ${report.requiredSourceFacts.join(", ") || "none"}`);
  console.log(`minimumValidation: ${report.minimumValidation.join("; ") || "none"}`);
  console.log("claimBoundary: this is a path-based read-only classifier; it does not grant approval or prove production state.");
}

function redactPath(file: string): string {
  return /(?:^|\/)(?:\.env(?:\.|$)|.*(?:secret|password|token|credential|private[_-]?key|id_ed25519).*)/i.test(file)
    ? "<redacted-sensitive-path>"
    : file;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function usage(): never {
  console.error("Usage: pnpm governance:changed-paths [--base <git-ref> | --paths-file <newline-separated-paths>] [--summary]");
  process.exit(2);
}

main();
