import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma, commitQueuedDataJob, recoverQueuedDataJobs } from "../../packages/db/src/index";
import { toDataJobLease } from "../../packages/db/src/data-job-queue-store";
import { exportFileName } from "../../packages/storage/src/index";
import { createDataExportMaintenance } from "../workers/data-export-maintenance";
import { makeFixtureLeaseStale, makeFixtureRetryDue, waitForFixture } from "./data-job-worker-runtime-fixture";
import { createFixtureExport, executeFixtureExport } from "./data-export-runtime-actions";
import { seedDataExportFixture } from "./data-export-runtime-fixture";

export async function exportProcessCrashRecovery() {
  for (const point of ["intent", "record", "sealed", "commit"] as const) await verifyCrashPoint(point);
}

async function verifyCrashPoint(point: "intent" | "record" | "sealed" | "commit") {
  const f = await seedDataExportFixture(); const job = await createFixtureExport(f, "WORKSPACE");
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./data-export-runtime-child.ts", import.meta.url))], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: {
      PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, TSX_TSCONFIG_PATH: process.env.TSX_TSCONFIG_PATH,
      AREAFORGE_DATA_EXPORT_ISOLATED_DB: "1", AREAFORGE_DATA_EXPORT_FIXTURE_ROOT: process.env.AREAFORGE_DATA_EXPORT_FIXTURE_ROOT,
      AREAFORGE_EXPORT_FIXTURE_REQUESTER: f.actor.id, AREAFORGE_EXPORT_FIXTURE_WORKSPACE: f.workspace.id,
      AREAFORGE_EXPORT_FIXTURE_CRASH: point,
    },
  });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  try {
    await waitForChild(child, point);
    assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 0, "uncommitted package must remain invisible");
  } finally { child.kill("SIGKILL"); await exited; }
  const abandoned = await prisma.dataJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(abandoned.status, "RUNNING");
  const oldLease = toDataJobLease(abandoned);
  const oldArtifact = await prisma.dataExportArtifact.findFirstOrThrow({ where: { jobId: job.id } });
  assert.equal(oldArtifact.state, "STAGING");
  assert.equal(await exists(path.join(f.roots.exportRoot, exportFileName(oldArtifact.objectKey, ".zip"))), point === "sealed" || point === "commit");
  await makeFixtureLeaseStale(job.id);
  await recoverQueuedDataJobs(prisma, { kinds: ["EXPORT"], partition: { requestedByUserId: f.actor.id, workspaceId: f.workspace.id } });
  assert.equal((await prisma.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "FAILED");
  await makeFixtureRetryDue(job.id);
  const successor = await executeFixtureExport(f, job.id);
  assert.equal(successor.result, "SUCCEEDED"); assert.equal(successor.row.attempt, 2);
  assert.ok(successor.row.leaseVersion > abandoned.leaseVersion);
  await assert.rejects(commitQueuedDataJob(prisma, { lease: oldLease, effect: async () => { assert.fail("old lease effect must never execute"); } }), /DATA_JOB_LEASE_LOST/);
  assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 1);
  const pkg = await prisma.dataExportPackage.findUniqueOrThrow({ where: { jobId: job.id } });
  assert.notEqual(pkg.sourceArtifactId, oldArtifact.id);
  const maintain = createDataExportMaintenance(prisma);
  await waitForFixture(async () => {
    await maintain(true);
    return (await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: oldArtifact.id } })).state === "RECLAIMED";
  });
  for (const suffix of [".zip", ".zip.part", ".central", ".manifest"] as const) {
    assert.equal(await exists(path.join(f.roots.exportRoot, exportFileName(oldArtifact.objectKey, suffix))), false);
  }
  assert.equal(await exists(path.join(f.roots.exportRoot, exportFileName(pkg.objectKey, ".zip"))), true);
  assert.deepEqual(await readFile(f.sourcePath), f.fileBytes);
}

export async function exportConfiguredWorkerCli() {
  const f = await seedDataExportFixture(); const job = await createFixtureExport(f, "WORKSPACE");
  const output = await runWorkerCli(["--once", `--workspace=${f.workspace.id}`], {
    DATA_JOB_WORKER_ENABLED: "true", DATA_LIFECYCLE_ENABLED: "true", DATA_EXPORT_ENABLED: "true",
    EXPORT_DIR: f.roots.exportRoot, UPLOAD_DIR: f.roots.uploadRoot, AI_ENABLED: "false",
    PLATFORM_NOTIFICATIONS_ENABLED: "false", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "false",
  });
  assert.match(output, /"result":"SUCCEEDED"/);
  assert.equal((await prisma.dataJob.findUniqueOrThrow({ where: { id: job.id } })).status, "SUCCEEDED");
  assert.equal(await prisma.dataExportPackage.count({ where: { jobId: job.id } }), 1);
}

export function runWorkerCli(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../workers/data-job-worker.ts", import.meta.url)), ...args], {
    stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH, DATABASE_URL: process.env.DATABASE_URL, ...env },
  });
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("EXPORT_CLI_TIMEOUT")); }, 30_000);
    child.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-65_536); });
    child.stderr.resume();
    child.once("error", () => { clearTimeout(timer); reject(new Error("EXPORT_CLI_SPAWN_FAILED")); });
    child.once("exit", code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error("EXPORT_CLI_FAILED")); });
  });
}

function waitForChild(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("EXPORT_CRASH_FIXTURE_TIMEOUT")), 20_000);
    const message = (value: unknown) => {
      if (value && typeof value === "object" && "state" in value) {
        if (value.state === expected) finish();
        else finish(new Error("EXPORT_CRASH_POINT_NOT_REACHED"));
      }
    };
    const exited = () => finish(new Error("EXPORT_CHILD_EXITED_EARLY"));
    const finish = (error?: Error) => {
      clearTimeout(timer); child.off("message", message); child.off("exit", exited); child.off("error", finish);
      if (error) reject(error); else resolve();
    };
    child.on("message", message); child.once("exit", exited); child.once("error", finish);
  });
}

async function exists(file: string) { return access(file).then(() => true, () => false); }
