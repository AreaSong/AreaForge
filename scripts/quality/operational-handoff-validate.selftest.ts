import {
  buildOperationalHandoff,
  type OperationalHandoff,
} from "../ops/operational-handoff";
import { operationalHandoffBindingStatus, validateOperationalHandoff } from "./operational-handoff-validate";

function main(): void {
  const handoff = buildOperationalHandoff({
    asOf: "2026-07-12",
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  expectPass(JSON.stringify(handoff));
  if (operationalHandoffBindingStatus(JSON.stringify(handoff)) !== "current") {
    throw new Error("fresh handoff should bind to current checkout");
  }

  const staleBinding = withPatch(handoff, (body) => {
    body.source.controlPlaneSourceHash = "f".repeat(64);
    body.source.protectedPathFingerprint.hash = "e".repeat(64);
  });
  expectFail(staleBinding, "source.controlPlaneSourceHash.currentBinding");
  expectPass(staleBinding, { bindingMode: "shape-only" });
  if (operationalHandoffBindingStatus(staleBinding) !== "stale") {
    throw new Error("stale handoff should report stale binding");
  }
  if (operationalHandoffBindingStatus(staleBinding, { bindingMode: "shape-only" }) !== "unavailable") {
    throw new Error("shape-only validation should report unavailable binding");
  }

  expectFail(withPatch(handoff, (body) => {
    body.mode = "unexpected";
  }), "mode");

  expectFail(withPatch(handoff, (body) => {
    body.safetyFacts.handoffWritten = true;
  }), "safetyFacts.handoffWritten");

  expectFail(withPatch(handoff, (body) => {
    body.source.protectedPathFingerprint.hash = "not-a-hash";
  }), "source.protectedPathFingerprint.hash");

  expectFail(withPatch(handoff, (body) => {
    body.source.protectedPathFingerprint.paths = ["README.md"];
  }), "source.protectedPathFingerprint.paths");

  expectFail(withPatch(handoff, (body) => {
    body.source.protectedPathFingerprint.doesNotProve = ["production health"];
  }), "source.protectedPathFingerprint.doesNotProve");

  expectFail(withPatch(handoff, (body) => {
    body.nextCommands.liveEvidence = body.nextCommands.liveEvidence.filter((command) => command !== "pnpm ops:readiness:summary");
  }), "nextCommands.liveEvidence");

  expectFail(withPatch(handoff, (body) => {
    body.evidenceFocus.boundaryStops = body.evidenceFocus.boundaryStops.filter((stop) => stop.key !== "post_update_ops001");
  }), "evidenceFocus.boundaryStops");

  expectFail(withPatch(handoff, (body) => {
    body.evidenceFocus.boundaryStops = body.evidenceFocus.boundaryStops.filter((stop) => stop.key !== "update_request_expected_before");
  }), "evidenceFocus.boundaryStops");

  expectFail(withPatch(handoff, (body) => {
    const stop = body.evidenceFocus.boundaryStops.find((item) => item.key === "update_request_expected_before");
    if (stop) stop.currentBoundary = ["no production deployment confirmation"];
  }), "evidenceFocus.boundaryStops[2].currentBoundary");

  expectFail(JSON.stringify({
    ...handoff,
    fakeSecret: "AI_API_KEY=sk-fakefakefakefakefakefakefake",
  }), "record");

  console.log("PASS operational handoff validator selftest");
}

function withPatch(
  handoff: OperationalHandoff,
  patch: (body: MutableHandoff) => void,
): string {
  const cloned = JSON.parse(JSON.stringify(handoff)) as MutableHandoff;
  patch(cloned);
  return JSON.stringify(cloned);
}

function expectPass(raw: string, options: Parameters<typeof validateOperationalHandoff>[1] = {}): void {
  const issues = validateOperationalHandoff(raw, options);
  if (issues.length > 0) {
    throw new Error(`expected pass, got ${issues.map((issue) => `${issue.field}: ${issue.message}`).join("; ")}`);
  }
}

function expectFail(raw: string, field: string): void {
  const issues = validateOperationalHandoff(raw);
  if (!issues.some((issue) => issue.field === field)) {
    throw new Error(`expected failure on ${field}, got ${issues.map((issue) => issue.field).join(", ") || "no issues"}`);
  }
}

type MutableHandoff = OperationalHandoff & {
  mode: string;
  safetyFacts: OperationalHandoff["safetyFacts"] & {
    handoffWritten: boolean;
  };
  source: OperationalHandoff["source"];
  evidenceFocus: OperationalHandoff["evidenceFocus"];
};

main();
