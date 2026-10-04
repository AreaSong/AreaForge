import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { loadStorageQuotaFixture, assertStorageQuotaFixtureContainer, storageQuotaFixtureEnvironment, verifyStorageQuotaFixtureLedger } from "./storage-quota-fixture";

async function main() {
  const fixture = loadStorageQuotaFixture(process.argv[2] ?? "");
  const policy = process.argv[3] ?? "bounded";
  assert.ok(["bounded", "invalid"].includes(policy));
  assertStorageQuotaFixtureContainer(fixture);
  const env = storageQuotaFixtureEnvironment(fixture);
  Object.assign(process.env, env);
  const { prisma } = await import("../../packages/db/src/index");
  try { await verifyStorageQuotaFixtureLedger(prisma, fixture); } finally { await prisma.$disconnect(); }
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", "3", "--json",
    "--note", `STORAGE API/browser ${policy}`, ...(process.argv.includes("--dry-run") ? ["--dry-run"] : [])], {
    env: { ...env, GIT_OPTIONAL_LOCKS: "0", AREAFORGE_DEV_TEST_STORAGE_FIXTURE_ROOT: fixture.root,
      AREAFORGE_DEV_TEST_STORAGE_POLICY: policy, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
}
main().catch(() => { console.error("STORAGE_BROWSER_POOL_REFUSED"); process.exitCode = 1; });
