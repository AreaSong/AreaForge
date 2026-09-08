import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const settingsRoot = path.dirname(fileURLToPath(import.meta.url));

test("settings runtime facts come from the update-center snapshot instead of stale literals", async () => {
  const [page, grid, runtime] = await Promise.all([
    readFile(path.join(settingsRoot, "../../app/(app)/settings/page.tsx"), "utf8"),
    readFile(path.join(settingsRoot, "settings-compact-grid.tsx"), "utf8"),
    readFile(path.join(settingsRoot, "settings-runtime-card.tsx"), "utf8"),
  ]);

  assert.match(page, /getUpdateCenterStatus\(\)/);
  assert.match(page, /currentVersion=\{updateStatus\.currentVersion\}/);
  assert.match(page, /<SettingsRuntimeCard status=\{updateStatus\}/);
  assert.match(grid, /currentVersion/);
  assert.match(runtime, /status\.deployMode/);
  assert.match(runtime, /status\.autoApply/);
  assert.match(runtime, /status\.signatureRequired/);
  assert.match(runtime, /当前未要求/);
  assert.doesNotMatch(`${grid}\n${runtime}`, /v1\.1\.2|5df3841/);
});
