import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/quality/arch-layer-boundary.ts");
const tsxBin = path.join(root, "node_modules/.bin/tsx");

function createWorkspace(): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-arch-boundary-"));
  for (const dir of ["apps/web/lib", "packages/core/src", "packages/ai/src"]) {
    mkdirSync(path.join(workspace, dir), { recursive: true });
  }
  writeFileSync(
    path.join(workspace, "apps/web/lib/service.ts"),
    'import { prisma } from "@areaforge/db";\nexport const ok = prisma;\n',
  );
  writeFileSync(
    path.join(workspace, "packages/core/src/rules.ts"),
    "export function windowLabel(window: { label?: string }): string {\n  return window.label ? `${window.label} ` : \"\";\n}\n",
  );
  writeFileSync(path.join(workspace, "packages/ai/src/draft.ts"), "export const draft = 1;\n");
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
const webPrismaWorkspace = createWorkspace();
const webDeepImportWorkspace = createWorkspace();
const coreEnvWorkspace = createWorkspace();
const coreNextWorkspace = createWorkspace();
const coreBrowserWorkspace = createWorkspace();
const aiDbWorkspace = createWorkspace();
const missingRootWorkspace = createWorkspace();

try {
  writeFileSync(
    path.join(webPrismaWorkspace, "apps/web/lib/direct.ts"),
    'import { PrismaClient } from "@prisma/client";\nexport const client = new PrismaClient();\n',
  );
  writeFileSync(
    path.join(webDeepImportWorkspace, "apps/web/lib/deep.ts"),
    'import { PrismaClient } from "@areaforge/db/generated/prisma/client";\nexport const client = new PrismaClient();\n',
  );
  writeFileSync(
    path.join(coreEnvWorkspace, "packages/core/src/env.ts"),
    "export const flag = process.env.AREAFORGE_FLAG === \"true\";\n",
  );
  writeFileSync(
    path.join(coreNextWorkspace, "packages/core/src/next-dep.ts"),
    'import { headers } from "next/headers";\nexport const value = headers;\n',
  );
  writeFileSync(
    path.join(coreBrowserWorkspace, "packages/core/src/browser.ts"),
    "export function persist(value: string): void {\n  localStorage.setItem(\"key\", value);\n}\n",
  );
  writeFileSync(
    path.join(aiDbWorkspace, "packages/ai/src/write.ts"),
    'import { prisma } from "@areaforge/db";\nexport const client = prisma;\n',
  );
  rmSync(path.join(missingRootWorkspace, "packages/ai"), { force: true, recursive: true });

  expectCase("clean workspace passes", cleanWorkspace, 0, "arch layer boundary check passed");
  expectCase("web direct @prisma/client import fails", webPrismaWorkspace, 1, "import Prisma client via @areaforge/db instead");
  expectCase("web deep import into db internals fails", webDeepImportWorkspace, 1, "deep import into packages/db internals is forbidden");
  expectCase("core process.env usage fails", coreEnvWorkspace, 1, "core must not read environment variables");
  expectCase("core next dependency fails", coreNextWorkspace, 1, "core must not depend on Next.js");
  expectCase("core browser API usage fails", coreBrowserWorkspace, 1, "core must not use browser APIs");
  expectCase("ai database dependency fails", aiDbWorkspace, 1, "ai only produces suggestions/drafts and must not touch the database");
  expectCase("missing layer root fails closed", missingRootWorkspace, 1, "layer root is missing");

  console.log("arch layer boundary selftest passed.");
} finally {
  for (const workspace of [
    cleanWorkspace,
    webPrismaWorkspace,
    webDeepImportWorkspace,
    coreEnvWorkspace,
    coreNextWorkspace,
    coreBrowserWorkspace,
    aiDbWorkspace,
    missingRootWorkspace,
  ]) {
    rmSync(workspace, { force: true, recursive: true });
  }
}
