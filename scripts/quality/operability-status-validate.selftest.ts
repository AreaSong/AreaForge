import {
  buildOperabilityStatusProjection,
  type OperabilityStatusProjection,
} from "../ops/operability-status";
import { validateOperabilityStatus } from "./operability-status-validate";

function main(): void {
  const projection = buildOperabilityStatusProjection({
    asOf: "2026-07-12",
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  expectPass(JSON.stringify(projection));

  expectFail(withPatch(projection, (body) => {
    body.mode = "unexpected";
  }), "mode");

  expectFail(withPatch(projection, (body) => {
    body.safetyFacts.productionWriteAttempted = true;
  }), "safetyFacts.productionWriteAttempted");

  expectFail(withPatch(projection, (body) => {
    body.safetyFacts.protectedPathWriteAttempted = true;
  }), "safetyFacts.protectedPathWriteAttempted");

  expectFail(withPatch(projection, (body) => {
    body.requiredFiles.missing = ["docs/development/operational-readiness.md"];
    body.status.controlPlane = "pass";
  }), "status.controlPlane");

  expectFail(withPatch(projection, (body) => {
    body.sourceSnapshot.protectedPathFingerprint.algorithm = "md5" as "sha256";
  }), "sourceSnapshot.protectedPathFingerprint.algorithm");

  expectFail(withPatch(projection, (body) => {
    body.sourceSnapshot.protectedPathFingerprint.scope = "wrong_scope" as "read_only_side_effect_guard_inputs";
  }), "sourceSnapshot.protectedPathFingerprint.scope");

  expectFail(withPatch(projection, (body) => {
    body.sourceSnapshot.protectedPathFingerprint.hash = "not-a-hash";
  }), "sourceSnapshot.protectedPathFingerprint.hash");

  expectFail(withPatch(projection, (body) => {
    body.sourceSnapshot.protectedPathFingerprint.paths = ["README.md"];
  }), "sourceSnapshot.protectedPathFingerprint.paths");

  expectFail(withPatch(projection, (body) => {
    body.sourceSnapshot.protectedPathFingerprint.paths = [
      ...body.sourceSnapshot.protectedPathFingerprint.paths,
      "README.md",
    ];
  }), "sourceSnapshot.protectedPathFingerprint.paths");

  expectFail(withPatch(projection, (body) => {
    body.sourceSnapshot.protectedPathFingerprint.doesNotProve = ["production health"];
  }), "sourceSnapshot.protectedPathFingerprint.doesNotProve");

  expectFail(withPatch(projection, (body) => {
    body.boundaryStops = body.boundaryStops.filter((stop) => stop.key !== "post_update_ops001");
  }), "boundaryStops");

  expectFail(withPatch(projection, (body) => {
    body.boundaryStops = body.boundaryStops.filter((stop) => stop.key !== "update_request_expected_before");
  }), "boundaryStops");

  expectFail(withPatch(projection, (body) => {
    const stop = body.boundaryStops.find((item) => item.key === "update_request_expected_before");
    if (stop) stop.currentBoundary = ["no production deployment confirmation"];
  }), "boundaryStops[2].currentBoundary");

  expectFail(JSON.stringify({
    ...projection,
    fakeSecret: "DATABASE_URL=postgresql://user:pass@localhost:5432/areaforge",
  }), "record");

  console.log("PASS operability status validator selftest");
}

function withPatch(
  projection: OperabilityStatusProjection,
  patch: (body: MutableProjection) => void,
): string {
  const cloned = JSON.parse(JSON.stringify(projection)) as MutableProjection;
  patch(cloned);
  return JSON.stringify(cloned);
}

function expectPass(raw: string): void {
  const issues = validateOperabilityStatus(raw);
  if (issues.length > 0) {
    throw new Error(`expected pass, got ${issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
  }
}

function expectFail(raw: string, field: string): void {
  const issues = validateOperabilityStatus(raw);
  if (!issues.some((issue) => issue.field === field)) {
    throw new Error(`expected failure on ${field}, got ${issues.map((issue) => issue.field).join(", ") || "no issues"}`);
  }
}

type MutableProjection = OperabilityStatusProjection & {
  mode: string;
  safetyFacts: OperabilityStatusProjection["safetyFacts"] & {
    productionWriteAttempted: boolean;
    protectedPathWriteAttempted: boolean;
  };
  requiredFiles: OperabilityStatusProjection["requiredFiles"];
  status: OperabilityStatusProjection["status"];
  sourceSnapshot: OperabilityStatusProjection["sourceSnapshot"];
  boundaryStops: OperabilityStatusProjection["boundaryStops"];
};

main();
