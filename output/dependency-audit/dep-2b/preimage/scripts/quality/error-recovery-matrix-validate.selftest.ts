import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const source = path.join(root, "docs/development/error-recovery-matrix.json");

async function main(): Promise<void> {
  const original = await readFile(source, "utf8");
  const temp = await fsTempFile();
  try {
    await writeFile(temp, original.replace('"schemaVersion": 1', '"schemaVersion": 99'));
    const result = execFileSync("pnpm", ["exec", "tsx", "scripts/quality/error-recovery-matrix-validate.ts"], {
      cwd: root,
      env: { ...process.env, AREAFORGE_ERROR_RECOVERY_MATRIX_FILE: temp },
      encoding: "utf8",
      stdio: "pipe",
    });
    throw new Error(`mutated matrix unexpectedly passed: ${result}`);
  } catch (error) {
    if (!(error && typeof error === "object" && "status" in error && error.status !== 0)) throw error;
  } finally {
    await import("node:fs/promises").then(({ unlink }) => unlink(temp).catch(() => undefined));
  }
  console.log("error recovery matrix selftest passed.");
}

async function fsTempFile(): Promise<string> {
  return path.join(os.tmpdir(), `areaforge-error-recovery-${process.pid}.json`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
