import { createPrismaClient } from "../../packages/db/src/index";
import { claimDatabaseDeletion } from "../../packages/db/src/data-delete-lease";
import { executeDatabaseDeletion, type DataDeleteHooks } from "../workers/data-delete-worker";
import { loadDataDeleteFixture, deleteFixtureEnvironment } from "./data-delete-fixture";
import path from "node:path";

const fixture = loadDataDeleteFixture(process.env.AREAFORGE_DATA_DELETE_FIXTURE_ROOT ?? "");
const client = createPrismaClient(deleteFixtureEnvironment(fixture).DATABASE_URL);
try {
  const id = process.env.AREAFORGE_DELETE_FIXTURE_INTENT;
  const point = process.env.AREAFORGE_DELETE_FIXTURE_CRASH as keyof DataDeleteHooks;
  if (!id || !["afterIntent", "afterFileIntent", "afterUnlink", "afterSql", "beforeCommit"].includes(point)) throw new Error("DELETE_CHILD_INPUT_INVALID");
  const lease = await claimDatabaseDeletion(client, "delete-child-" + process.pid, id);
  if (!lease) throw new Error("DELETE_CHILD_LEASE_MISSING");
  const hooks: DataDeleteHooks = { [point]: async () => { process.send?.({ point, lease }); await new Promise(() => undefined); } };
  const result = await executeDatabaseDeletion(client, lease, { uploadRoot: path.join(fixture.root, "uploads"), exportRoot: path.join(fixture.root, "exports") }, hooks);
  process.send?.({ point: "NOT_REACHED", state: result.state });
} catch { process.send?.({ point: "FAILED" }); process.exitCode = 1; }
finally { await client.$disconnect(); }
