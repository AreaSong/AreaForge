import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeUpdaterPhaseEventHash,
  computeUpdaterPhaseJournalHash,
  validateUpdaterPhaseJournal,
} from "./updater-phase-journal-validate";

const fixturePath = path.join(process.cwd(), "scripts/quality/fixtures/update-agent/phase-journal/ops008-preconfirmation.json");
const valid = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;

expectPass(valid, "checked-in phase journal");
expectFail(rehash({ ...valid, events: asEvents(valid).slice(0, 1) }), "incomplete pass chain", "events");
expectFail({ ...valid, journalHash: `sha256:${"0".repeat(64)}` }, "tampered journal hash", "journalHash");
expectFail({ ...valid, events: asEvents(valid).map((item, index) => index === 2 ? { ...item, previousEventHash: `sha256:${"f".repeat(64)}` } : item) }, "broken event chain", "events[2].previousEventHash");
expectFail({ ...valid, events: asEvents(valid).map((item, index) => index === 4 ? { ...item, eventHash: `sha256:${"e".repeat(64)}` } : item) }, "tampered event hash", "events[4].eventHash");
expectFail(rehash({ ...valid, events: asEvents(valid).map((item, index) => index === 0 ? { ...item, uncertainPhase: "migration" } : item) }), "uncertain phase on ordinary event", "events[0].uncertainPhase");
expectFail(rehash({ ...valid, events: asEvents(valid).map((item, index) => index === 3 ? { ...item, createdAt: asEvents(valid)[2].createdAt } : item) }), "non-monotonic event time", "events[3].createdAt");
expectPass(rehash({ ...valid, events: asEvents(valid).map((item, index) => index === 0 ? { ...item, sourceKind: "request", source: "web.update-request", requestId: "update_fixture_request", requestHash: `sha256:${"a".repeat(64)}` } : item) }), "request source with request identity");
expectFail(rehash({ ...valid, events: asEvents(valid).map((item, index) => index === 1 ? { ...item, sourceKind: "request", requestId: null, requestHash: null } : item) }), "request source without request identity", "events[1].requestId");
expectFail(rehash({ ...valid, events: asEvents(valid).map((item, index) => index === 1 ? { ...item, requestId: "update_fixture_request", requestHash: `sha256:${"a".repeat(64)}` } : item) }), "automatic source with request identity", "events[1]");

const mismatchedRelease = { ...(valid.release as Record<string, unknown>), tag: "v0.1.9" };
expectFail(rehash(withRelease(valid, mismatchedRelease)), "release identity mismatch", "release");
const wrongImageTag = {
  ...(valid.release as Record<string, unknown>),
  webImageDigest: `ghcr.io/areasong/areaforge-web:v9.9.9@sha256:${"b".repeat(64)}`,
};
expectFail(rehash(withRelease(valid, wrongImageTag)), "embedded image tag mismatch", "release.webImageDigest");
expectFail(rehash({ ...valid, doesNotProve: [...asStrings(valid.doesNotProve), "/opt/areaforge/private"] }), "sensitive path", "record");

const terminalStartedIndex = asEvents(valid).findIndex((item) => item.phase === "terminal" && item.state === "started");
const terminalReconciliation = reconciliationRecord(valid, asEvents(valid).slice(0, terminalStartedIndex + 1), "terminal");
expectPass(terminalReconciliation, "terminal persistence reconciliation prefix");

const migrationStarted = asEvents(valid).find((item) => item.phase === "migration" && item.state === "started");
if (!migrationStarted) throw new Error("migration started fixture missing");
expectFail(reconciliationRecord(valid, [migrationStarted], "migration"), "reconciliation missing validated/backup prefix", "events");

for (const name of [
  "ops008-migration-kill-point-reconciliation.json",
  "ops008-switch-kill-point-reconciliation.json",
  "ops008-terminal-kill-point-reconciliation.json",
]) {
  const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/quality/fixtures/update-agent/phase-journal", name), "utf8")) as Record<string, unknown>;
  expectPass(fixture, name);
  if (fixture.status !== "reconciliation_required") throw new Error(`${name} should be report-only reconciliation evidence`);
}

console.log("PASS updater phase journal validator selftest");

function expectPass(value: Record<string, unknown>, label: string): void {
  const issues = validateUpdaterPhaseJournal(JSON.stringify(value));
  if (issues.length !== 0) throw new Error(`${label} should pass: ${JSON.stringify(issues)}`);
}

function expectFail(value: Record<string, unknown>, label: string, field: string): void {
  const issues = validateUpdaterPhaseJournal(JSON.stringify(value));
  if (!issues.some((issue) => issue.field === field)) throw new Error(`${label} should fail at ${field}: ${JSON.stringify(issues)}`);
}

function reconciliationRecord(source: Record<string, unknown>, prefix: Array<Record<string, unknown>>, uncertainPhase: string): Record<string, unknown> {
  const last = prefix[prefix.length - 1];
  const events = [...prefix, {
    sequence: prefix.length + 1,
    operationId: source.operationId,
    release: source.release,
    phase: "reconciliation",
    state: "reconciliation_required",
    reasonCode: "FIXTURE_RECONCILIATION_REQUIRED",
    uncertainPhase,
    sourceKind: last.sourceKind,
    source: last.source,
    requestId: last.requestId,
    requestHash: last.requestHash,
    createdAt: nextTimestamp(last.createdAt),
    executionAttempted: false,
    previousEventHash: null,
    eventHash: "",
  }];
  return rehash({ ...source, status: "reconciliation_required", events });
}

function nextTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new Error("event createdAt missing");
  return new Date(Date.parse(value) + 1000).toISOString();
}

function withRelease(source: Record<string, unknown>, release: Record<string, unknown>): Record<string, unknown> {
  return { ...source, release, events: asEvents(source).map((event) => ({ ...event, release })) };
}

function rehash(value: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  let previous: string | null = null;
  clone.events = asEvents(clone).map((event, index) => {
    const next = { ...event, sequence: index + 1, previousEventHash: previous, eventHash: "" };
    next.eventHash = computeUpdaterPhaseEventHash(next);
    previous = next.eventHash;
    return next;
  });
  clone.journalHash = "";
  clone.journalHash = computeUpdaterPhaseJournalHash(clone);
  return clone;
}

function asEvents(value: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(value.events)) throw new Error("fixture events missing");
  return value.events as Array<Record<string, unknown>>;
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("fixture string array missing");
  return value as string[];
}
