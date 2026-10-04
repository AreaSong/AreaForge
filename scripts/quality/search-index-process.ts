import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { searchIndexFixtureEnvironment, type SearchIndexFixture } from "./search-index-fixture";

export function startSearchFixtureWorker(fixture: SearchIndexFixture, jobId: string, pauseAt: "prepared" | "written" | "none" = "none", options: { leaseMs?: number } = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./search-index-runtime-child.ts", import.meta.url))], {
    stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...searchIndexFixtureEnvironment(fixture), TSX_TSCONFIG_PATH: "apps/web/tsconfig.json",
      SEARCH_FIXTURE_JOB_ID: jobId, SEARCH_FIXTURE_PAUSE_AT: pauseAt, SEARCH_FIXTURE_LEASE_MS: String(options.leaseMs ?? 30_000) },
  });
  const events: Array<{ point: string; result?: string }> = []; let exited = false;
  child.on("message", message => { if (message && typeof message === "object" && "point" in message) events.push(message as { point: string; result?: string }); });
  const done = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  return { child, done, events, async waitFor(point: string) {
    const deadline = Date.now() + 20_000;
    while (!events.some(event => event.point === point)) {
      if (exited || Date.now() >= deadline || events.some(event => event.point === "failed")) throw new Error(`SEARCH_CHILD_POINT_MISSING:${point}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }, continue() { if (child.connected) child.send({ action: "continue" }); },
  disable() { if (child.connected) child.send({ action: "disable" }); },
  stop() { if (!exited) child.kill("SIGKILL"); } };
}
