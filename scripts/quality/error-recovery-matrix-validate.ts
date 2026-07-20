import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourcePath = process.env.AREAFORGE_ERROR_RECOVERY_MATRIX_FILE
  ? path.resolve(process.env.AREAFORGE_ERROR_RECOVERY_MATRIX_FILE)
  : path.join(root, "docs/development/error-recovery-matrix.json");
const allowedSeverities = new Set(["P0", "P1", "P2"]);
const residualPattern = /^AF-RISK-[A-Z0-9-]+$/;
const requiredKeys = [
  "id",
  "domain",
  "severity",
  "failureSignal",
  "userMessage",
  "userRecoveryAction",
  "operatorDiagnosticEntry",
  "sideEffectExpectation",
  "reopenResidual",
  "evidenceCommand",
];

async function main(): Promise<void> {
  const document = JSON.parse(await readFile(sourcePath, "utf8")) as Record<string, unknown>;
  const rows = document.rows;
  const errors: string[] = [];
  if (document.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!Array.isArray(rows) || rows.length < 8) errors.push("rows must contain at least 8 recovery domains");

  const ids = new Set<string>();
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`rows[${index}] must be an object`);
      continue;
    }
    const value = row as Record<string, unknown>;
    for (const key of requiredKeys) {
      if (typeof value[key] !== "string" || value[key] === "") errors.push(`rows[${index}].${key} is required`);
    }
    const id = typeof value.id === "string" ? value.id : "";
    if (ids.has(id)) errors.push(`duplicate row id: ${id}`);
    ids.add(id);
    if (!allowedSeverities.has(String(value.severity))) errors.push(`rows[${index}] has invalid severity`);
    const residual = String(value.reopenResidual);
    if (residual !== "none" && !residual.split(",").every((item) => residualPattern.test(item))) {
      errors.push(`rows[${index}].reopenResidual contains an invalid residual id`);
    }
    const serialized = JSON.stringify(value);
    if (/password|secret|token|api[_-]?key|session cookie|database url/i.test(serialized)) {
      errors.push(`rows[${index}] contains a forbidden secret-like term`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`error recovery matrix validation passed: ${rows.length} rows`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
