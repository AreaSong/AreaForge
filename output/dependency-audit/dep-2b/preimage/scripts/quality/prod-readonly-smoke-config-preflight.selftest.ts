import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-prod-readonly-smoke-config-"));

try {
  const passwordFile = path.join(tempDir, "smoke-password");
  writeFileSync(passwordFile, "secret-password\n");
  chmodSync(passwordFile, 0o600);

  const valid = run({
    AREAFORGE_EXTRA_SMOKE_COMMAND: "cd /opt/areaforge && pnpm smoke:prod-readonly",
    AREAFORGE_SMOKE_BASE_URL: "https://forge.areasong.top",
    AREAFORGE_SMOKE_EMAIL: "smoke@example.com",
    AREAFORGE_SMOKE_PASSWORD_FILE: passwordFile,
    AREAFORGE_SMOKE_EXPECTED_VERSION: "0.1.5",
    AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY: "none",
  });
  if (valid.status !== 0 || !valid.stdout.includes("production readonly smoke config preflight passed.")) {
    console.error("FAIL valid smoke config should pass");
    console.error(valid.stdout.trim());
    console.error(valid.stderr.trim());
    process.exit(1);
  }
  if (valid.stdout.includes("secret-password") || valid.stdout.includes(passwordFile)) {
    console.error("FAIL valid smoke config output leaked secret or path");
    console.error(valid.stdout.trim());
    process.exit(1);
  }

  const envPassword = run({
    AREAFORGE_EXTRA_SMOKE_COMMAND: "cd /opt/areaforge && pnpm smoke:prod-readonly",
    AREAFORGE_SMOKE_BASE_URL: "https://forge.areasong.top",
    AREAFORGE_SMOKE_EMAIL: "smoke@example.com",
    AREAFORGE_SMOKE_PASSWORD: "secret-password",
    AREAFORGE_SMOKE_EXPECTED_VERSION: "0.1.5",
    AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY: "none",
  });
  if (envPassword.status === 0 || !envPassword.stderr.includes("production readonly smoke config preflight failed")) {
    console.error("FAIL env password smoke config should fail");
    console.error(envPassword.stdout.trim());
    console.error(envPassword.stderr.trim());
    process.exit(1);
  }

  const httpUrl = run({
    AREAFORGE_EXTRA_SMOKE_COMMAND: "cd /opt/areaforge && pnpm smoke:prod-readonly",
    AREAFORGE_SMOKE_BASE_URL: "http://forge.areasong.top",
    AREAFORGE_SMOKE_EMAIL: "smoke@example.com",
    AREAFORGE_SMOKE_PASSWORD_FILE: passwordFile,
    AREAFORGE_SMOKE_EXPECTED_VERSION: "0.1.5",
    AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY: "none",
  });
  if (httpUrl.status === 0 || !httpUrl.stdout.includes("FAIL base URL")) {
    console.error("FAIL http base URL smoke config should fail");
    console.error(httpUrl.stdout.trim());
    console.error(httpUrl.stderr.trim());
    process.exit(1);
  }

  console.log("production readonly smoke config preflight selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function run(env: NodeJS.ProcessEnv) {
  return spawnSync("pnpm", ["exec", "tsx", "scripts/quality/prod-readonly-smoke-config-preflight.ts"], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    },
  });
}
