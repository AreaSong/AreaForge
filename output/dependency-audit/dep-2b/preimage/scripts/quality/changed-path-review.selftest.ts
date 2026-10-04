import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-changed-path-review-"));

try {
  const fixture = path.join(tempDir, "paths.txt");
  writeFileSync(fixture, [
    "apps/web/components/dashboard.tsx",
    "docs/development/operational-readiness.md",
    "prisma/schema.prisma",
    "packages/ai/src/provider.ts",
    "ops/update-agent/areaforge-update-agent.sh",
    ".env.production",
  ].join("\n"));

  const result = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/changed-path-review.ts", "--paths-file", fixture], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`fixture review failed: ${result.stderr.trim()}`);
  }
  const report = JSON.parse(result.stdout) as {
    mode: string;
    paths: Array<{ path: string; tier: string; key: string }>;
    tiers: Record<string, string[]>;
    highRiskConfirmationRequired: boolean;
    safetyFacts: Record<string, boolean>;
  };
  assert(report.mode === "read_only_changed_path_review", "mode should identify read-only changed path review");
  assert(report.tiers["high-risk"].length === 3, "three high-risk paths should be classified");
  assert(report.tiers["protected-path"].length === 1, "one protected path should be classified");
  assert(report.tiers.routine.length === 2, "routine and redacted sensitive paths should remain visible in count");
  assert(report.highRiskConfirmationRequired, "high-risk path set should require a separate confirmation");
  assert(report.paths.some((item) => item.path === "<redacted-sensitive-path>"), "sensitive path should be redacted in output");
  assert(!result.stdout.includes(".env.production"), "raw sensitive path should not appear in JSON output");
  assert(report.safetyFacts.readOnly && !report.safetyFacts.networkRequested && !report.safetyFacts.gitWriteAttempted, "safety facts should preserve the read-only boundary");

  const summary = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/changed-path-review.ts", "--paths-file", fixture, "--summary"], {
    cwd: root,
    encoding: "utf8",
  });
  assert(summary.status === 0, "summary should pass");
  assert(summary.stdout.includes("highRiskConfirmationRequired: true"), "summary should expose the confirmation requirement");
  console.log("changed path review selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}
