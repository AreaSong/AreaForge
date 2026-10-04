import { readFileSync } from "node:fs";
import path from "node:path";
import { computeAttachmentCrashWindowHash, validateAttachmentCrashWindow } from "./attachment-crash-window-validate";

const fixturePath = path.join(process.cwd(), "scripts/quality/fixtures/attachment-crash-window/ops007-preconfirmation.json");
const valid = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

expectPass(valid, "checked-in fixture");
expectFail(rehash({ ...valid, action: "delete" }), "report-only action", "action");
expectFail({ ...valid, fixtureHash: `sha256:${"0".repeat(64)}` }, "tampered hash");
expectFail(rehash({ ...valid, cases: asCases(valid).slice(1) }), "missing required case", "cases");
expectFail(rehash({ ...valid, cases: asCases(valid).map((item) => item.name === "final-before-ready" ? { ...item, metadataState: "ready" } : item) }), "invalid transition", "cases.final-before-ready.metadataState");
expectFail(rehash({ ...valid, cases: asCases(valid).map((item) => item.name === "compensation-failure" ? { ...item, fileDeleted: true } : item) }), "fixture deletion", "cases[4].fileDeleted");
expectFail(rehash({ ...valid, safetyFacts: { ...(valid.safetyFacts as Record<string, unknown>), readOnly: false } }), "read-only declaration", "safetyFacts.readOnly");
expectFail(rehash({ ...valid, safetyFacts: { ...(valid.safetyFacts as Record<string, unknown>), productionWriteAttempted: true } }), "production write declaration", "safetyFacts.productionWriteAttempted");
expectFail(rehash({ ...valid, cases: asCases(valid).map((item) => item.name === "final-before-ready" ? { ...item, phase: "unknown" } : item) }), "unknown phase", "cases.final-before-ready.phase");
expectFail({ ...valid, unexpected: true }, "unknown top-level key", "record");
expectFail(rehash({ ...valid, doesNotProve: [...asStrings(valid.doesNotProve), "/etc/areaforge/private"] }), "sensitive absolute path", "record");
console.log("PASS attachment crash-window validator selftest");

function expectPass(value: Record<string, unknown>, label: string): void {
  const issues = validateAttachmentCrashWindow(JSON.stringify(value));
  if (issues.length !== 0) throw new Error(`${label} should pass: ${JSON.stringify(issues)}`);
}

function expectFail(value: Record<string, unknown>, label: string, field = "fixtureHash"): void {
  const issues = validateAttachmentCrashWindow(JSON.stringify(value));
  if (!issues.some((issue) => issue.field === field)) throw new Error(`${label} should fail at ${field}: ${JSON.stringify(issues)}`);
}

function rehash(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value, fixtureHash: computeAttachmentCrashWindowHash(value) };
}

function asCases(value: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(value.cases)) throw new Error("fixture cases missing");
  return value.cases as Array<Record<string, unknown>>;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("fixture string array missing");
  return value as string[];
}
