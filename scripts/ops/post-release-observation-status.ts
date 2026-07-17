import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  observationDateStatus,
  parsePostReleaseObservation,
  validatePostReleaseObservation,
  type PostReleaseObservationRecord,
  type ValidationOptions,
} from "../quality/post-release-observation-validate";

type StatusOptions = ValidationOptions & { sourcePath?: string; asOf?: string };

export function buildPostReleaseObservationStatus(raw: string, options: StatusOptions = {}): Record<string, unknown> {
  const issues = validatePostReleaseObservation(raw, options);
  if (issues.length > 0) throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join("; "));
  const record = parsePostReleaseObservation(raw);
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  if (!isDateOnly(asOf)) throw new Error("asOf must be an exact YYYY-MM-DD date");

  return {
    schemaVersion: 1,
    mode: "read_only_post_release_observation_status",
    asOf,
    status: deriveStatus(record, asOf),
    source: {
      observationRecordPath: options.sourcePath ?? "in_memory",
      observationRecordSha256: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    },
    release: record.release,
    checkpoints: {
      d14: projectCheckpoint(record.checkpoints.d14, asOf),
      d30: projectCheckpoint(record.checkpoints.d30, asOf),
    },
    gate: record.gate,
    nextCheckpoint: nextCheckpoint(record),
    safetyFacts: {
      readOnly: true,
      networkRequested: false,
      fileWriteAttempted: false,
      productionWriteAttempted: false,
      residualLedgerUpdated: false,
    },
  };
}

export function deriveStatus(
  record: PostReleaseObservationRecord,
  asOf: string,
): "pending_observation" | "needs_attention" | "blocked" | "ready_for_human_review" {
  if (record.gate.status === "fail") return "blocked";
  if (record.gate.status === "pass") return "ready_for_human_review";
  const overduePending = (["d14", "d30"] as const).some((key) =>
    record.checkpoints[key].gate.status === "pending_observation" && record.checkpoints[key].dueDate < asOf
  );
  return overduePending ? "needs_attention" : "pending_observation";
}

function projectCheckpoint(
  checkpoint: Pick<PostReleaseObservationRecord["checkpoints"]["d14"], "dueDate" | "observedAt" | "gate">,
  asOf: string,
): Record<string, unknown> {
  return {
    dueDate: checkpoint.dueDate,
    dateStatus: observationDateStatus(checkpoint.dueDate, asOf),
    observedAt: checkpoint.observedAt,
    gate: checkpoint.gate,
  };
}

function nextCheckpoint(record: PostReleaseObservationRecord): "d14" | "d30" | "complete" {
  if (record.checkpoints.d14.gate.status === "pending_observation") return "d14";
  if (record.checkpoints.d30.gate.status === "pending_observation") return "d30";
  return "complete";
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function parseArgs(args: string[]): { file: string; asOf?: string; root?: string } {
  const asOfIndex = args.indexOf("--as-of");
  const asOf = asOfIndex >= 0 ? args[asOfIndex + 1] : undefined;
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const optionValueIndexes = new Set([asOfIndex + 1, rootIndex + 1].filter((index) => index > 0));
  const file = args.find((arg, index) => !arg.startsWith("--") && !optionValueIndexes.has(index));
  if (!file || (asOfIndex >= 0 && !asOf) || (rootIndex >= 0 && !root)) {
    throw new Error("Usage: pnpm release:post-observation:status <post-release-observation.json> [--as-of YYYY-MM-DD] [--root <repository-root>]");
  }
  return { file, asOf, root };
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const absolute = path.resolve(args.file);
    const raw = readFileSync(absolute, "utf8");
    const status = buildPostReleaseObservationStatus(raw, { root: args.root, sourcePath: args.file, asOf: args.asOf });
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } catch (error) {
    console.error(`FAIL post-release observation status: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
