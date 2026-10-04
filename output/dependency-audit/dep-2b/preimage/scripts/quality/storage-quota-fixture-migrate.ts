import { spawnSync } from "node:child_process";
import { loadStorageQuotaFixture, assertStorageQuotaFixtureContainer, storageQuotaFixtureEnvironment } from "./storage-quota-fixture";
import { assertStorageQuotaMigrationPreimage } from "./storage-quota-migration-preimage";

try {
  const fixture = loadStorageQuotaFixture(process.argv[2] ?? ""); assertStorageQuotaFixtureContainer(fixture);
  assertStorageQuotaMigrationPreimage();
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: storageQuotaFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("STORAGE_QUOTA_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
