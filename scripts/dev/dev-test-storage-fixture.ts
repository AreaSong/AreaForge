import { createHash } from "node:crypto";
import path from "node:path";
import { loadStorageQuotaFixture, storageQuotaFixtureEnvironment } from "../quality/storage-quota-fixture";
import type { DevTestExportFixture } from "./dev-test-export-fixture";

export function loadDevTestStorageFixture(repository: string, env: NodeJS.ProcessEnv): DevTestExportFixture | undefined {
  const root = env.AREAFORGE_DEV_TEST_STORAGE_FIXTURE_ROOT;
  if (!root) return undefined;
  try {
    if (env.AREAFORGE_STORAGE_QUOTA_ISOLATED_DB !== "1") throw new Error();
    const fixture = loadStorageQuotaFixture(root, repository);
    const expected = storageQuotaFixtureEnvironment(fixture).DATABASE_URL!;
    if (env.AREAFORGE_DEV_TEST_DATABASE_URL !== expected) throw new Error();
    const policy = env.AREAFORGE_DEV_TEST_STORAGE_POLICY ?? "bounded";
    if (!["bounded", "invalid"].includes(policy)) throw new Error();
    return { kind: "STORAGE", id: createHash("sha256").update(JSON.stringify({ root, scopeId: fixture.scopeId,
      password: fixture.password, sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret })).digest("hex"),
      root, databaseUrl: expected, uploadRoot: path.join(root, "uploads"), exportRoot: path.join(root, "exports"),
      operatorEmail: fixture.operatorEmail, ownerUid: fixture.ownerUid, ownerGid: fixture.ownerGid,
      sessionSecret: fixture.sessionSecret, actionSecret: fixture.actionSecret, storagePolicy: policy as "bounded" | "invalid" };
  } catch { throw new Error("STORAGE_TEST_FIXTURE_INVALID"); }
}
