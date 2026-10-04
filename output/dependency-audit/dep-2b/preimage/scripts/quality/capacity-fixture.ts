import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PrismaClient } from "../../packages/db/src/index";
import { assertCapacityMigrationPreimage } from "./capacity-migration-preimage";

// 与旧域分别固定源身份；本批只验证准入，不启动任何业务消费者。
export { CAPACITY_SCHEMA_SHA256 } from "./capacity-migration-preimage";
export interface CapacityFixture {
  root: string; databaseName: string; containerName: string; volumeName: string; port: number; image: string;
  ownerUid: number; ownerGid: number; operatorEmail: string; scopeId: string;
  password: string; sessionSecret: string; actionSecret: string;
}

export function loadCapacityFixture(root: string, repository = process.cwd()): CapacityFixture {
  const uid = process.getuid?.(); const gid = process.getgid?.();
  if (uid === undefined || uid === 0 || gid === undefined || !path.isAbsolute(root) || root !== realpathSync(root)
    || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))
    || !/^areaforge-v20-capacity-[A-Za-z0-9]+$/.test(path.basename(root))) invalid();
  for (const directory of [root, path.join(root, "uploads"), path.join(root, "exports")]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || stat.mode & 0o077 || realpathSync(directory) !== directory) invalid();
  }
  const marker = readCapacityPrivate(path.join(root, ".areaforge-capacity-fixture.json"), uid);
  const secret = readCapacityPrivate(path.join(root, ".fixture.private.json"), uid);
  const keys = ["schemaVersion", "fixtureKind", "databaseName", "containerName", "volumeName", "port", "image", "ownerUid", "ownerGid", "repositoryHash"];
  if (Object.keys(marker).length !== keys.length || keys.some(key => !(key in marker)) || marker.schemaVersion !== 1
    || marker.fixtureKind !== "capacity" || marker.ownerUid !== uid || marker.ownerGid !== gid
    || marker.repositoryHash !== createHash("sha256").update(realpathSync(repository)).digest("hex")) invalid();
  const suffix = String(marker.databaseName).match(/^areaforge_v20_capacity_([a-f0-9]{12})$/)?.[1];
  if (!suffix || marker.containerName !== `areaforge-v20-capacity-${suffix}` || marker.volumeName !== `areaforge-v20-capacity-${suffix}-data`
    || !Number.isSafeInteger(marker.port) || Number(marker.port) < 1024 || Number(marker.port) > 65535
    || !/^sha256:[a-f0-9]{64}$/.test(String(marker.image))) invalid();
  if (Object.keys(secret).length !== 3 || ["password", "sessionSecret", "actionSecret"].some(key => !/^[a-f0-9]{64}$/.test(String(secret[key])))
    || new Set(Object.values(secret)).size !== 3) invalid();
  return { root, databaseName: String(marker.databaseName), containerName: String(marker.containerName), volumeName: String(marker.volumeName),
    port: Number(marker.port), image: String(marker.image), ownerUid: uid, ownerGid: gid, operatorEmail: `operator-capacity-${suffix}@example.test`,
    scopeId: createHash("sha256").update(JSON.stringify(marker)).digest("hex"), password: String(secret.password),
    sessionSecret: String(secret.sessionSecret), actionSecret: String(secret.actionSecret) };
}

export const CAPACITY_FIXTURE_LIMITS = { maxSeats: "2", maxUserJobs: "2", maxWorkspaceJobs: "3", maxInstanceJobs: "4" } as const;
export function capacityQuotaEnvironment(enabled = true): Record<string, string> {
  return { DATA_JOB_TOTAL_QUOTA_ENABLED: enabled ? "true" : "false", WORKSPACE_MEMBER_QUOTA_ENABLED: enabled ? "true" : "false",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_USER: enabled ? CAPACITY_FIXTURE_LIMITS.maxUserJobs : "",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_WORKSPACE: enabled ? CAPACITY_FIXTURE_LIMITS.maxWorkspaceJobs : "",
    DATA_JOB_TOTAL_QUOTA_MAX_ACTIVE_INSTANCE: enabled ? CAPACITY_FIXTURE_LIMITS.maxInstanceJobs : "",
    WORKSPACE_MEMBER_QUOTA_MAX_SEATS: enabled ? CAPACITY_FIXTURE_LIMITS.maxSeats : "" };
}
export function capacityFixtureEnvironment(fixture: CapacityFixture): NodeJS.ProcessEnv {
  return { ...capacityToolEnvironment(), APP_ENV: "test", DATABASE_URL: `postgresql://fixture:${fixture.password}@127.0.0.1:${fixture.port}/${fixture.databaseName}`,
    DOTENV_CONFIG_PATH: path.join(fixture.root, ".fixture-env-disabled"), AREAFORGE_CAPACITY_ISOLATED_DB: "1",
    AREAFORGE_CAPACITY_FIXTURE_ROOT: fixture.root, AUTH_ADMIN_EMAIL: fixture.operatorEmail,
    AUTH_SESSION_SECRET: fixture.sessionSecret, AUTH_ACTION_TOKEN_SECRET: fixture.actionSecret, AUTH_MULTI_USER_ENABLED: "true", AUTH_RBAC_ENABLED: "true",
    SEARCH_INDEX_ENABLED: "true", SEARCH_INDEX_QUEUE_ENABLED: "true", DATA_JOB_WORKER_ENABLED: "true",
    RANKING_ENABLED: "true", RANKING_PROJECTION_ENABLED: "true", RANKING_REBUILD_QUEUE_ENABLED: "true",
    UPLOAD_DIR: path.join(fixture.root, "uploads"), EXPORT_DIR: path.join(fixture.root, "exports"),
    DATA_LIFECYCLE_ENABLED: "true", DATA_EXPORT_ENABLED: "true", DATA_DELETE_ENABLED: "false", DATA_DELETE_WORKER_ENABLED: "false",
    DATA_JOB_QUOTA_ENABLED: "false", ...capacityQuotaEnvironment(),
    OPS_EXECUTION_ENABLED: "false", OPS_AGENT_ENABLED: "false", OPS_AGENT_PRODUCTION_ENABLED: "false",
    PLATFORM_NOTIFICATIONS_ENABLED: "false", PLATFORM_NOTIFICATION_QUEUE_ENABLED: "false", AI_ENABLED: "false", AI_API_KEY: "",
    SMTP_HOST: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "" };
}

export function capacityToolEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "PNPM_HOME", "LANG", "LC_ALL", "DOCKER_HOST", "DOCKER_CONTEXT"]
    .flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
}

export function readCapacityPrivate(file: string, uid: number): Record<string, unknown> {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== uid || stat.mode & 0o077 || stat.size > 16_384) invalid();
    const value = JSON.parse(readFileSync(fd, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    return value;
  } finally { closeSync(fd); }
}

export async function verifyCapacityFixtureLedger(client: PrismaClient, fixture: CapacityFixture): Promise<number> {
  assertCapacityMigrationPreimage();
  const [database] = await client.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database?.name, fixture.databaseName);
  const root = path.resolve("prisma/migrations"); const expected = readdirSync(root).filter(name => /^\d+_/.test(name)).sort();
  assert.equal(expected.length, 54);
  const rows = await client.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null; rolledBack: Date | null; logs: string | null; steps: number }>>`
    SELECT migration_name AS name, checksum, finished_at AS finished, rolled_back_at AS "rolledBack", logs, applied_steps_count AS steps
    FROM "_prisma_migrations" ORDER BY started_at, migration_name`;
  assert.deepEqual(rows.map(row => row.name), expected);
  for (const row of rows) {
    assert.ok(row.finished); assert.equal(row.rolledBack, null); assert.ok(!row.logs); assert.equal(row.steps, 1);
    assert.equal(row.checksum, createHash("sha256").update(readFileSync(path.join(root, row.name, "migration.sql"))).digest("hex"));
  }
  return rows.length;
}

export function assertCapacityFixtureContainer(fixture: CapacityFixture): void {
  const env = capacityToolEnvironment();
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith("unix://")) invalid();
  if (!execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { env, encoding: "utf8" }).trim().startsWith("unix://")) invalid();
  const row = JSON.parse(execFileSync("docker", ["inspect", fixture.containerName], { env, encoding: "utf8" }))[0];
  if (row.Config.Labels?.["com.areaforge.fixture"] !== "capacity" || row.Config.Labels?.["com.areaforge.fixture.owner"] !== String(fixture.ownerUid)
    || row.Image !== fixture.image || row.Config.Env.filter((entry: string) => entry.startsWith("POSTGRES_DB=")).join() !== `POSTGRES_DB=${fixture.databaseName}`
    || !row.Mounts.some((mount: { Type: string; Name: string; Destination: string }) => mount.Type === "volume" && mount.Name === fixture.volumeName && mount.Destination === "/var/lib/postgresql/data")) invalid();
  const [volume] = JSON.parse(execFileSync("docker", ["volume", "inspect", fixture.volumeName], { env, encoding: "utf8" }));
  if (volume.Labels?.["com.areaforge.fixture"] !== "capacity" || volume.Labels?.["com.areaforge.fixture.owner"] !== String(fixture.ownerUid)) invalid();
  const port = execFileSync("docker", ["port", fixture.containerName, "5432/tcp"], { env, encoding: "utf8" }).trim();
  if (port !== `127.0.0.1:${fixture.port}`) invalid();
}
function invalid(): never { throw new Error("CAPACITY_FIXTURE_INVALID"); }
