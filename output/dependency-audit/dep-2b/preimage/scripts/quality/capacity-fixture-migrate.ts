import { spawnSync } from "node:child_process";
import { loadCapacityFixture, assertCapacityFixtureContainer, capacityFixtureEnvironment } from "./capacity-fixture";
import { assertCapacityMigrationPreimage } from "./capacity-migration-preimage";

try {
  const fixture = loadCapacityFixture(process.argv[2] ?? ""); assertCapacityFixtureContainer(fixture);
  assertCapacityMigrationPreimage();
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: capacityFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("CAPACITY_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
