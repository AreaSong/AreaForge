import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { operationToolEnvironment } from "./controlled-operation-fixture";

async function main() {
  const root = process.argv[2];
  if (!root || !/^areaforge-v20-ops-[A-Za-z0-9]+$/.test(path.basename(root))) throw new Error("INVALID_ROOT");
  const stat = lstatSync(root);
  if (root !== realpathSync(root) || ![realpathSync(tmpdir()), realpathSync("/tmp")].includes(path.dirname(root))
    || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || stat.mode & 0o077 || readdirSync(root).length) throw new Error("INVALID_ROOT");
  const env = operationToolEnvironment();
  if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith("unix://")) throw new Error("REMOTE_DOCKER");
  if (!execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { env, encoding: "utf8" }).trim().startsWith("unix://")) throw new Error("REMOTE_DOCKER");
  const suffix = randomBytes(6).toString("hex"); const databaseName = `areaforge_v20_ops_${suffix}`; const containerName = `areaforge-v20-ops-${suffix}`;
  const password = randomBytes(32).toString("hex");
  const image = execFileSync("docker", ["image", "inspect", "postgres:16-alpine", "--format", "{{.Id}}"], { env, encoding: "utf8" }).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("IMAGE_INVALID");
  for (const name of ["uploads", "exports", "context", "agent"]) mkdirSync(path.join(root, name), { mode: 0o700 });
  execFileSync("docker", ["run", "-d", "--name", containerName, "--label", "com.areaforge.fixture=controlled-operation",
    "--label", `com.areaforge.fixture.owner=${process.getuid!()}`, "--cpus=2", "--memory=1g", "--tmpfs", "/var/lib/postgresql/data",
    "-p", "127.0.0.1::5432", "-e", "POSTGRES_USER=fixture", "-e", `POSTGRES_DB=${databaseName}`, "-e", "POSTGRES_PASSWORD", image],
  { env: { ...env, POSTGRES_PASSWORD: password }, stdio: ["ignore", "pipe", "pipe"] });
  const mapping = execFileSync("docker", ["port", containerName, "5432/tcp"], { env, encoding: "utf8" }).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(mapping)) throw new Error("PORT_INVALID");
  const marker = { schemaVersion: 1, fixtureKind: "controlled-operation", databaseName, containerName, port: Number(mapping.split(":")[1]), image,
    ownerUid: process.getuid!(), ownerGid: process.getgid!(), repositoryHash: createHash("sha256").update(realpathSync(process.cwd())).digest("hex"),
    operatorEmail: `ops-${suffix}@example.test` };
  writeFileSync(path.join(root, ".areaforge-ops-fixture.json"), JSON.stringify(marker), { flag: "wx", mode: 0o600 });
  writeFileSync(path.join(root, ".fixture.private.json"), JSON.stringify({ password, sessionSecret: randomBytes(32).toString("hex"), actionSecret: randomBytes(32).toString("hex") }), { flag: "wx", mode: 0o600 });
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      execFileSync("docker", ["exec", containerName, "pg_isready", "-U", "fixture", "-d", databaseName], { env, stdio: "ignore" });
      console.log(JSON.stringify({ created: true, containerName, databaseName, port: marker.port, image, productionTouched: false })); return;
    } catch { await delay(500); }
  }
  throw new Error("POSTGRES_NOT_READY");
}
main().catch(() => { console.error("CONTROLLED_OPERATION_FIXTURE_CREATE_FAILED; preserve registered resources"); process.exitCode = 1; });
