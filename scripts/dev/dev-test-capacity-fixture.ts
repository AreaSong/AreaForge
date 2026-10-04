import path from "node:path";
import { createHash } from "node:crypto";
import { loadCapacityFixture, capacityFixtureEnvironment, CAPACITY_FIXTURE_LIMITS } from "../quality/capacity-fixture";
import type { DevTestExportFixture } from "./dev-test-export-fixture";

export function loadDevTestCapacityFixture(repository: string, env: NodeJS.ProcessEnv): DevTestExportFixture | undefined {
  const root = env.AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT;
  if (!root) return undefined;
  try {
    if (env.AREAFORGE_CAPACITY_ISOLATED_DB !== "1" || env.AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT) throw new Error();
    const fixture = loadCapacityFixture(root, repository); const expected = capacityFixtureEnvironment(fixture).DATABASE_URL;
    if (!expected || env.AREAFORGE_DEV_TEST_DATABASE_URL !== expected) throw new Error();
    const id = createHash("sha256").update(JSON.stringify({ root, scopeId: fixture.scopeId, policy: CAPACITY_FIXTURE_LIMITS,
      password: fixture.password, sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret })).digest("hex");
    return { kind: "CAPACITY", id, root, databaseUrl: expected, uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports"),
      operatorEmail: fixture.operatorEmail, ownerUid: fixture.ownerUid, ownerGid: fixture.ownerGid,
      sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret };
  } catch { throw new Error("CAPACITY_TEST_FIXTURE_INVALID"); }
}
