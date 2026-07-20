import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/quality/docs-evergreen-check.ts");
const tsxBin = path.join(root, "node_modules/.bin/tsx");

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-docs-evergreen-"));
  for (const dir of ["docs/guide", "docs/product", "docs/modules", "docs/architecture", "docs/ux"]) {
    mkdirSync(path.join(workspace, dir), { recursive: true });
  }
  writeFileSync(
    path.join(workspace, "docs/modules/clean.md"),
    ["# 模块", "", "- 行为定义，不带版本。", "- 实现进度见功能追踪矩阵。", ""].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "docs/modules/mastery-proof.md"),
    ["# 掌握证明", "", "实现进度与批次证据（含 Package B Batch 4 的确认边界）见功能追踪矩阵。", ""].join("\n"),
  );
  return workspace;
}

function run(workspace: string): { status: number | null; output: string } {
  const result = spawnSync(tsxBin, [scriptPath], { cwd: workspace, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function expectCase(label: string, workspace: string, expectedStatus: number, expectedOutput: string): void {
  const result = run(workspace);
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${result.status}`);
    console.error(result.output.trim());
    process.exit(1);
  }
  if (!result.output.includes(expectedOutput)) {
    console.error(`FAIL ${label}: expected output to include ${expectedOutput}`);
    console.error(result.output.trim());
    process.exit(1);
  }
}

const cleanWorkspace = createWorkspace();
const packageNarrativeWorkspace = createWorkspace();
const versionPinWorkspace = createWorkspace();
const statusHeadingWorkspace = createWorkspace();
const dateWorkspace = createWorkspace();

try {
  writeFileSync(
    path.join(packageNarrativeWorkspace, "docs/modules/violating.md"),
    "Package B Batch 2 已新增事件账本。\n",
  );
  writeFileSync(
    path.join(versionPinWorkspace, "docs/architecture/violating.md"),
    "当前生产运行 `0.1.7`。\n",
  );
  writeFileSync(
    path.join(statusHeadingWorkspace, "docs/ux/violating.md"),
    "## 当前实现状态\n",
  );
  writeFileSync(
    path.join(dateWorkspace, "docs/guide/violating.md"),
    "该功能于 2026-07-12 上线。\n",
  );

  expectCase("clean long-term docs pass", cleanWorkspace, 0, "docs evergreen check passed");
  expectCase("allowlisted mastery anchor passes", cleanWorkspace, 0, "docs evergreen check passed");
  expectCase("package narrative fails", packageNarrativeWorkspace, 1, "[package-narrative]");
  expectCase("version pin fails", versionPinWorkspace, 1, "[pinned-version]");
  expectCase("implementation status heading fails", statusHeadingWorkspace, 1, "[implementation-status-heading]");
  expectCase("pinned date fails", dateWorkspace, 1, "[pinned-date]");

  console.log("docs evergreen check selftest passed.");
} finally {
  for (const workspace of [
    cleanWorkspace,
    packageNarrativeWorkspace,
    versionPinWorkspace,
    statusHeadingWorkspace,
    dateWorkspace,
  ]) {
    rmSync(workspace, { force: true, recursive: true });
  }
}
