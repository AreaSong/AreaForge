import {
  buildOperationalHandoff,
  type OperationalHandoff,
} from "../ops/operational-handoff";
import { validateOperationalHandoff } from "./operational-handoff-validate";

function main(): void {
  const handoff = buildOperationalHandoff({
    asOf: "2026-07-12",
    generatedAt: "2026-07-12T00:00:00.000Z",
  });
  expectPass(JSON.stringify(handoff));

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

function expectPass(raw: string): void {
  const issues = validateOperationalHandoff(raw);
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
