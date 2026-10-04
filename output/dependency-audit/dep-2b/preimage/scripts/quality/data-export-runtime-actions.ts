import assert from "node:assert/strict";
import { prisma, claimQueuedDataJob } from "../../packages/db/src/index";
import { requestDataLifecycleJob } from "../../apps/web/lib/system/data-lifecycle-service";
import { createDataExportHandler } from "../workers/data-export-handler";
import { executeDataJob } from "../workers/data-job-execution";
import type { DataJobHandler } from "../workers/data-job-handler";
import type { ExportFixture } from "./data-export-runtime-fixture";
import { createDataExportMaintenance } from "../workers/data-export-maintenance";
import { waitForFixture } from "./data-job-worker-runtime-fixture";

export async function createFixtureExport(fixture: ExportFixture, scope: "ACCOUNT" | "WORKSPACE" = "ACCOUNT", label: string = scope) {
  return requestDataLifecycleJob(fixture.actor, { kind: "EXPORT", scope, workspaceId: scope === "WORKSPACE" ? fixture.workspace.id : undefined, idempotencyKey: `${fixture.prefix}-${label}` });
}
export async function executeFixtureExport(fixture: ExportFixture, jobId: string, handler: DataJobHandler = createDataExportHandler(prisma)) {
  const job = await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } });
  const lease = await claimQueuedDataJob(prisma, { workerId: "export-fixture-worker", kinds: ["EXPORT"], leaseMs: 30_000,
    partition: { requestedByUserId: fixture.actor.id, workspaceId: job.workspaceId } });
  assert.equal(lease?.jobId, jobId, "fixture must claim exactly its own job");
  const result = await executeDataJob({ client: prisma, lease: lease!, leaseMs: 30_000, signal: new AbortController().signal, handler });
  return { result, row: await prisma.dataJob.findUniqueOrThrow({ where: { id: jobId } }), lease: lease! };
}
export async function runFixtureExport(fixture: ExportFixture, scope: "ACCOUNT" | "WORKSPACE" = "ACCOUNT") {
  const job = await createFixtureExport(fixture, scope);
  const result = await executeFixtureExport(fixture, job.id);
  assert.equal(result.row.status, "SUCCEEDED", `worker outcome ${result.result} / ${result.row.errorCode}`);
  return result.row;
}

export async function reclaimFixtureArtifact(artifactId: string) {
  const maintain = createDataExportMaintenance(prisma);
  await waitForFixture(async () => {
    await maintain(true);
    return (await prisma.dataExportArtifact.findUniqueOrThrow({ where: { id: artifactId } })).state === "RECLAIMED";
  }, 15_000);
}
