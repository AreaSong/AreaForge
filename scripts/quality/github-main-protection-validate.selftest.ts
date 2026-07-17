import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSafeJsonFile, validateControlledPr, validateReadback } from "./github-main-protection-validate";

const now = Date.parse("2026-07-15T12:00:00.000Z");
const validReadback = withHash({ schemaVersion: 1, repository: "AreaSong/AreaForge", branch: "main", sourceKind: "combined", observedAt: "2026-07-15T11:00:00.000Z", maintenanceWindowId: "mw-sc004-20260715", requiredPullRequest: true, requiredApprovingReviewCount: 1, requiredStatusChecks: ["ci / verify"], enforceAdmins: true, allowForcePushes: false, allowDeletions: false, adminBypassActors: [], redaction: { secretsRemoved: true, tokenRemoved: true }, readbackHash: "" }, "readbackHash");
const validPr = withHash(controlledPrValue("mw-sc004-20260715"), "evidenceHash");

expectValid(validateReadback(JSON.stringify(validReadback), now), "valid readback");
expectValid(validateControlledPr(JSON.stringify(validPr), now), "valid readback + controlled PR");
expectInvalid({ ...validReadback, requiredStatusChecks: ["CI / verify"] }, "wrong check case");
expectInvalid({ ...validReadback, allowForcePushes: true }, "force push");
expectInvalid({ ...validReadback, adminBypassActors: ["RepositoryAdmin"] }, "admin bypass");
expectInvalid({ ...validReadback, observedAt: "2026-07-13T11:00:00.000Z" }, "stale");
expectInvalid({ ...validReadback, observedAt: "2026-07-15T13:00:00.000Z" }, "future");
expectInvalid({ ...validReadback, requiredStatusChecks: ["verify"] }, "verify alone");
expectInvalid({ ...validPr, maintenanceWindowId: "other-window" }, "window mismatch fixture");
if (validateReadback(JSON.stringify({ ...validReadback, readbackHash: "sha256:" + "0".repeat(64) }), now).valid) throw new Error("tampered hash should fail");
expectInvalid({ ...validReadback, observedAt: "2026-07-15T11:00:00.000Z", sourceKind: "combined-secret-sk-1234567890123456" }, "secret-like content");
expectInvalidPr({ ...validPr, failedRequiredCheck: "verify" }, "controlled PR verify alone");
expectInvalidPr({ ...validPr, prUrl: "https://github.com/AreaSong/AreaForge/pull/8", prNumber: 7 }, "PR URL number mismatch");
expectInvalidPr({ ...validPr, failedCheckConclusion: "success" }, "failed check must fail");
expectInvalidPr({ ...validPr, passingCheckRunUrl: "https://example.invalid/run/2" }, "foreign check run URL");
testSafePathGuard();
console.log("github main protection validator selftest passed.");

function expectValid(result: { valid: boolean; issues: unknown[] }, label: string): void { if (!result.valid) throw new Error(`${label} failed: ${JSON.stringify(result.issues)}`); }
function expectInvalid(value: Record<string, unknown>, label: string): void {
  const result = validateReadback(JSON.stringify(withHash(value, "readbackHash")), now);
  if (result.valid) throw new Error(`${label} should fail`);
}
function expectInvalidPr(value: Record<string, unknown>, label: string): void { if (validateControlledPr(JSON.stringify(withHash(value, "evidenceHash")), now).valid) throw new Error(`${label} should fail`); }
function testSafePathGuard(): void {
  const dir = mkdtempSync(path.join(tmpdir(), "areaforge-sc004-validator-"));
  try {
    const validPath = path.join(dir, "evidence.json");
    writeFileSync(validPath, "{}");
    readSafeJsonFile(validPath);
    const linkPath = path.join(dir, "link.json");
    symlinkSync(validPath, linkPath);
    expectRejected(linkPath, "symlink");
    const actualParent = path.join(dir, "actual-parent");
    const linkedParent = path.join(dir, "linked-parent");
    mkdirSync(actualParent);
    writeFileSync(path.join(actualParent, "parent-evidence.json"), "{}");
    symlinkSync(actualParent, linkedParent);
    expectRejected(path.join(linkedParent, "parent-evidence.json"), "parent symlink");
    expectRejected(path.join(dir, "secret-evidence.json"), "forbidden name");
    expectRejected("/etc/outside.json", "outside allowed roots");
    const largePath = path.join(dir, "large.json");
    writeFileSync(largePath, "x".repeat(2 * 1024 * 1024 + 1));
    expectRejected(largePath, "size");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function expectRejected(filePath: string, label: string): void { try { readSafeJsonFile(filePath); throw new Error(`${label} should fail`); } catch (error) { if (String(error).includes("should fail")) throw error; } }
function withHash(value: Record<string, unknown>, field: string): Record<string, unknown> {
  const withoutHash = { ...value, [field]: "" };
  return { ...value, [field]: `sha256:${createHash("sha256").update(stableStringify(withoutHash)).digest("hex")}` };
}
function controlledPrValue(maintenanceWindowId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    repository: "AreaSong/AreaForge",
    branch: "main",
    observedAt: "2026-07-15T11:30:00.000Z",
    maintenanceWindowId,
    prUrl: "https://github.com/AreaSong/AreaForge/pull/7",
    prNumber: 7,
    headSha: "1".repeat(40),
    failedRequiredCheck: "ci / verify",
    failedCheckConclusion: "failure",
    failedCheckRunUrl: "https://github.com/AreaSong/AreaForge/actions/runs/100/job/101",
    passingRequiredCheck: "ci / verify",
    passingCheckConclusion: "success",
    passingCheckRunUrl: "https://github.com/AreaSong/AreaForge/actions/runs/102/job/103",
    failureOutcome: "blocked",
    successOutcome: "allowed",
    prMerged: false,
    secretValuesPresent: false,
    evidenceHash: "",
  };
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`; }
  return JSON.stringify(value);
}
