import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const tempDir = mkdtempSync(path.join(tmpdir(), "areaforge-support-bundle-preview-"));

try {
  const previewPath = path.join(tempDir, "support-bundle-preview.json");
  const generated = spawnSync("pnpm", ["exec", "tsx", "scripts/ops/support-bundle-preview.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("generate support bundle preview", generated, 0);
  writeFileSync(previewPath, generated.stdout);

  const validation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", previewPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("validate support bundle preview", validation, 0);
  if (!validation.stdout.includes("supportBundlePreviewRecordHash: sha256:")) {
    fail("support bundle preview validation hash missing");
  }

  const parsed = JSON.parse(generated.stdout) as Record<string, unknown>;
  if (!Array.isArray(parsed.doesNotProve) || !parsed.doesNotProve.includes("updater apply completion")) {
    fail("support bundle preview non-proof boundary missing");
  }
  const unsafePath = path.join(tempDir, "support-bundle-preview-unsafe.json");
  writeFileSync(unsafePath, JSON.stringify({
    ...parsed,
    exportOpen: true,
    safetyFacts: {
      ...(parsed.safetyFacts as Record<string, unknown>),
      exportOpen: true,
      supportBundleExported: true,
    },
  }, null, 2));
  const unsafeValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", unsafePath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("unsafe support bundle preview fails", unsafeValidation, 1);

  const secretPath = path.join(tempDir, "support-bundle-preview-secret.json");
  writeFileSync(secretPath, `${generated.stdout}\nAI_API_KEY=sk-testsecretvalue1234567890`);
  const secretValidation = spawnSync("pnpm", ["exec", "tsx", "scripts/quality/support-bundle-preview-validate.ts", secretPath], {
    cwd: root,
    encoding: "utf8",
  });
  expectStatus("secret-bearing support bundle preview fails", secretValidation, 1);

  console.log("support bundle preview selftest passed.");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}

function expectStatus(label: string, result: ReturnType<typeof spawnSync>, expected: number): void {
  if (result.status !== expected) {
    console.error(`FAIL ${label}: expected exit ${expected}, got ${result.status}`);
    console.error(result.stdout.trim());
    console.error(result.stderr.trim());
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}
