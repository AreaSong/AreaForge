import { spawnSync } from "node:child_process";
import { loadSearchIndexFixture, searchIndexFixtureEnvironment, assertSearchIndexFixtureContainer } from "./search-index-fixture";

try {
  const fixture = loadSearchIndexFixture(process.argv[2] ?? ""); assertSearchIndexFixtureContainer(fixture);
  if (process.argv[3] !== "3") throw new Error("SEARCH_INDEX_POOL_SLOT_REFUSED");
  const env = searchIndexFixtureEnvironment(fixture);
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", "3", "--note", "SEARCH isolated acceptance", "--json"],
    { env: { ...env, AREAFORGE_DEV_TEST_SEARCH_FIXTURE_ROOT: fixture.root, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("SEARCH_INDEX_TEST_POOL_REFUSED"); process.exitCode = 1; }
