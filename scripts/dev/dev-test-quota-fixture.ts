import path from "node:path";
import { createHash } from "node:crypto";
import { loadQuotaFixture, quotaFixtureEnvironment, QUOTA_FIXTURE_LIMITS } from "../quality/quota-fixture";
import type { DevTestExportFixture } from "./dev-test-export-fixture";

export function loadDevTestQuotaFixture(repository: string, env: NodeJS.ProcessEnv): DevTestExportFixture | undefined {
  const root = env.AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT;
  if (!root) return undefined;
  try {
    if (env.AREAFORGE_DATA_JOB_QUOTA_ISOLATED_DB !== "1" || env.AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT) throw new Error();
    const fixture = loadQuotaFixture(root, repository); const expected = quotaFixtureEnvironment(fixture).DATABASE_URL;
    if (!expected || env.AREAFORGE_DEV_TEST_DATABASE_URL !== expected) throw new Error();
    const id = createHash("sha256").update(JSON.stringify({ root, scopeId: fixture.scopeId, policy: QUOTA_FIXTURE_LIMITS,
      password: fixture.password, sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret })).digest("hex");
    return { kind: "QUOTA", id, root, databaseUrl: expected, uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports"),
      operatorEmail: fixture.operatorEmail, ownerUid: fixture.ownerUid, ownerGid: fixture.ownerGid,
      sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret };
  } catch { throw new Error("QUOTA_TEST_FIXTURE_INVALID"); }
}
