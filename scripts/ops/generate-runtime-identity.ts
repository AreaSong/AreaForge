import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createStoredRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? "runtime-identity.json");
  const identity = createStoredRuntimeIdentity({
    appVersion: required("AREAFORGE_APP_VERSION"),
    gitCommit: required("AREAFORGE_GIT_COMMIT"),
    sourceFingerprintSchema: required("AREAFORGE_UX_SOURCE_FINGERPRINT_SCHEMA"),
    productExperienceSourceHash: required("AREAFORGE_UX_SOURCE_HASH"),
    buildId: required("AREAFORGE_BUILD_ID"),
    runtimeMode: "production-build",
  });
  await atomicWrite(output, identity);
  console.log(`runtime identity generated: ${output}`);
  console.log(`runtimeIdentityHash: ${identity.identityHash}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function atomicWrite(output: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o444);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
