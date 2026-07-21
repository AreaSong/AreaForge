import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/quality/docs-link-integrity.ts");
const tsxBin = path.join(root, "node_modules/.bin/tsx");

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-docs-links-"));
  mkdirSync(path.join(workspace, "docs/development"), { recursive: true });
  writeFileSync(path.join(workspace, "docs/development/target.md"), "# target\n");
  writeFileSync(
    path.join(workspace, "README.md"),
    [
      "# Test",
      "",
      "- [existing relative](docs/development/target.md)",
      "- [existing with anchor](docs/development/target.md#target)",
      "- [external](https://example.com/page)",
      "- [template placeholder](docs/development/release-vX.Y.Z-record.md)",
      "",
      "```bash",
      "cat [not a link](docs/development/inside-code-fence.md)",
      "```",
      "",
    ].join("\n"),
  );
  return workspace;
}

function run(workspace: string): { status: number | null; output: string } {
  const result = spawnSync(tsxBin, [scriptPath], {
    cwd: workspace,
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function expectCase(
  label: string,
  workspace: string,
  expectedStatus: number,
  expectedOutput?: string,
): void {
  const result = run(workspace);
  if (result.status !== expectedStatus) {
    console.error(`FAIL ${label}: expected exit ${expectedStatus}, got ${result.status}`);
    console.error(result.output.trim());
    process.exit(1);
  }
  if (expectedOutput && !result.output.includes(expectedOutput)) {
    console.error(`FAIL ${label}: expected output to include ${expectedOutput}`);
    console.error(result.output.trim());
    process.exit(1);
  }
}

const cleanWorkspace = createWorkspace();
const brokenWorkspace = createWorkspace();
const brokenNestedWorkspace = createWorkspace();

try {
  writeFileSync(
    path.join(brokenWorkspace, "docs/broken.md"),
    "see [missing](development/definitely-missing.md)\n",
  );
  writeFileSync(
    path.join(brokenNestedWorkspace, "docs/development/relative.md"),
    "see [sibling](./missing-sibling.md)\n",
  );

  expectCase("clean workspace passes", cleanWorkspace, 0, "docs link integrity passed");
  expectCase("broken relative link fails", brokenWorkspace, 1, "broken relative link -> development/definitely-missing.md");
  expectCase("broken sibling link fails", brokenNestedWorkspace, 1, "broken relative link -> ./missing-sibling.md");

  console.log("docs link integrity selftest passed.");
} finally {
  for (const workspace of [cleanWorkspace, brokenWorkspace, brokenNestedWorkspace]) {
    rmSync(workspace, { force: true, recursive: true });
  }
}
