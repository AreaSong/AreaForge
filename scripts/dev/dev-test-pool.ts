import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildWorktreeValidationFingerprint } from "../quality/worktree-validation-fingerprint";
import { computeProductExperienceSourceHash } from "../quality/product-experience-source";
import { DockerClient, type BuildIdentity } from "./dev-test-docker";
import { acquirePoolLock } from "./dev-test-pool-lock";
import {
  DEV_TEST_POOL,
  containerName,
  parseConfiguredPorts,
  parseSlot,
  selectLatestInstance,
  selectSlot,
  validatePool,
  type PoolInstance,
  type PoolMode,
  type SlotNumber,
  type SlotSelection,
} from "./dev-test-pool-core";

type Command = PoolMode | "latest" | "list" | "logs" | "stop" | "doctor";
type Options = { slot?: SlotNumber; note: string; json: boolean; dryRun: boolean };
type HealthPayload = {
  ok?: boolean;
  runtimeIdentity?: {
    status?: string;
    gitCommit?: string;
    productExperienceSourceHash?: string;
    buildId?: string;
  };
};

const root = process.cwd();
const docker = new DockerClient(root);
const ports = parseConfiguredPorts();
let interrupted = false;

process.on("SIGINT", () => { interrupted = true; });
process.on("SIGTERM", () => { interrupted = true; });

async function main(): Promise<void> {
  const { command, options } = parseArguments(process.argv.slice(2));
  docker.assertAvailable();
  if (command === "latest") return printLatest(loadPool(), options.json);
  if (command === "list") return printInstances(loadPool(), options.json);
  if (command === "doctor") return runDoctor(options.json);
  if (command === "logs") return showLogs(requiredSlot(options));
  if (command === "stop") return stopSlot(requiredSlot(options), options.json);
  await deploy(command, options);
}

async function deploy(mode: PoolMode, options: Options): Promise<void> {
  const identity = createBuildIdentity(options.note);
  if (options.dryRun) {
    const release = acquirePoolLock();
    try {
      const selection = selectSlot(mode, loadPool(), ports, options.slot);
      printPlan(mode, selection, identity, options.json);
    } finally {
      release();
    }
    return;
  }

  const imageId = docker.build(identity);
  let committed = false;
  try {
    const release = acquirePoolLock();
    try {
      const selection = selectSlot(mode, loadPool(), ports, options.slot);
      await replaceSlot(selection, identity);
      committed = true;
      printResult(mode, selection, identity, loadPool(), options.json);
    } finally {
      release();
    }
  } finally {
    if (!committed) docker.removeCandidateImage(imageId);
  }
}

async function replaceSlot(selection: SlotSelection, identity: BuildIdentity): Promise<void> {
  const old = selection.replacing;
  const fixedName = containerName(selection.slot);
  const backupName = `${fixedName}-rollback-${identity.generation}`;
  const oldWasRunning = old?.running ?? false;
  let renamed = false;

  try {
    if (old) {
      if (old.running) docker.stop(old.name);
      docker.rename(old.name, backupName);
      renamed = true;
    }
    const environment = loadRuntimeEnvironment(selection.slot, selection.port, identity.appVersion);
    docker.runInstance(selection.slot, selection.port, identity, environment);
    await waitForHealth(selection.port, identity);
    if (renamed) docker.remove(backupName);
    if (old) docker.removeOwnedImageIfUnused(old.imageId);
  } catch (error) {
    const rollbackError = rollbackSlot(fixedName, backupName, renamed, oldWasRunning);
    if (rollbackError) throw new Error(`${message(error)}; rollback failed: ${rollbackError}`);
    throw error;
  }
}

function rollbackSlot(fixedName: string, backupName: string, renamed: boolean, oldWasRunning: boolean): string | null {
  try {
    if (docker.inspectContainer(fixedName)) docker.remove(fixedName);
    if (renamed && docker.inspectContainer(backupName)) {
      docker.rename(backupName, fixedName);
      if (oldWasRunning) docker.start(fixedName);
    }
    return null;
  } catch (error) {
    return message(error);
  }
}

async function waitForHealth(port: number, identity: BuildIdentity): Promise<void> {
  const deadline = Date.now() + 90_000;
  let lastFailure = "service did not respond";
  while (Date.now() < deadline && !interrupted) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3_000) });
      const payload = await response.json() as HealthPayload;
      validateHealth(response.status, payload, identity);
      return;
    } catch (error) {
      lastFailure = message(error);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  if (interrupted) throw new Error("test-pool deployment interrupted");
  throw new Error(`test instance failed health validation within 90 seconds: ${lastFailure}`);
}

function validateHealth(status: number, payload: HealthPayload, identity: BuildIdentity): void {
  const runtime = payload.runtimeIdentity;
  if (status !== 200 || payload.ok !== true || runtime?.status !== "verified") throw new Error(`health returned HTTP ${status}`);
  if (runtime.gitCommit !== identity.gitCommit) throw new Error("health git commit does not match the candidate image");
  if (runtime.productExperienceSourceHash !== identity.sourceFingerprint) throw new Error("health source fingerprint does not match");
  if (runtime.buildId !== identity.buildId) throw new Error("health build ID does not match");
}

function loadPool(): PoolInstance[] {
  docker.assertSlotNamesOwned();
  const instances = docker.listOwned();
  validatePool(instances, ports);
  return instances;
}

function stopSlot(slot: SlotNumber, json: boolean): void {
  const release = acquirePoolLock();
  try {
    const instance = loadPool().find((item) => item.slot === slot);
    if (!instance) throw new Error(`slot ${slot} is already empty`);
    docker.remove(instance.name);
    docker.removeOwnedImageIfUnused(instance.imageId);
    const instances = loadPool();
    printValue({ action: "stop", slot, removed: instance.name,
      latest: summarizeLatest(instances), instances: summarize(instances) }, json);
  } finally {
    release();
  }
}

function showLogs(slot: SlotNumber): void {
  const instance = loadPool().find((item) => item.slot === slot);
  if (!instance) throw new Error(`slot ${slot} is empty`);
  process.stdout.write(docker.logs(instance.name));
}

function runDoctor(json: boolean): void {
  try {
    const instances = loadPool();
    const dockerDiskUsage = docker.diskUsage();
    printValue({ ok: true, pool: DEV_TEST_POOL, ports, latest: summarizeLatest(instances),
      instances: summarize(instances), dockerDiskUsage }, json);
  } catch (error) {
    printValue({ ok: false, pool: DEV_TEST_POOL, ports, error: message(error) }, json);
    process.exitCode = 1;
  }
}

function createBuildIdentity(note: string): BuildIdentity {
  const fingerprint = buildWorktreeValidationFingerprint(root, "dev-test-pool", "custom");
  // The runtime identity must describe the product source shipped in the image.
  // Keep the full worktree fingerprint for build uniqueness, but do not bind UX
  // evidence to unrelated docs, evidence, or operator-only changes.
  const sourceFingerprint = computeProductExperienceSourceHash(root);
  const generation = Date.now();
  const buildId = sha256(`${fingerprint.digest}:${sourceFingerprint}:${generation}:${randomUUID()}`);
  const short = sourceFingerprint.replace("sha256:", "").slice(0, 12);
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version: string };
  return {
    imageTag: `${DEV_TEST_POOL}:candidate-${short}-${generation}`,
    appVersion: packageJson.version,
    gitCommit: fingerprint.gitHead,
    sourceFingerprint,
    buildId,
    generation,
    note: normalizeNote(note),
  };
}

function loadRuntimeEnvironment(slot: SlotNumber, port: number, appVersion: string): Record<string, string> {
  const source = path.join(root, "apps/web/.env.local");
  if (!existsSync(source)) throw new Error("apps/web/.env.local is required for the local test pool");
  const local = parseEnvFile(readFileSync(source, "utf8"));
  const databaseUrl = local.DATABASE_URL;
  if (!databaseUrl) throw new Error("apps/web/.env.local must define DATABASE_URL");
  const multiUserEnabled = (process.env.AUTH_MULTI_USER_ENABLED ?? local.AUTH_MULTI_USER_ENABLED ?? "false").trim();
  const actionTokenSecret = (process.env.AUTH_ACTION_TOKEN_SECRET ?? local.AUTH_ACTION_TOKEN_SECRET ?? "").trim();
  if (multiUserEnabled === "true" && actionTokenSecret.length < 32) {
    throw new Error("AUTH_ACTION_TOKEN_SECRET with at least 32 characters is required for a multi-user test-pool runtime");
  }
  const environment: Record<string, string> = {
    DATABASE_URL: localContainerDatabaseUrl(databaseUrl),
    APP_URL: `http://127.0.0.1:${port}`,
    APP_VERSION: appVersion,
    AUTH_SESSION_COOKIE_NAME: `af_dev_test_${slot}`,
    AUTH_SESSION_SECRET: requiredLocal(local, "AUTH_SESSION_SECRET"),
    AUTH_MULTI_USER_ENABLED: multiUserEnabled,
    AI_ENABLED: "false",
    AI_LOG_PROMPTS: "false",
    AI_ALLOW_SENSITIVE_CONTEXT: "false",
    UPLOAD_DIR: "/app/uploads",
    TRUST_PROXY: "false",
  };
  if (actionTokenSecret) environment.AUTH_ACTION_TOKEN_SECRET = actionTokenSecret;
  for (const key of ["AUTH_ADMIN_EMAIL", "AUTH_ADMIN_PASSWORD_HASH", "AI_CREDENTIALS_ENCRYPTION_KEY", "AI_PAYLOAD_BINDING_SECRET"] as const) {
    if (local[key]) environment[key] = local[key];
  }
  return environment;
}

function localContainerDatabaseUrl(value: string): string {
  const url = new URL(value);
  if (!/^(postgres|postgresql):$/.test(url.protocol)) throw new Error("test-pool DATABASE_URL must use PostgreSQL");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("test-pool DATABASE_URL must point to a local PostgreSQL host");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^areaforge(?:[-_](?:dev|test|local).*)?$/.test(database)) {
    throw new Error("test-pool database name must be areaforge or an areaforge dev/test/local database");
  }
  url.hostname = "host.docker.internal";
  return url.toString();
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) continue;
    result[key] = unquote(rawValue.trim());
  }
  return result;
}

function parseArguments(args: string[]): { command: Command; options: Options } {
  const command = args.shift() as Command | undefined;
  if (!command || !["refresh", "snapshot", "latest", "list", "logs", "stop", "doctor"].includes(command)) throw new Error(usage());
  const options: Options = { note: "", json: false, dryRun: false };
  while (args.length > 0) {
    const argument = args.shift();
    if (argument === "--") continue;
    if (argument === "--json") options.json = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--slot") options.slot = parseSlot(args.shift() ?? "");
    else if (argument === "--note") options.note = args.shift() ?? "";
    else throw new Error(`unknown argument: ${argument ?? ""}\n${usage()}`);
  }
  return { command, options };
}

function printPlan(mode: PoolMode, selection: SlotSelection, identity: BuildIdentity, json: boolean): void {
  printValue({ action: mode, dryRun: true, slot: selection.slot, port: selection.port, reason: selection.reason,
    evicts: selection.replacing?.name ?? null, sourceFingerprint: identity.sourceFingerprint }, json);
}

function printResult(mode: PoolMode, selection: SlotSelection, identity: BuildIdentity, instances: PoolInstance[], json: boolean): void {
  printValue({ action: mode, slot: selection.slot, url: `http://127.0.0.1:${selection.port}`,
    evicted: selection.replacing?.name ?? null, sourceFingerprint: identity.sourceFingerprint,
    latest: summarizeLatest(instances), instances: summarize(instances) }, json);
}

function printInstances(instances: PoolInstance[], json: boolean): void {
  printValue({ pool: DEV_TEST_POOL, latest: summarizeLatest(instances), instances: summarize(instances) }, json);
}

function printLatest(instances: PoolInstance[], json: boolean): void {
  const latest = summarizeLatest(instances);
  if (json) return void console.log(JSON.stringify({ pool: DEV_TEST_POOL, latest }, null, 2));
  printLatestSummary(latest);
}

function printValue(value: unknown, json: boolean): void {
  if (json) return void console.log(JSON.stringify(value, null, 2));
  if (typeof value === "object" && value && "instances" in value) {
    const record = value as { instances: ReturnType<typeof summarize>; latest?: ReturnType<typeof summarizeLatest>;
      dockerDiskUsage?: ReturnType<DockerClient["diskUsage"]>; [key: string]: unknown };
    for (const [key, item] of Object.entries(record)) {
      if (key !== "instances" && key !== "latest" && key !== "dockerDiskUsage") console.log(`${key}: ${String(item)}`);
    }
    if (record.latest !== undefined) printLatestSummary(record.latest);
    console.table(record.instances);
    if (record.dockerDiskUsage) {
      console.log("Docker disk usage:");
      console.table(record.dockerDiskUsage);
    }
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function summarize(instances: PoolInstance[]) {
  const latest = selectLatestInstance(instances);
  return [1, 2, 3].map((slot) => {
    const instance = instances.find((item) => item.slot === slot);
    return instance ? { slot, url: `http://127.0.0.1:${instance.port}`, status: instance.running ? "running" : "stopped",
      latest: instance.id === latest?.id ? "LATEST" : "-", note: instance.note || "-",
      commit: instance.gitCommit.slice(0, 7), source: instance.sourceFingerprint.slice(7, 19) }
      : { slot, url: `http://127.0.0.1:${ports[slot - 1]}`, status: "empty", note: "-", commit: "-", source: "-" };
  });
}

function summarizeLatest(instances: PoolInstance[]) {
  const latest = selectLatestInstance(instances);
  if (!latest) return null;
  return { slot: latest.slot, container: latest.name, port: latest.port, url: `http://127.0.0.1:${latest.port}`,
    status: latest.running ? "running" : "stopped", note: latest.note || "-", generation: latest.generation,
    commit: latest.gitCommit, sourceFingerprint: latest.sourceFingerprint, buildId: latest.buildId };
}

function printLatestSummary(latest: ReturnType<typeof summarizeLatest>): void {
  if (!latest) return void console.log("latest: none");
  console.log(`latest slot: ${latest.slot}`);
  console.log(`latest container: ${latest.container}`);
  console.log(`latest port: ${latest.port}`);
  console.log(`latest url: ${latest.url}`);
  console.log(`latest status: ${latest.status}`);
  console.log(`latest note: ${latest.note}`);
  console.log(`latest source: ${latest.sourceFingerprint}`);
}

function requiredSlot(options: Options): SlotNumber {
  if (!options.slot) throw new Error("--slot 1|2|3 is required");
  return options.slot;
}

function requiredLocal(values: Record<string, string>, key: string): string {
  const value = values[key]?.trim();
  if (!value) throw new Error(`apps/web/.env.local must define ${key}`);
  return value;
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "");
}

function normalizeNote(value: string): string {
  return value.trim().replace(/[\r\n]+/g, " ").slice(0, 120);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usage(): string {
  return "Usage: dev-test-pool <refresh|snapshot|latest|list|logs|stop|doctor> [--slot 1|2|3] [--note text] [--dry-run] [--json]";
}

main().catch((error) => {
  console.error(`FAIL ${DEV_TEST_POOL}: ${message(error)}`);
  process.exit(1);
});
