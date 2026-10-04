import { spawnSync } from "node:child_process";
import { loadCapacityFixture, capacityFixtureEnvironment, assertCapacityFixtureContainer } from "./capacity-fixture";

try {
  const fixture = loadCapacityFixture(process.argv[2] ?? ""); assertCapacityFixtureContainer(fixture);
  if (process.argv[3] !== "3") throw new Error("CAPACITY_POOL_SLOT_REFUSED");
  const env = capacityFixtureEnvironment(fixture);
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", "3", "--note", "CAPACITY isolated admission acceptance", "--json"],
    { env: { ...env, AREAFORGE_DEV_TEST_CAPACITY_FIXTURE_ROOT: fixture.root, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("CAPACITY_TEST_POOL_REFUSED"); process.exitCode = 1; }
