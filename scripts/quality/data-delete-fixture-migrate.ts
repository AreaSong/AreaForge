import { spawnSync } from "node:child_process";
import { loadDataDeleteFixture, deleteFixtureEnvironment } from "./data-delete-fixture";

try {
  const fixture = loadDataDeleteFixture(process.argv[2] ?? "");
  const result = spawnSync("pnpm", ["db:migrate:deploy"], { env: deleteFixtureEnvironment(fixture), stdio: "inherit" });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch { console.error("DATA_DELETE_FIXTURE_MIGRATION_REFUSED"); process.exitCode = 1; }
