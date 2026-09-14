import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { operationFixtureEnvironment, type ControlledOperationFixture } from "./controlled-operation-fixture";

const require = createRequire(import.meta.url);
export function startOperationFixtureAgent(fixture: ControlledOperationFixture, caseName: string, requestId: string, options: { pauseAt?: string; effectDelayMs?: number; enabled?: boolean; failWriteback?: boolean; rejectExecution?: boolean } = {}) {
  const root = path.join(fixture.root, "agent", caseName);
  const child = spawn("python3", [path.resolve("ops/controlled-operation-agent/lock-exec.py"), root, process.execPath, require.resolve("tsx"),
    path.resolve("ops/controlled-operation-agent/run.ts"), "fixture", fixture.root, caseName, requestId], {
    env: { ...operationFixtureEnvironment(fixture), OPS_AGENT_ENABLED: options.enabled === false ? "false" : "true", OPS_FIXTURE_LEASE_MS: "1600",
      OPS_FIXTURE_PAUSE_AT: options.pauseAt, OPS_FIXTURE_EFFECT_DELAY_MS: String(options.effectDelayMs ?? 0), OPS_FIXTURE_FAIL_WRITEBACK: options.failWriteback ? "true" : "false",
      OPS_FIXTURE_REJECT_EXECUTION: options.rejectExecution ? "true" : "false" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = ""; let exited = false;
  child.stdout.on("data", data => { stdout += String(data); }); child.stderr.on("data", data => { stderr += String(data); });
  const done = new Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.on("error", reject); child.on("exit", (code, signal) => { exited = true; if (stderr) console.error(stderr.trim()); resolve({ code, signal, stdout, stderr }); });
  });
  return { child, done, async waitFor(point: string) {
    const deadline = Date.now() + 15_000;
    while (!stdout.split("\n").some(line => { try { return JSON.parse(line).point === point; } catch { return false; } })) {
      if (exited || Date.now() >= deadline) { if (!exited) child.kill("SIGKILL"); throw new Error(`OPS_FIXTURE_POINT_MISSING:${point}:${stderr}`); }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, continue() { child.stdin.write("\n"); }, stop() { if (!exited) child.kill("SIGKILL"); } };
}
