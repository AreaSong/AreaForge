import path from "node:path";
import { createHash } from "node:crypto";
import { loadOperationFixture, operationFixtureEnvironment } from "../quality/controlled-operation-fixture";
import type { DevTestExportFixture } from "./dev-test-export-fixture";

export function loadDevTestOpsFixture(repository: string, env: NodeJS.ProcessEnv): DevTestExportFixture | undefined {
  const root = env.AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT;
  if (!root) return undefined;
  try {
    if (env.AREAFORGE_OPS_ISOLATED_DB !== "1" || env.AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT
      || env.AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT || env.AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT) throw new Error();
    const fixture = loadOperationFixture(root, repository); const expected = operationFixtureEnvironment(fixture).DATABASE_URL;
    if (!expected || env.AREAFORGE_DEV_TEST_DATABASE_URL !== expected || fixture.ownerUid === 0) throw new Error();
    const id = createHash("sha256").update(JSON.stringify({ root, scopeId: fixture.scopeId, sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret })).digest("hex");
    return { kind: "OPS", id, root, databaseUrl: expected,
      uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports"), operationContextRoot: path.join(root, "context"),
      operatorEmail: fixture.operatorEmail, operationScopeId: fixture.scopeId, ownerUid: fixture.ownerUid, ownerGid: fixture.ownerGid,
      sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret };
  } catch { throw new Error("OPS_TEST_FIXTURE_INVALID"); }
}
