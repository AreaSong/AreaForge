import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateOperationsLifecycle, type ValidationIssue } from "./operations-lifecycle-validate";

type JsonRecord = Record<string, unknown>;

const root = process.cwd();
const contract = readJson(path.join(root, "docs/development/operations-lifecycle.json"));
const residuals = readJson(path.join(root, "docs/development/residual-risk-ledger.json"));
const tempDir = mkdtempSync(path.join(os.tmpdir(), "areaforge-operations-lifecycle-"));

try {
  expectPass("valid repository contract", contract);
  expectLedgerFail("V1 ledger rejected", {
    schemaVersion: 1,
    source: "docs/development/residual-risk-ledger.md",
    items: [],
  }, "must be 2");
  expectLedgerFail("invalid V2 ledger rejected", {
    schemaVersion: 2,
    source: "docs/development/residual-risk-ledger.md",
    items: [],
  }, "at least one residual item");

  expectFail("unknown top-level field", mutate((body) => {
    body.unexpected = true;
  }), "exact fields");

  expectFail("invalid effective date", mutate((body) => {
    body.effectiveAt = "2026-02-30";
  }), "valid calendar date");

  expectFail("review before effective date", mutate((body) => {
    body.reviewAt = "2026-01-01";
  }), "later than effectiveAt");

  expectFail("invalid SLO enum", mutate((body) => {
    slo(body, 0).status = "enabled";
  }), "must be one of");

  expectFail("duplicate SLO ID", mutate((body) => {
    slo(body, 1).id = slo(body, 0).id;
  }), "duplicate ID");

  expectFail("active SLO without measurement source", mutate((body) => {
    slo(body, 0).measurementSource = null;
  }), "active SLO must define a measurement source");

  expectFail("active availability without metrics", mutate((body) => {
    slo(body, 3).status = "active";
    slo(body, 3).measurementSource = {
      kind: "record",
      paths: ["docs/development/availability.json"],
      commands: ["pnpm availability:validate"],
      fields: ["availability"],
      metrics: [],
    };
  }), "active availability or latency SLO requires a non-empty metrics source");

  expectFail("incident transition outside allowlist", mutate((body) => {
    transition(body, 0).to = "resolved";
  }), "must contain exactly");

  expectFail("duplicate incident transition", mutate((body) => {
    transition(body, 1).from = transition(body, 0).from;
    transition(body, 1).to = transition(body, 0).to;
  }), "duplicate transition");

  expectFail("retiring capability without close condition", mutate((body) => {
    capability(body, 0).lifecycleStatus = "retiring";
  }), "closeCondition");

  expectFail("unknown residual ID", mutate((body) => {
    capability(body, 0).residualRiskIds = ["AF-RISK-OPS-999"];
  }), "residual ID does not exist");

  expectFail("active object only binds closed evidence", mutate((body) => {
    capability(body, 0).residualRiskIds = ["AF-RISK-SC-003"];
  }), "must not bind only closed-evidence");

  expectFail("secret-bearing evidence path", mutate((body) => {
    measurement(body, 0).paths = [".env.production"];
  }), "secret-bearing path");

  expectFail("secret-like content", mutate((body) => {
    slo(body, 0).notes = "DATABASE_URL=postgresql://user:password@localhost/db";
  }), "secret-like");

  expectFail("non-read-only safety facts", mutate((body) => {
    safety(body).productionWriteAttempted = true;
  }), "must be false");

  expectFail("residual update claimed", mutate((body) => {
    safety(body).residualLedgerUpdated = true;
  }), "must be false");

  const contractFile = path.join(tempDir, "operations-lifecycle.json");
  const residualFile = path.join(tempDir, "residual-risk-ledger.json");
  writeFileSync(contractFile, `${JSON.stringify(contract, null, 2)}\n`);
  writeFileSync(residualFile, `${JSON.stringify(residuals, null, 2)}\n`);
  const cli = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/quality/operations-lifecycle-validate.ts", contractFile, residualFile],
    { cwd: root, encoding: "utf8" },
  );
  if (cli.status !== 0) {
    throw new Error(`validator CLI positive case failed:\n${cli.stdout}\n${cli.stderr}`);
  }
  if (!cli.stdout.includes("operations lifecycle validation passed")) {
    throw new Error("validator CLI did not print the expected success marker");
  }
  expectCliFail("missing ledger rejected", contractFile, path.join(tempDir, "missing-ledger.json"));
  writeFileSync(residualFile, `${JSON.stringify({
    schemaVersion: 1,
    source: "docs/development/residual-risk-ledger.md",
    items: [],
  }, null, 2)}\n`);
  expectCliFail("V1 ledger CLI rejected", contractFile, residualFile);

  console.log("operations lifecycle validator selftest passed: positive contract and schema, enum, ID, date, measurement, metrics, transition, lifecycle closure, residual, secret, and read-only negative cases are covered.");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function expectPass(label: string, body: JsonRecord): void {
  const issues = validateOperationsLifecycle(body, residuals);
  if (issues.length > 0) throw new Error(`${label} should pass:\n${formatIssues(issues)}`);
}

function expectFail(label: string, body: JsonRecord, expected: string): void {
  const issues = validateOperationsLifecycle(body, residuals);
  if (issues.length === 0) throw new Error(`${label} should fail`);
  if (!issues.some((issue) => `${issue.field}: ${issue.message}`.includes(expected))) {
    throw new Error(`${label} did not include ${expected}:\n${formatIssues(issues)}`);
  }
}

function expectLedgerFail(label: string, ledger: JsonRecord, expected: string): void {
  const issues = validateOperationsLifecycle(contract, ledger);
  if (issues.length === 0) throw new Error(`${label} should fail`);
  if (!issues.some((issue) => `${issue.field}: ${issue.message}`.includes(expected))) {
    throw new Error(`${label} did not include ${expected}:\n${formatIssues(issues)}`);
  }
}

function expectCliFail(label: string, contractFile: string, residualFile: string): void {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/quality/operations-lifecycle-validate.ts", contractFile, residualFile],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 1) {
    throw new Error(`${label}: expected status 1, got ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
}

function mutate(change: (body: JsonRecord) => void): JsonRecord {
  const body = structuredClone(contract);
  change(body);
  return body;
}

function slo(body: JsonRecord, index: number): JsonRecord {
  return recordArray(body, "slos")[index] ?? fail(`missing slos[${index}]`);
}

function transition(body: JsonRecord, index: number): JsonRecord {
  const incident = record(body.incidentLifecycle, "incidentLifecycle");
  return recordArray(incident, "allowedTransitions")[index] ?? fail(`missing allowedTransitions[${index}]`);
}

function capability(body: JsonRecord, index: number): JsonRecord {
  return recordArray(body, "capabilities")[index] ?? fail(`missing capabilities[${index}]`);
}

function measurement(body: JsonRecord, index: number): JsonRecord {
  return record(slo(body, index).measurementSource, `slos[${index}].measurementSource`);
}

function safety(body: JsonRecord): JsonRecord {
  return record(body.safetyFacts, "safetyFacts");
}

function recordArray(body: JsonRecord, field: string): JsonRecord[] {
  const value = body[field];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) fail(`${field} must be an object array`);
  return value as JsonRecord[];
}

function record(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
}

function readJson(file: string): JsonRecord {
  return JSON.parse(readFileSync(file, "utf8")) as JsonRecord;
}

function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `- ${issue.field}: ${issue.message}`).join("\n");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}
