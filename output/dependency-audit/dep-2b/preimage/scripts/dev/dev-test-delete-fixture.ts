import { createHash } from "node:crypto";
import path from "node:path";
import { loadDataDeleteFixture, deleteFixtureEnvironment } from "../quality/data-delete-fixture";
import type { DevTestExportFixture } from "./dev-test-export-fixture";

export function loadDevTestDeleteFixture(repository: string, env: NodeJS.ProcessEnv): DevTestExportFixture | undefined {
  const root = env.AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT;
  if (!root) return undefined;
  try {
    if (env.AREAFORGE_DATA_DELETE_ISOLATED_DB !== "1" || env.AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT) throw new Error();
    const fixture = loadDataDeleteFixture(root, repository);
    const expected = deleteFixtureEnvironment(fixture).DATABASE_URL;
    if (!expected || env.AREAFORGE_DEV_TEST_DATABASE_URL !== expected) throw new Error();
    return { kind: "DELETE", id: createHash("sha256").update(JSON.stringify({ root, databaseName: fixture.databaseName,
      uid: fixture.ownerUid, repository, sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret })).digest("hex"),
      root, databaseUrl: expected, uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports"),
      ownerUid: fixture.ownerUid, ownerGid: fixture.ownerGid, sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret };
  } catch { throw new Error("DATA_DELETE_TEST_FIXTURE_INVALID"); }
}
