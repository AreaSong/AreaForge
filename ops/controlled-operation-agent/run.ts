import path from "node:path";
import { createPrismaClient } from "../../packages/db/src/index";
import { executeRootOperation } from "./engine";
import { assertInheritedOperationLocks, assertRootDirectory } from "./journal";

async function main() {
  if (process.env.OPS_AGENT_ENABLED !== "true") throw new Error("OPS_AGENT_DISABLED");
  const [mode, target, caseName, requestId] = process.argv.slice(2);
  if (mode === "production") return runProduction(target, caseName);
  if (mode !== "fixture" || process.env.AREAFORGE_OPS_ISOLATED_DB !== "1" || !/^[a-z0-9-]{1,70}$/.test(caseName ?? "") || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId ?? "")) throw new Error("OPS_AGENT_SCOPE_REFUSED");
  const { loadOperationFixture, operationFixtureEnvironment, verifyOperationFixtureLedger } = await import("../../scripts/quality/controlled-operation-fixture");
  const { OperationFixtureDriver } = await import("../../scripts/quality/controlled-operation-fixture-driver");
  const fixture = loadOperationFixture(target); const root = path.join(fixture.root, "agent", caseName);
  assertRootDirectory(root); assertInheritedOperationLocks(root);
  const env = operationFixtureEnvironment(fixture); const client = createPrismaClient(env.DATABASE_URL);
  const leaseMs = Number(process.env.OPS_FIXTURE_LEASE_MS ?? "30000");
  const delayMs = Number(process.env.OPS_FIXTURE_EFFECT_DELAY_MS ?? "0");
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10_000) throw new Error("OPS_FIXTURE_DELAY_INVALID");
  try {
    await verifyOperationFixtureLedger(client, fixture);
    const result = await executeRootOperation({ client, root, requestId, workerId: `local-root-${process.pid}`, operatorEmail: fixture.operatorEmail,
      scopeId: fixture.scopeId, driver: new OperationFixtureDriver(root, delayMs, process.env.OPS_FIXTURE_REJECT_EXECUTION === "true"), leaseMs,
      checkpoint: async point => {
        console.log(JSON.stringify({ point, pid: process.pid }));
        if (process.env.OPS_FIXTURE_PAUSE_AT?.split(",").includes(point)) await new Promise<void>(resolve => { process.stdin.resume(); process.stdin.once("data", () => { process.stdin.pause(); resolve(); }); });
        if (point === "writeback:before" && process.env.OPS_FIXTURE_FAIL_WRITEBACK === "true") throw new Error("OPS_FIXTURE_WRITEBACK_FAILED");
      },
    });
    console.log(JSON.stringify({ ...result, environment: "local_fixture", productionTouched: false }));
  } finally { process.stdin.destroy(); await client.$disconnect(); }
}

async function runProduction(configFile: string, requestId: string) {
  const { loadProductionOperationConfig, ProductionOperationDriver } = await import("./production-driver");
  const config = await loadProductionOperationConfig(configFile);
  assertRootDirectory(config.stateRoot); assertInheritedOperationLocks(config.stateRoot);
  const driver = new ProductionOperationDriver(config);
  if (requestId === "context") {
    const context = await driver.publishContext();
    console.log(JSON.stringify({ contextPublished: true, snapshotHash: context.snapshotHash })); return;
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId ?? "")) throw new Error("OPS_AGENT_SCOPE_REFUSED");
  const client = createPrismaClient(config.databaseUrl);
  try {
    const result = await executeRootOperation({ client, root: config.stateRoot, requestId, workerId: `root-${process.pid}`,
      operatorEmail: config.operatorEmail, scopeId: config.scopeId, driver });
    console.log(JSON.stringify(result));
  } finally { await client.$disconnect(); }
}
main().catch(error => {
  const message = error instanceof Error && /^(OPS_|CONTROLLED_OPERATION_)[A-Z_]+$/.test(error.message) ? error.message : "OPS_AGENT_FAILED";
  console.error(message); process.exitCode = 1;
});
