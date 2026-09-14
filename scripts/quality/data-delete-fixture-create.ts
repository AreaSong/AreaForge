import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

async function main() {
  const root = process.argv[2];
  if (!root || !/^areaforge-v20-delete-[A-Za-z0-9]+$/.test(path.basename(root))) throw new Error("DATA_DELETE_FIXTURE_ROOT_INVALID");
  const stat = lstatSync(root);
  if (root !== realpathSync(root) || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))
    || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077) || readdirSync(root).length) {
    throw new Error("DATA_DELETE_FIXTURE_ROOT_INVALID");
  }
  const suffix = randomBytes(6).toString("hex");
  if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("DATA_DELETE_REMOTE_DOCKER_REFUSED");
  const endpoint = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
  if (!endpoint.startsWith("unix://")) throw new Error("DATA_DELETE_REMOTE_DOCKER_REFUSED");
  const databaseName = "areaforge_v20_delete_" + suffix;
  const containerName = "areaforge-v20-delete-" + suffix;
  const password = randomBytes(32).toString("hex");
  const image = execFileSync("docker", ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"], { encoding: "utf8" }).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("DATA_DELETE_FIXTURE_IMAGE_INVALID");
  for (const directory of ["uploads", "exports", "backup", "restored-uploads", "restored-exports"]) mkdirSync(path.join(root, directory), { mode: 0o700 });
  execFileSync("docker", ["run", "-d", "--name", containerName, "--label", "com.areaforge.fixture=data-delete",
    "--label", "com.areaforge.fixture.owner=" + process.getuid!(), "--cpus=2", "--memory=1g", "--tmpfs", "/var/lib/postgresql/data",
    "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=fixture", "-e", "POSTGRES_DB=" + databaseName,
    "-e", "POSTGRES_PASSWORD", image], { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"] });
  const mapping = execFileSync("docker", ["port", containerName, "5432/tcp"], { encoding: "utf8" }).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(mapping)) throw new Error("DATA_DELETE_FIXTURE_PORT_INVALID");
  const port = Number(mapping.split(":")[1]);
  const marker = { schemaVersion: 1, fixtureKind: "data-delete", databaseName, restoreDatabaseName: databaseName + "_restore",
    containerName, image, port, ownerUid: process.getuid!(), ownerGid: process.getgid!(),
    repositoryHash: createHash("sha256").update(realpathSync(process.cwd())).digest("hex") };
  writeFileSync(path.join(root, ".areaforge-data-delete-fixture.json"), JSON.stringify(marker), { mode: 0o600, flag: "wx" });
  writeFileSync(path.join(root, ".fixture.private.json"), JSON.stringify({ password, sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { mode: 0o600, flag: "wx" });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { execFileSync("docker", ["exec", containerName, "pg_isready", "-U", "fixture", "-d", databaseName], { stdio: "ignore" }); ready = true; break; }
    catch { await delay(500); }
  }
  if (!ready) throw new Error("DATA_DELETE_FIXTURE_NOT_READY");
  console.log(JSON.stringify({ created: true, containerName, databaseName, port, image, productionTouched: false }));
}

main().catch(() => { console.error("DATA_DELETE_FIXTURE_CREATE_FAILED; preserve the registered fixture for inspection"); process.exitCode = 1; });
