import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { prisma, enqueueDataJob, type EnqueueDataJobInput, type DataQueueTransaction, type QueuedDataJob } from "../../packages/db/src/index";

export async function requireDataJobWorkerFixture(): Promise<void> {
  assert.equal(process.env.AREAFORGE_DATA_JOB_WORKER_ISOLATED_DB, "1", "requires explicit isolated fixture guard");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "requires loopback database");
  const database = url.pathname.slice(1);
  assert.match(database, /^areaforge_v20_worker_[a-z0-9_]+$/);
  const [row] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(row?.name, database);
}

export async function verifyDataJobWorkerMigrations(): Promise<number> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/migrations");
  const expected = readdirSync(root).filter((name) => /^\d+_/.test(name)).sort();
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; logs: string | null }>>`
    SELECT migration_name, checksum, finished_at, rolled_back_at, logs FROM "_prisma_migrations" ORDER BY migration_name
  `;
  assert.deepEqual(rows.map((row) => row.migration_name), expected);
  for (const row of rows) {
    assert.ok(row.finished_at);
    assert.equal(row.rolled_back_at, null);
    assert.ok(!row.logs);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(path.join(root, row.migration_name, "migration.sql"))).digest("hex"));
  }
  return rows.length;
}

export async function seedDataJobWorkerFixture() {
  const prefix = `v20w_${randomUUID().replaceAll("-", "")}`;
  const owner = await prisma.user.create({ data: { id: `${prefix}_owner`, email: `${prefix}@example.test`, passwordHash: "synthetic-not-a-password-hash" } });
  const other = await prisma.user.create({ data: { id: `${prefix}_other`, email: `${prefix}_other@example.test`, passwordHash: "synthetic-not-a-password-hash" } });
  const workspaces = await Promise.all(["a", "b"].map((key) => prisma.examWorkspace.create({ data: {
    id: `${prefix}_${key}`, userId: owner.id, stableKey: key, name: "worker fixture",
    memberships: { create: { userId: owner.id, role: "OWNER" } },
  } })));
  return { prefix, owner, other, workspaceA: workspaces[0]!, workspaceB: workspaces[1]! };
}

export type WorkerFixture = Awaited<ReturnType<typeof seedDataJobWorkerFixture>>;

export async function fixtureJob(fixture: WorkerFixture, label: string, overrides: Partial<EnqueueDataJobInput> = {}) {
  return enqueueDataJob(prisma, {
    kind: "NOTIFICATION", scope: "WORKSPACE", workspaceId: fixture.workspaceA.id, requestedByUserId: fixture.owner.id,
    idempotencyKey: `${fixture.prefix}_${label}`, requestFingerprint: createHash("sha256").update(label).digest("hex"),
    expiresAt: new Date(Date.now() + 3_600_000), ...overrides,
  });
}

export async function syntheticQueueEffect(tx: DataQueueTransaction, job: Readonly<QueuedDataJob>): Promise<void> {
  await tx.auditEvent.create({ data: {
    id: `effect_${job.id}`, actorId: job.requestedByUserId, action: "WORKER_SYNTHETIC_EFFECT", entityType: "DataJob", entityId: job.id,
  } });
}

export async function waitForFixture(predicate: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "fixture condition timed out");
    await delay(25);
  }
}

export async function makeFixtureLeaseStale(jobId: string): Promise<void> {
  await prisma.dataJob.update({ where: { id: jobId }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } });
}

export async function makeFixtureRetryDue(jobId: string): Promise<void> {
  await prisma.dataJob.update({ where: { id: jobId }, data: { nextAttemptAt: new Date(Date.now() - 1_000) } });
}
