import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";
import { claimDatabaseDeletion, type DataDeleteLease } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion } from "../workers/data-delete-worker";
import { createFixtureDeletion, makeDeletionEligible, seedDeletionCase } from "./data-delete-runtime-data";
import { deleteFixtureEnvironment, type DataDeleteFixture } from "./data-delete-fixture";

export async function testDeleteProcessRecovery(client: PrismaClient, fixture: DataDeleteFixture) {
  for (const point of ["afterIntent", "afterFileIntent", "afterUnlink", "afterSql", "beforeCommit"]) {
    const data = await seedDeletionCase(client, fixture);
    const intent = await createFixtureDeletion(client, data); await makeDeletionEligible(client, intent.id);
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./data-delete-runtime-child.ts", import.meta.url))], {
      stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...deleteFixtureEnvironment(fixture), AREAFORGE_DELETE_FIXTURE_INTENT: intent.id,
        AREAFORGE_DELETE_FIXTURE_CRASH: point } });
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    let oldLease: DataDeleteLease;
    try {
      oldLease = await waitForPoint(child, point);
      assert.equal(await client.dataDeletionLedger.count({ where: { intentId: intent.id } }), 0);
      assert.ok(await client.note.findUnique({ where: { id: data.note.id } }), "uncommitted SQL must remain invisible");
    } finally { child.kill("SIGKILL"); await exited; }
    await client.dataDeletionIntent.update({ where: { id: intent.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
    const lease = await claimDatabaseDeletion(client, "restarted-delete", intent.id); assert.ok(lease);
    assert.ok(lease.version > oldLease!.version);
    assert.equal((await executeDatabaseDeletion(client, oldLease!, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") })).state, "LEASE_LOST");
    assert.equal((await executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") })).state, "SUCCEEDED");
    assert.equal(await client.note.findUnique({ where: { id: data.note.id } }), null);
    await assert.rejects(() => access(path.join(fixture.root, "uploads", data.storedName)));
    assert.equal(await client.dataDeletionLedger.count({ where: { intentId: intent.id } }), 1);
    console.log("PASS DELETE SIGKILL " + point + ": fenced generation, file recovery, SQL/ledger atomicity");
  }
}

function waitForPoint(child: ChildProcess, expected: string): Promise<DataDeleteLease> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, lease?: DataDeleteLease) => { clearTimeout(timer); child.off("message", message); child.off("exit", exited);
      if (error) reject(error); else resolve(lease!); };
    const message = (value: unknown) => {
      if (!value || typeof value !== "object" || !("point" in value)) return;
      if (value.point === expected && "lease" in value) finish(undefined, value.lease as DataDeleteLease);
      else finish(new Error("DATA_DELETE_KILL_POINT_NOT_REACHED"));
    };
    const exited = () => finish(new Error("DATA_DELETE_CHILD_EXITED"));
    const timer = setTimeout(() => finish(new Error("DATA_DELETE_KILL_POINT_TIMEOUT")), 30_000);
    child.on("message", message); child.once("exit", exited);
  });
}
