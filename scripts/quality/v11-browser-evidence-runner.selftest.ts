import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBrowserEvidenceConfig } from "../ops/v11-browser-fixtures";
import {
  V11_ACCESSIBILITY_CHECK_CONTRACTS,
  V11_ACCESSIBILITY_CHECK_IDS,
  V11_JOURNEY_CONTRACTS,
  V11_JOURNEY_IDS,
  assertV11AssertionListContract,
  type V11Assertion,
  type V11AssertionContract,
} from "./v11-browser-evidence-contract";

const temporaryRoot = mkdtempSync(path.join(tmpdir(), "areaforge-v11-browser-runner-"));
const passwordFile = path.join(temporaryRoot, "password.txt");
writeFileSync(passwordFile, "synthetic-browser-password\n", { mode: 0o600 });
chmodSync(passwordFile, 0o600);

const chromePath = path.join(temporaryRoot, "synthetic-chrome");
writeFileSync(chromePath, "browser-evidence-config-selftest\n", { mode: 0o700 });
chmodSync(chromePath, 0o700);
const originalEnvironment = { ...process.env };

try {
  const baseline = {
    AREAFORGE_BROWSER_EVIDENCE_ALLOW_WRITES: "true",
    AREAFORGE_BROWSER_EVIDENCE_BASE_URL: "http://127.0.0.1:3199",
    AREAFORGE_BROWSER_EVIDENCE_EXPECTED_DATABASE_NAME: "areaforge_v11browser_selftest",
    AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR: "output/playwright/v11-browser-evidence-runner-selftest",
    AREAFORGE_BROWSER_EVIDENCE_CHROME_PATH: chromePath,
    AREAFORGE_SMOKE_PASSWORD_FILE: passwordFile,
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/areaforge_v11browser_selftest",
  };

  withEnvironment(baseline, () => {
    const config = loadBrowserEvidenceConfig();
    assert.equal(config.baseUrl.origin, "http://127.0.0.1:3199");
    assert.equal(config.expectedDatabaseName, "areaforge_v11browser_selftest");
    assert.equal(config.password, "synthetic-browser-password");
  });

  expectRejected(baseline, { AREAFORGE_BROWSER_EVIDENCE_ALLOW_WRITES: undefined }, "write opt-in");
  expectRejected(baseline, { AREAFORGE_BROWSER_EVIDENCE_ALLOW_NON_LOCAL: "false" }, "non-local override");
  expectRejected(baseline, { AREAFORGE_SMOKE_PASSWORD: "plaintext" }, "plaintext password");
  expectRejected(baseline, { AREAFORGE_BROWSER_EVIDENCE_EXPECTED_DATABASE_NAME: undefined }, "expected database name");
  expectRejected(baseline, { AREAFORGE_BROWSER_EVIDENCE_EXPECTED_DATABASE_NAME: "areaforge_dev" }, "disposable database marker");
  expectRejected(baseline, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/other_v11browser" }, "database name mismatch");
  expectRejected(baseline, { DATABASE_URL: "postgresql://fixture:fixture@example.com:5432/areaforge_v11browser_selftest" }, "non-local database");
  expectRejected(baseline, { DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:5432/areaforge_v11browser_selftest?hostaddr=10.0.0.1" }, "hostaddr override");
  expectRejected(baseline, { AREAFORGE_BROWSER_EVIDENCE_BASE_URL: "https://example.com" }, "non-local runtime");
  expectRejected(baseline, { AREAFORGE_BROWSER_EVIDENCE_OUTPUT_DIR: "../outside" }, "output traversal");

  for (const journeyId of V11_JOURNEY_IDS) {
    const contract = V11_JOURNEY_CONTRACTS[journeyId];
    assertUniqueContractIds(contract.beforeAssertions, `${journeyId} before`);
    assertUniqueContractIds(contract.afterAssertions, `${journeyId} after`);
    assertUniqueContractIds(contract.terminalAssertions, `${journeyId} terminal`);
  }
  for (const checkId of V11_ACCESSIBILITY_CHECK_IDS) {
    assertUniqueContractIds(V11_ACCESSIBILITY_CHECK_CONTRACTS[checkId].assertions, checkId);
  }

  const sampleContract = [{
    id: "sample-check",
    predicate: "gte",
    expected: { kind: "literal", value: 1 },
  }] as const satisfies readonly V11AssertionContract[];
  const validSample: V11Assertion[] = [{
    id: "sample-check", predicate: "gte", expected: 1, actual: 2, passed: true,
  }];
  assert.doesNotThrow(() => assertV11AssertionListContract(validSample, sampleContract, "sample"));
  assert.throws(
    () => assertV11AssertionListContract(
      [{ ...validSample[0]!, id: "drifted-check" }],
      sampleContract,
      "sample",
    ),
    /does not match/,
  );

  console.log("PASS v11 browser evidence runner safety selftest");
} finally {
  replaceEnvironment(originalEnvironment);
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function assertUniqueContractIds(contract: readonly V11AssertionContract[], scope: string): void {
  const ids = contract.map((assertion) => assertion.id);
  assert.equal(new Set(ids).size, ids.length, `${scope} assertion IDs must be unique`);
}

function expectRejected(
  baseline: Record<string, string>,
  overrides: Record<string, string | undefined>,
  label: string,
): void {
  withEnvironment({ ...baseline, ...overrides }, () => {
    assert.throws(() => loadBrowserEvidenceConfig(), Error, `${label} must fail closed`);
  });
}

function withEnvironment(values: Record<string, string | undefined>, action: () => void): void {
  const before = { ...process.env };
  try {
    replaceEnvironment({ ...originalEnvironment, ...values });
    action();
  } finally {
    replaceEnvironment(before);
  }
}

function replaceEnvironment(values: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}
