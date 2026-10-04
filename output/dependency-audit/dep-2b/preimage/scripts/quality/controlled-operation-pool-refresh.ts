import { spawnSync } from "node:child_process";
import { loadOperationFixture, operationFixtureEnvironment, assertOperationFixtureContainer } from "./controlled-operation-fixture";
try {
  const fixture = loadOperationFixture(process.argv[2] ?? ""); assertOperationFixtureContainer(fixture);
  if (process.argv[3] !== "3") throw new Error("OPS_POOL_SLOT_REFUSED");
  const env = operationFixtureEnvironment(fixture);
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", "3", "--note", "OPS isolated acceptance", "--json"],
    { env: { ...env, AREAFORGE_DEV_TEST_OPS_FIXTURE_ROOT: fixture.root, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("OPS_TEST_POOL_REFUSED"); process.exitCode = 1; }
