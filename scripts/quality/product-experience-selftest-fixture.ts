import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { createStoredRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";
import { canonicalSha256, PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA } from "./product-experience-source";
import {
  V11_DOES_NOT_PROVE,
  V11_FIXTURE_SCHEMA,
  V11_JOURNEY_CONTRACTS,
  V11_JOURNEY_IDS,
  V11_JOURNEY_SCHEMA,
  V11_VIEWPORT_CONTRACT,
  V11_VIEWPORTS,
  computeFixtureManifestHash,
  computeRuntimeResponseHash,
  type V11Assertion,
  type V11AssertionContract,
  type V11FixtureEvidence,
  type V11JourneyEvidence,
} from "./v11-browser-evidence-contract";

interface SyntheticJourneyInput {
  root: string; file: string; screenshotDir: string; generatedAt: string;
  appVersion: string; gitCommit: string; sourceHash: string;
}

/** 仅供 validator 自测的合成证据；不启动浏览器，不得用于产品或生产验收。 */
export function createSyntheticJourneyIdentity(input: {
  appVersion: string; gitCommit: string; sourceHash: string; observedAt: string;
}): V11JourneyEvidence["runtimeIdentityEvidence"]["runtimeIdentity"] {
  const stored = createStoredRuntimeIdentity({ appVersion: input.appVersion, gitCommit: input.gitCommit,
    sourceFingerprintSchema: PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA, productExperienceSourceHash: input.sourceHash,
    buildId: canonicalSha256({ domain: "areaforge.runtime-build.v1", appVersion: input.appVersion,
      gitCommit: input.gitCommit, productExperienceSourceHash: input.sourceHash, runtimeMode: "production-build" }),
    runtimeMode: "production-build" });
  return { ...stored, sourceFingerprintSchema: PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA,
    runtimeMode: "production-build", observedAt: input.observedAt, reasonCode: "NONE" };
}

export function writeSyntheticJourneyEvidence(input: SyntheticJourneyInput): void {
  const { root, file, screenshotDir, generatedAt } = input;
  mkdirSync(screenshotDir, { recursive: true });
  const runtimeIdentity = createSyntheticJourneyIdentity({ ...input, observedAt: generatedAt });
  const accounts = [
    ...V11_VIEWPORTS.flatMap((viewport) => V11_JOURNEY_IDS.map((journeyId) => ({
      accountRef: canonicalSha256({ domain: "v11-selftest-account", id: `${viewport}-${journeyId}` }),
      purpose: "journey" as const,
      viewport,
      journeyId,
    }))),
    {
      accountRef: canonicalSha256({ domain: "v11-selftest-account", id: "accessibility-suite" }),
      purpose: "accessibility" as const,
      viewport: "suite" as const,
      journeyId: null,
    },
  ];
  const fixtureProjection = {
    schemaVersion: V11_FIXTURE_SCHEMA,
    fixtureSetId: "product-experience-selftest",
    generatedAt,
    contentClassification: "synthetic-only",
    isolation: "one-user-per-viewport-journey",
    journeyAccountCount: 18,
    accessibilityAccountCount: 1,
    accounts,
  } as const satisfies Omit<V11FixtureEvidence, "manifestSha256">;
  const fixtureEvidence: V11FixtureEvidence = {
    ...fixtureProjection,
    manifestSha256: computeFixtureManifestHash(fixtureProjection),
  };
  const baseTime = Date.parse(generatedAt) - 40_000;
  let index = 0;
  const journeys: V11JourneyEvidence["journeys"] = [];

  for (const viewportId of V11_VIEWPORTS) {
    for (const journey of V11_JOURNEY_IDS) {
      const id = `${viewportId}-${journey}`;
      const screenshotFile = path.join(screenshotDir, `${id}.png`);
      const viewportContract = V11_VIEWPORT_CONTRACT[viewportId];
      const screenshotBytes = buildPng(viewportContract.width, viewportContract.height);
      writeFileSync(screenshotFile, screenshotBytes);
      const contract = V11_JOURNEY_CONTRACTS[journey];
      const startedAt = new Date(baseTime + index * 2_000).toISOString();
      const finishedAt = new Date(baseTime + index * 2_000 + 1_000).toISOString();
      const viewport = {
        id: viewportId,
        ...V11_VIEWPORT_CONTRACT[viewportId],
      };
      journeys.push({
        id,
        journey,
        viewport,
        accountRef: accounts[index]!.accountRef,
        startPath: materializeRoute(contract.startPath),
        terminalPath: materializeRoute(contract.terminalPath),
        mutation: {
          initiatedBy: "page-ui",
          uiOriginatedMutation: true,
          method: contract.mutation.method,
          path: materializeRoute(contract.mutation.path),
          status: contract.mutation.status,
          requestCount: 1,
        },
        oracle: {
          method: "GET",
          path: contract.oraclePath,
          before: {
            status: contract.beforeStatus,
            responseSha256: canonicalSha256({ domain: "v11-selftest-oracle-before", id }),
            assertions: passingAssertions(contract.beforeAssertions),
          },
          after: {
            status: contract.afterStatus,
            responseSha256: canonicalSha256({ domain: "v11-selftest-oracle-after", id }),
            assertions: passingAssertions(contract.afterAssertions),
          },
        },
        terminalAssertions: passingAssertions(contract.terminalAssertions),
        screenshot: {
          path: path.relative(root, screenshotFile),
          sha256: rawSha256(screenshotBytes),
          width: viewport.width,
          height: viewport.height,
          syntheticContent: true,
        },
        telemetry: {
          consoleErrors: [],
          pageErrors: [],
          requestFailures: [],
          httpFailures: [],
          unexplainedFailureCount: 0,
        },
        startedAt,
        finishedAt,
        durationMs: 1_000,
        result: "pass",
      });
      index += 1;
    }
  }

  const evidence: V11JourneyEvidence = {
    schemaVersion: V11_JOURNEY_SCHEMA,
    generatedAt,
    environment: {
      kind: "local-production-mode",
      baseUrl: "http://127.0.0.1:3102",
      browserName: "chrome",
      browserVersion: "selftest-chrome-1",
      playwrightVersion: "selftest-1",
    },
    runtimeIdentityEvidence: {
      request: { method: "GET", path: "/api/health", status: 200 },
      runtimeIdentity,
      responseSha256: computeRuntimeResponseHash(runtimeIdentity),
    },
    fixtureEvidence,
    summary: {
      total: 18,
      passed: 18,
      failed: 0,
      skipped: 0,
      desktop: 9,
      mobile: 9,
      uiOriginatedMutations: 18,
      getOnlyOracles: 18,
      unexplainedFailureCount: 0,
    },
    journeys,
    doesNotProve: [...V11_DOES_NOT_PROVE],
    safetyFacts: {
      localBaseUrl: true,
      localDatabase: true,
      explicitWriteOptIn: true,
      passwordSource: "restricted-file",
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      backupRestoreAttempted: false,
      migrationAttempted: false,
      destructiveActionAttempted: false,
      updaterApplyAttempted: false,
      releaseCreated: false,
      secretValuePrinted: false,
      realStudyContentIncluded: false,
      residualLedgerUpdated: false,
    },
  };
  writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
}

function passingAssertions(contracts: readonly V11AssertionContract[]): V11Assertion[] {
  return contracts.map((contract) => {
    let expected: V11Assertion["expected"];
    if (contract.expected.kind === "literal") expected = structuredClone(contract.expected.value);
    else if (contract.expected.kind === "integer") expected = contract.expected.min;
    else if (contract.expected.kind === "route") expected = "/selftest";
    else expected = "selftest-token";
    return {
      id: contract.id,
      predicate: contract.predicate,
      expected,
      actual: structuredClone(expected),
      passed: true,
    };
  });
}

function materializeRoute(route: string): string {
  return route
    .replace(":sessionId", "selftest-session")
    .replace(":reportId", "selftest-report")
    .replace(":examId", "selftest-exam");
}

function buildPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  const rows = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}


function rawSha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
