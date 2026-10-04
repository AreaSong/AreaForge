import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { operationHash, type PrismaClient } from "../../packages/db/src/index";

export interface ControlledOperationFixture {
  root: string; databaseName: string; containerName: string; port: number; image: string;
  ownerUid: number; ownerGid: number; operatorEmail: string; scopeId: string;
  password: string; sessionSecret: string; actionSecret: string;
}
export function loadOperationFixture(root: string, repository = process.cwd()): ControlledOperationFixture {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (uid === undefined || gid === undefined || !path.isAbsolute(root) || root !== realpathSync(root)
    || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))
    || !/^areaforge-v20-ops-[A-Za-z0-9]+$/.test(path.basename(root))) invalid();
  for (const directory of [root, ...["uploads", "exports", "context", "agent"].map(name => path.join(root, name))]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory || stat.uid !== uid || (stat.mode & 0o077)) invalid();
  }
  const marker = readOperationPrivate(path.join(root, ".areaforge-ops-fixture.json"), uid);
  const secrets = readOperationPrivate(path.join(root, ".fixture.private.json"), uid);
  const keys = ["schemaVersion", "fixtureKind", "databaseName", "containerName", "port", "image", "ownerUid", "ownerGid", "repositoryHash", "operatorEmail"];
  if (Object.keys(marker).length !== keys.length || keys.some(key => !(key in marker)) || marker.schemaVersion !== 1 || marker.fixtureKind !== "controlled-operation"
    || marker.ownerUid !== uid || marker.ownerGid !== gid || marker.repositoryHash !== createHash("sha256").update(realpathSync(repository)).digest("hex")) invalid();
  const suffix = String(marker.databaseName).match(/^areaforge_v20_ops_([a-f0-9]{12})$/)?.[1];
  if (!suffix || marker.containerName !== `areaforge-v20-ops-${suffix}` || marker.operatorEmail !== `ops-${suffix}@example.test`
    || !Number.isSafeInteger(marker.port) || Number(marker.port) < 1024 || Number(marker.port) > 65535
    || !/^sha256:[a-f0-9]{64}$/.test(String(marker.image))) invalid();
  if (Object.keys(secrets).length !== 3 || ["password", "sessionSecret", "actionSecret"].some(key => !/^[a-f0-9]{64}$/.test(String(secrets[key]))) || new Set(Object.values(secrets)).size !== 3) invalid();
  return { root, databaseName: String(marker.databaseName), containerName: String(marker.containerName), port: Number(marker.port), image: String(marker.image),
    ownerUid: uid, ownerGid: gid, operatorEmail: String(marker.operatorEmail), scopeId: operationHash(marker),
    password: String(secrets.password), sessionSecret: String(secrets.sessionSecret), actionSecret: String(secrets.actionSecret) };
}
export function operationFixtureEnvironment(fixture: ControlledOperationFixture): NodeJS.ProcessEnv {
  return { ...operationToolEnvironment(), DATABASE_URL: `postgresql://fixture:${fixture.password}@127.0.0.1:${fixture.port}/${fixture.databaseName}`,
    DOTENV_CONFIG_PATH: path.join(fixture.root, ".fixture-env-disabled"),
    AREAFORGE_OPS_ISOLATED_DB: "1", AREAFORGE_OPS_FIXTURE_ROOT: fixture.root,
    AUTH_ADMIN_EMAIL: fixture.operatorEmail, AUTH_SESSION_SECRET: fixture.sessionSecret, AUTH_ACTION_TOKEN_SECRET: fixture.actionSecret,
    AUTH_MULTI_USER_ENABLED: "true", AUTH_RBAC_ENABLED: "true", OPS_EXECUTION_ENABLED: "true", OPS_EXECUTION_LOCAL_FIXTURE: "true",
    OPS_EXECUTION_CONTEXT_FILE: path.join(fixture.root, "context", "execution-context.json"), OPS_EXECUTION_SCOPE_ID: fixture.scopeId,
    OPS_AGENT_ENABLED: "false", UPLOAD_DIR: path.join(fixture.root, "uploads"), EXPORT_DIR: path.join(fixture.root, "exports"),
    DATA_LIFECYCLE_ENABLED: "false", DATA_DELETE_ENABLED: "false", DATA_DELETE_WORKER_ENABLED: "false", DATA_EXPORT_ENABLED: "false",
    DATA_JOB_WORKER_ENABLED: "false", RANKING_ENABLED: "false", PLATFORM_NOTIFICATIONS_ENABLED: "false",
    PLATFORM_NOTIFICATION_QUEUE_ENABLED: "false", AI_ENABLED: "false", AI_API_KEY: "", SMTP_HOST: "", SMTP_PASSWORD: "" };
}
export function operationToolEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "PNPM_HOME", "LANG", "LC_ALL", "DOCKER_HOST", "DOCKER_CONTEXT"].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
}
export function readOperationPrivate(file: string, uid = process.getuid!()): Record<string, unknown> {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== uid || stat.mode & 0o077 || stat.size > 16_384) invalid();
    const value = JSON.parse(readFileSync(fd, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    return value;
  } finally { closeSync(fd); }
}
export async function verifyOperationFixtureLedger(client: PrismaClient, fixture: ControlledOperationFixture) {
  const database = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database[0]?.name, fixture.databaseName);
  const directory = path.resolve("prisma/migrations");
  const expected = readdirSync(directory).filter(name => /^\d+_/.test(name)).sort();
  assert.equal(expected.length, 53, "OPS confirmation permits exactly the existing 53 migrations");
  const rows = await client.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null; rolledBack: Date | null; logs: string | null; steps: number }>>`
    SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS "rolledBack", logs, applied_steps_count AS steps
    FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
  assert.deepEqual(rows.map(row => row.name), expected);
  for (const row of rows) {
    assert.ok(row.finished); assert.equal(row.rolledBack, null); assert.ok(!row.logs); assert.equal(row.steps, 1);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(path.join(directory, row.name, "migration.sql"))).digest("hex"));
  }
  return rows.length;
}
export function assertOperationFixtureContainer(fixture: ControlledOperationFixture): void {
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) invalid();
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
  if (!endpoint.startsWith("unix://")) invalid();
  const raw = JSON.parse(execFileSync("docker", ["inspect", fixture.containerName], { encoding: "utf8" }))[0];
  if (raw.Config.Labels?.["com.areaforge.fixture"] !== "controlled-operation" || raw.Config.Labels?.["com.areaforge.fixture.owner"] !== String(fixture.ownerUid)
    || raw.Image !== fixture.image || raw.Config.Env.filter((entry: string) => entry.startsWith("POSTGRES_DB=")).join() !== `POSTGRES_DB=${fixture.databaseName}`) invalid();
  const port = execFileSync("docker", ["port", fixture.containerName, "5432/tcp"], { encoding: "utf8" }).trim();
  if (port !== `127.0.0.1:${fixture.port}`) invalid();
}
function invalid(): never { throw new Error("CONTROLLED_OPERATION_FIXTURE_INVALID"); }
