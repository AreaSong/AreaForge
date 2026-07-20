import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeUpdaterMaintenanceControlHash,
  validateUpdaterMaintenanceControl,
} from "./updater-maintenance-control-validate";

const fixtureDir = path.join(process.cwd(), "scripts/quality/fixtures/update-agent/maintenance-control");
const drained = readFixture("ops008-hold-drain-preconfirmation.json");
const waiting = readFixture("ops008-hold-waiting-preconfirmation.json");
const lockWaiting = readFixture("ops008-hold-lock-waiting-preconfirmation.json");

expectPass(drained, "checked-in drained fixture");
expectPass(waiting, "checked-in waiting fixture");
expectPass(lockWaiting, "checked-in production-lock waiting fixture");
expectFail(rehash({ ...drained, hold: { ...(drained.hold as Record<string, unknown>), webCanWriteHold: true } }), "web hold write", "hold.webCanWriteHold");
expectFail(rehash({ ...drained, queue: { ...(drained.queue as Record<string, unknown>), newClaimsAllowed: true } }), "claim while held", "queue.newClaimsAllowed");
expectFail(rehash({ ...drained, claims: { ...(drained.claims as Record<string, unknown>), activeClaimState: "active" } }), "false drained state", "claims");
expectFail(rehash({ ...waiting, claims: { ...(waiting.claims as Record<string, unknown>), claimDeleted: true } }), "claim deletion", "claims.claimDeleted");
expectFail(rehash({ ...lockWaiting, claims: { ...(lockWaiting.claims as Record<string, unknown>), productionStateLockState: "free" } }), "false production-lock waiting state", "claims");
expectFail(rehash({ ...drained, doesNotProve: asStrings(drained.doesNotProve).filter((item) => item !== "hold and claim queue-control lock ordering or concurrent exclusion") }), "missing concurrency non-proof", "doesNotProve");
expectFail({ ...drained, recordHash: `sha256:${"0".repeat(64)}` }, "tampered hash", "recordHash");
console.log("PASS updater maintenance-control validator selftest");

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

function expectPass(value: Record<string, unknown>, label: string): void {
  const issues = validateUpdaterMaintenanceControl(JSON.stringify(value));
  if (issues.length !== 0) throw new Error(`${label} should pass: ${JSON.stringify(issues)}`);
}

function expectFail(value: Record<string, unknown>, label: string, field: string): void {
  const issues = validateUpdaterMaintenanceControl(JSON.stringify(value));
  if (!issues.some((issue) => issue.field === field)) throw new Error(`${label} should fail at ${field}: ${JSON.stringify(issues)}`);
}

function rehash(value: Record<string, unknown>): Record<string, unknown> {
  const next = { ...value, recordHash: "" };
  return { ...next, recordHash: computeUpdaterMaintenanceControlHash(next) };
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("fixture string array missing");
  return value as string[];
}
