import { spawnSync } from "node:child_process";
import { loadQuotaFixture, quotaFixtureEnvironment, assertQuotaFixtureContainer } from "./quota-fixture";

try {
  const fixture = loadQuotaFixture(process.argv[2] ?? ""); assertQuotaFixtureContainer(fixture);
  if (process.argv[3] !== "3") throw new Error("QUOTA_POOL_SLOT_REFUSED");
  const env = quotaFixtureEnvironment(fixture);
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", "3", "--note", "QUOTA isolated admission acceptance", "--json"],
    { env: { ...env, AREAFORGE_DEV_TEST_QUOTA_FIXTURE_ROOT: fixture.root, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("QUOTA_TEST_POOL_REFUSED"); process.exitCode = 1; }
