import { constants } from "node:fs";
import { open, lstat, realpath, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { operationContextHash, operationHash, parseOperationContext, type OperationClaim, type OperationExecutionContext } from "../../packages/db/src/index";
import type { RootOperationDriver } from "./engine";
import { ensureRootDirectory, writeRootJson, readRootJson, syncRootDirectory, type RootOperationPhase } from "./journal";
import { validateRootDispatchReceipt } from "./result";

export interface ProductionOperationConfig {
  schemaVersion: 1; enabled: boolean; scopeId: string; operatorEmail: string; databaseUrl: string;
  stateRoot: string; legacyStateRoot: string; updaterConfigFile: string; contextDirectory: string;
}
export async function loadProductionOperationConfig(file: string): Promise<ProductionOperationConfig> {
  if (process.getuid?.() !== 0 || process.env.OPS_AGENT_PRODUCTION_ENABLED !== "true") throw new Error("OPS_PRODUCTION_DISABLED");
  const value = await readRootJson(file) as ProductionOperationConfig;
  const keys = ["schemaVersion", "enabled", "scopeId", "operatorEmail", "databaseUrl", "stateRoot", "legacyStateRoot", "updaterConfigFile", "contextDirectory"];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || value.schemaVersion !== 1 || value.enabled !== true
    || !/^sha256:[a-f0-9]{64}$/.test(value.scopeId) || !/^[^\s@]+@[^\s@]+$/.test(value.operatorEmail)) throw new Error("OPS_PRODUCTION_CONFIG_INVALID");
  const database = new URL(value.databaseUrl);
  if (!["postgres:", "postgresql:"].includes(database.protocol)) throw new Error("OPS_PRODUCTION_CONFIG_INVALID");
  for (const name of [value.stateRoot, value.legacyStateRoot, value.updaterConfigFile, value.contextDirectory]) {
    const stat = await lstat(name);
    if (!path.isAbsolute(name) || await realpath(name) !== name || stat.uid !== 0 || stat.isSymbolicLink() || stat.mode & 0o022) throw new Error("OPS_PRODUCTION_PATH_INVALID");
  }
  if (!(await lstat(value.updaterConfigFile)).isFile() || (await lstat(value.updaterConfigFile)).mode & 0o077) throw new Error("OPS_PRODUCTION_CONFIG_INVALID");
  return value;
}

export class ProductionOperationDriver implements RootOperationDriver {
  readonly environment = "production" as const;
  constructor(private readonly config: ProductionOperationConfig) {}
  async observe(): Promise<OperationExecutionContext> {
    const raw = await this.dispatch("observe") as { expectedBefore: OperationExecutionContext["expectedBefore"]; target: OperationExecutionContext["target"] };
    const context: OperationExecutionContext = { schemaVersion: 1, environment: "production", scopeId: this.config.scopeId,
      observedAt: new Date().toISOString(), expectedBefore: raw.expectedBefore, target: raw.target, snapshotHash: "" };
    context.snapshotHash = operationContextHash(context);
    const parsed = parseOperationContext(context);
    if (!parsed) throw new Error("OPS_PRODUCTION_OBSERVATION_INVALID");
    return parsed;
  }
  phases(claim: OperationClaim): RootOperationPhase[] {
    switch (claim.operation.parameters.operation) {
      case "APPLY_RELEASE": case "ROLLBACK_RELEASE": return ["validation", "execution", "health"];
      case "CHECK_RELEASE": return ["validation", "check"];
      case "BACKUP_PREVIEW": return ["validation", "preview"];
      case "DIAGNOSTIC_HEALTH": return ["validation", "health"];
      case "MAINTENANCE_HOLD": return ["validation", "maintenance"];
    }
  }
  async execute(phase: RootOperationPhase, claim: OperationClaim) {
    if (phase === "validation") {
      const live = await this.observe();
      if (!live.expectedBefore.signatureRequired) throw new Error("CONTROLLED_OPERATION_SIGNATURE_REQUIRED");
      return operationHash(live);
    }
    const dispatchRoot = path.join(this.config.stateRoot, "dispatch"); await ensureRootDirectory(dispatchRoot);
    const name = `${claim.request.requestHash.slice(7)}-${claim.generation}-${phase}.json`;
    const envelope = { operation: claim.operation, requestId: claim.request.id, requestHash: claim.request.requestHash,
      nonce: claim.request.nonce, generation: claim.generation, phase,
      requestedAt: claim.request.requestedAt.toISOString(), expiresAt: claim.request.expiresAt.toISOString() };
    await writeRootJson(dispatchRoot, name, envelope);
    const result = await this.dispatch(phase, path.join(dispatchRoot, name));
    return validateRootDispatchReceipt(result, claim.request.requestHash, ["execution", "maintenance"].includes(phase));
  }
  async publishContext(): Promise<OperationExecutionContext> {
    const context = await this.observe(); const temporary = path.join(this.config.contextDirectory, `.${randomUUID()}.tmp`);
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { await file.writeFile(JSON.stringify(context)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path.join(this.config.contextDirectory, "execution-context.json"));
    await syncRootDirectory(this.config.contextDirectory); return context;
  }
  private async dispatch(phase: string, envelope = ""): Promise<unknown> {
    const script = fileURLToPath(new URL("./dispatch.sh", import.meta.url)); const stat = await lstat(script);
    if (stat.uid !== 0 || stat.isSymbolicLink() || stat.mode & 0o022) throw new Error("OPS_PRODUCTION_SCRIPT_UNTRUSTED");
    return new Promise((resolve, reject) => {
      const child = spawn("/bin/bash", [script, phase, envelope], {
        env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", OPS_AGENT_PRODUCTION_ENABLED: "true",
          AREAFORGE_UPDATE_AGENT_CONFIG: this.config.updaterConfigFile, AREAFORGE_OPS_STATE_DIR: this.config.legacyStateRoot },
        stdio: ["ignore", "pipe", "pipe", 3, 4, 5],
      });
      let output = ""; let overflow = false;
      child.stdout?.on("data", chunk => { if (output.length + chunk.length > 65_536) overflow = true; else output += String(chunk); });
      // 旧脚本的原始输出不进入 Web、日志或异常消息，只接受下面的严格脱敏结果。
      child.stderr?.resume(); child.on("error", () => reject(new Error("OPS_PRODUCTION_DISPATCH_FAILED")));
      child.on("exit", code => { try { if (code !== 0 || overflow) throw new Error(); resolve(JSON.parse(output)); } catch { reject(new Error("OPS_PRODUCTION_DISPATCH_UNCERTAIN")); } });
    });
  }
}
