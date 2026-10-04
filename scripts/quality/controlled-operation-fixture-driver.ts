import { generateKeyPairSync, sign, verify, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { rename, open } from "node:fs/promises";
import path from "node:path";
import { operationContextHash, operationHash, parseOperationContext, type OperationClaim, type OperationExecutionContext } from "../../packages/db/src/index";
import type { RootOperationDriver } from "../../ops/controlled-operation-agent/engine";
import { validateRootDispatchReceipt } from "../../ops/controlled-operation-agent/result";
import { ensureRootDirectory, readRootJson, writeRootJson, syncRootDirectory, type RootOperationPhase } from "../../ops/controlled-operation-agent/journal";
import { operationToolEnvironment, type ControlledOperationFixture } from "./controlled-operation-fixture";

const require = createRequire(import.meta.url);
export async function prepareOperationCase(fixture: ControlledOperationFixture, name: string) {
  if (!/^[a-z0-9-]{1,70}$/.test(name)) throw new Error("OPS_FIXTURE_CASE_INVALID");
  const root = path.join(fixture.root, "agent", name);
  await ensureRootDirectory(root); await ensureRootDirectory(path.join(root, "synthetic-effects"));
  const imageHash = createHash("sha256").update(`synthetic-${name}`).digest("hex");
  const manifest = { version: "9.9.1", webImageDigest: `ghcr.io/areasong/areaforge-web:v9.9.1@sha256:${imageHash}`, migrationImageDigest: `ghcr.io/areasong/areaforge-migration:v9.9.1@sha256:${imageHash}`, fixture: true };
  const manifestBytes = JSON.stringify(manifest); const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await writeRootJson(root, "synthetic-release.json", { manifest: manifestBytes, publicKey: publicKey.export({ type: "spki", format: "pem" }), signature: sign(null, Buffer.from(manifestBytes), privateKey).toString("base64") });
  const context: OperationExecutionContext = {
    schemaVersion: 1, environment: "local_fixture", scopeId: fixture.scopeId, observedAt: new Date().toISOString(), snapshotHash: "",
    expectedBefore: { currentVersion: "9.9.0", currentImage: `ghcr.io/areasong/areaforge-web:v9.9.0@sha256:${imageHash}`,
      autoApply: "none", signatureRequired: true, rollbackAvailable: true, rollbackTargetVersion: "9.8.9",
      rollbackTargetImage: `ghcr.io/areasong/areaforge-web:v9.8.9@sha256:${imageHash}`, rollbackSourceRecordSha256: operationHash({ fixture: name, rollback: true }) },
    target: { releaseId: 1, manifestSha256: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`, manifestVersion: "9.9.1", webImageDigest: manifest.webImageDigest },
  };
  context.snapshotHash = operationContextHash(context);
  await writeRootJson(root, "live-context.json", context);
  await publishOperationFixtureContext(fixture, context);
  return { root, context, name };
}

/** 可变 Web 投影使用原子替换；不可变执行绑定与 journal 不走此函数。 */
export async function publishOperationFixtureContext(fixture: ControlledOperationFixture, context: OperationExecutionContext) {
  const directory = path.join(fixture.root, "context"); const temporary = path.join(directory, `context-${Date.now()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(context)); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path.join(directory, "execution-context.json")); await syncRootDirectory(directory);
}
export class OperationFixtureDriver implements RootOperationDriver {
  readonly environment = "local_fixture" as const;
  constructor(private readonly root: string, private readonly effectDelayMs = 0, private readonly rejectExecution = false) {}
  async observe() {
    const context = parseOperationContext(await readRootJson(path.join(this.root, "live-context.json")));
    if (!context || context.environment !== "local_fixture") throw new Error("OPS_FIXTURE_CONTEXT_INVALID");
    return context;
  }
  phases(claim: OperationClaim): RootOperationPhase[] {
    switch (claim.operation.parameters.operation) {
      case "APPLY_RELEASE": return ["validation", "backup", "prepare", "migration", "switch", "health", "smoke"];
      case "ROLLBACK_RELEASE": return ["validation", "rollback", "health", "smoke"];
      case "CHECK_RELEASE": return ["validation", "check"];
      case "BACKUP_PREVIEW": return ["validation", "preview"];
      case "DIAGNOSTIC_HEALTH": return ["validation", "health"];
      case "MAINTENANCE_HOLD": return ["validation", "maintenance"];
    }
  }
  async execute(phase: RootOperationPhase, claim: OperationClaim): Promise<string> {
    if (phase === "validation" || phase === "check") return this.verifyRelease(claim);
    if (["preview", "health", "smoke"].includes(phase)) return operationHash({ environment: "local_fixture", phase, scopeId: claim.operation.execution.context.scopeId, metadataOnly: true });
    if (this.rejectExecution) return validateRootDispatchReceipt({ outcome: "REJECTED", executionAttempted: false, requestHash: claim.request.requestHash,
      evidenceHash: operationHash({ mode: "local_fixture", reason: "SYNTHETIC_LOCK_BUSY" }), reasonCode: "SYNTHETIC_LOCK_BUSY" }, claim.request.requestHash, true);
    const loader = require.resolve("tsx");
    const script = path.resolve("scripts/quality/controlled-operation-fixture-effect.ts");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", loader, script, this.root, phase, claim.request.requestHash, String(this.effectDelayMs)], {
        env: operationToolEnvironment(), stdio: ["ignore", "pipe", "pipe", 3, 4, 5],
      });
      child.stdout?.resume(); child.stderr?.resume();
      if (this.effectDelayMs) console.log(JSON.stringify({ point: "child:started", pid: child.pid }));
      child.on("error", () => reject(new Error("OPS_FIXTURE_EFFECT_FAILED")));
      child.on("exit", code => code === 0 ? resolve() : reject(new Error("OPS_FIXTURE_EFFECT_FAILED")));
    });
    const receipt = await readRootJson(path.join(this.root, "synthetic-effects", `${claim.request.requestHash.slice(7)}-${phase}.json`));
    return operationHash(receipt);
  }
  private async verifyRelease(claim: OperationClaim): Promise<string> {
    const raw = await readRootJson(path.join(this.root, "synthetic-release.json")) as { manifest: string; signature: string; publicKey: string };
    if (!verify(null, Buffer.from(raw.manifest), raw.publicKey, Buffer.from(raw.signature, "base64"))) throw new Error("CONTROLLED_OPERATION_SIGNATURE_INVALID");
    const hash = `sha256:${createHash("sha256").update(raw.manifest).digest("hex")}`;
    const manifest = JSON.parse(raw.manifest);
    const target = claim.operation.execution.context.target;
    if (!target || hash !== target.manifestSha256 || manifest.version !== target.manifestVersion || manifest.webImageDigest !== target.webImageDigest) throw new Error("CONTROLLED_OPERATION_TARGET_CHANGED");
    return hash;
  }
}
