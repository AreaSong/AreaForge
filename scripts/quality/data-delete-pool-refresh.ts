import { spawnSync } from "node:child_process";
import { loadDataDeleteFixture, deleteFixtureEnvironment } from "./data-delete-fixture";
try {
  const fixture = loadDataDeleteFixture(process.argv[2] ?? "");
  const env = deleteFixtureEnvironment(fixture);
  const slot = process.argv[3];
  if (!slot || !/^[123]$/.test(slot)) throw new Error();
  const result = spawnSync("pnpm", ["dev:test:refresh", "--", "--slot", slot, "--note", "DATA-DELETE isolated acceptance", "--json"],
    { env: { ...env, AREAFORGE_DEV_TEST_DELETE_FIXTURE_ROOT: fixture.root, AREAFORGE_DEV_TEST_DATABASE_URL: env.DATABASE_URL,
      AREAFORGE_DEV_TEST_EXPORT_FIXTURE_ROOT: "", AREAFORGE_DATA_EXPORT_ISOLATED_DB: "" }, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("DATA_DELETE_TEST_POOL_REFUSED"); process.exitCode = 1; }
