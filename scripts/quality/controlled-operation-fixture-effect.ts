import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { realpath } from "node:fs/promises";
import { assertInheritedOperationLocks, writeRootJson } from "../../ops/controlled-operation-agent/journal";

async function main() {
  const [root, phase, requestHash, delayValue] = process.argv.slice(2);
  if (!root || await realpath(root) !== root || !/\/areaforge-v20-ops-[A-Za-z0-9]+\/agent\/[a-z0-9-]+$/.test(root)
    || !["backup", "prepare", "migration", "switch", "rollback", "maintenance"].includes(phase) || !/^sha256:[a-f0-9]{64}$/.test(requestHash)) throw new Error("OPS_FIXTURE_EFFECT_INVALID");
  const delayMs = Number(delayValue);
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10_000) throw new Error("OPS_FIXTURE_DELAY_INVALID");
  assertInheritedOperationLocks(root);
  if (delayMs) await delay(delayMs);
  await writeRootJson(path.join(root, "synthetic-effects"), `${requestHash.slice(7)}-${phase}.json`, { schemaVersion: 1, environment: "local_fixture", requestHash, phase, count: 1 });
}
main().catch(() => { console.error("OPS_SYNTHETIC_EFFECT_REFUSED"); process.exitCode = 1; });
