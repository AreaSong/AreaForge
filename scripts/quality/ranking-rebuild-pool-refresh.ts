import { spawnSync } from "node:child_process";
import { loadRankingFixture, rankingFixtureEnvironment, assertRankingFixtureContainer } from "./ranking-rebuild-fixture";

try {
  const fixture = loadRankingFixture(process.argv[2] ?? ""); assertRankingFixtureContainer(fixture);
  if (process.argv[3] !== "3") throw new Error("RANKING_POOL_SLOT_REFUSED");
  const env = rankingFixtureEnvironment(fixture);
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", "3", "--note", "RANKING isolated acceptance", "--json"],
    { env: { ...env, AREAFORGE_DEV_TEST_RANKING_FIXTURE_ROOT: fixture.root, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("RANKING_TEST_POOL_REFUSED"); process.exitCode = 1; }
