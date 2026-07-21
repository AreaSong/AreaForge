import { chmodSync, linkSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";

const repositoryRoot = process.cwd();
const scriptPath = path.join(repositoryRoot, "scripts/ops/local-ux-smoke.ts");
const source = readFileSync(scriptPath, "utf8");
const passwordSource = readFileSync(path.join(repositoryRoot, "scripts/ops/smoke-password.ts"), "utf8");
const productionSmokeSource = readFileSync(path.join(repositoryRoot, "scripts/ops/production-readonly-smoke.ts"), "utf8");

assert(source.indexOf('assertNoActiveSession("active session preflight"') < source.indexOf('"create syllabus node"'),
  "active session preflight must happen before the first business write");
assert(source.includes('assertNoActiveSession("active session before synthetic writes"'),
  "synthetic writes need a second active-session guard");
assert(source.includes("process.env.AREAFORGE_SMOKE_ALLOW_NON_LOCAL !== undefined"),
  "legacy non-local override must be rejected explicitly");
assert(!source.includes("const allowNonLocal"), "non-local override must not remain an executable option");
assert(passwordSource.includes("fstatSync") && passwordSource.includes("metadata.nlink !== 1"),
  "password file must be checked as a single regular inode");
assert(passwordSource.includes("(metadata.mode & 0o077) !== 0"),
  "password file must reject group/world permissions");
assert(source.includes("process.env.AREAFORGE_SMOKE_PASSWORD !== undefined"),
  "plain password environment variable must fail closed");
assert(productionSmokeSource.includes("readRestrictedSmokePassword")
  && productionSmokeSource.includes("process.env.AREAFORGE_SMOKE_PASSWORD !== undefined"),
"production read-only smoke must share the restricted password boundary");
assert(source.includes("detail: result.detail"), "structured report must retain redacted failure details");
assert(source.includes('recordFailure("fatal", error)'), "unexpected failures must use the structured report path");
assert(source.includes('batch8 app shell nav isolation'), "Batch 8 App Shell nav isolation check must remain");
assert(source.includes('startSource: "SUBJECT_SHORTCUT"'), "Batch 7 subject shortcut start path must remain");
assert(source.includes('href="/motivation"'), "Shell isolation must reject motivation nav href");
assert(source.includes('href="/stage"'), "Shell isolation must keep stage hidden until Batch 10");
assert(source.includes("batch9 settings openings"), "Batch 9 must smoke settings profile/notifications/ai");
assert(!source.includes("'href=\"/settings/notifications\"'"), "Batch 9 opens notifications settings; must not forbid that href in shell isolation");
assert(source.includes('href="/knowledge/canvas"'), "Batch 8 must require knowledge canvas nav href");
assert(source.includes("batch8 knowledge canvas api"), "Batch 8 knowledge canvas API smoke must remain");

const canvasClientSource = readFileSync(
  path.join(repositoryRoot, "apps/web/components/knowledge-canvas-client.tsx"),
  "utf8",
);
assert(
  canvasClientSource.includes("canMutateKnowledgeCanvasLayout"),
  "Batch 8 canvas client must gate layout mutation via canMutateKnowledgeCanvasLayout",
);
assert(
  canvasClientSource.includes("布局编辑仅桌面可用"),
  "Batch 8 canvas client must keep mobile read-only layout copy",
);
assert(
  !canvasClientSource.includes("/api/notes") && !canvasClientSource.includes("/api/mistakes"),
  "Batch 8 quick create must not invent canvas-private write APIs",
);

await main();

async function main(): Promise<void> {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "areaforge-local-ux-selftest-"));
  try {
    const secureFile = path.join(tempDir, "password");
    writeFileSync(secureFile, "synthetic-secret-value\n", { mode: 0o600 });
    chmodSync(secureFile, 0o600);

    const nonLocal = runSmoke({
      AREAFORGE_SMOKE_BASE_URL: "https://forge.areasong.top",
      AREAFORGE_SMOKE_PASSWORD_FILE: secureFile,
    });
    assertConfigFailure(nonLocal, "local URL boundary");

    const override = runSmoke({
      AREAFORGE_SMOKE_ALLOW_NON_LOCAL: "false",
      AREAFORGE_SMOKE_PASSWORD_FILE: secureFile,
    });
    assertConfigFailure(override, "legacy non-local override boundary");

    const plainEnv = runSmoke({
      AREAFORGE_SMOKE_PASSWORD: "synthetic-secret-value",
    });
    assertConfigFailure(plainEnv, "plain password environment boundary");
    assert(!plainEnv.output.includes("synthetic-secret-value"), "config output must not echo a password");

    const relativeFile = runSmoke({ AREAFORGE_SMOKE_PASSWORD_FILE: "relative/password" });
    assertConfigFailure(relativeFile, "password file path boundary");

    const worldReadable = path.join(tempDir, "world-readable");
    writeFileSync(worldReadable, "synthetic-secret-value\n", { mode: 0o644 });
    chmodSync(worldReadable, 0o644);
    const weakFile = runSmoke({ AREAFORGE_SMOKE_PASSWORD_FILE: worldReadable });
    assertConfigFailure(weakFile, "password file permission boundary");

    const symlink = path.join(tempDir, "password-link");
    symlinkSync(secureFile, symlink);
    const linkedFile = runSmoke({ AREAFORGE_SMOKE_PASSWORD_FILE: symlink });
    assertConfigFailure(linkedFile, "password file symlink boundary");
    assert(lstatSync(symlink).isSymbolicLink(), "symlink fixture must remain a symlink");

    const hardlink = path.join(tempDir, "password-hardlink");
    linkSync(secureFile, hardlink);
    const linkedInode = runSmoke({ AREAFORGE_SMOKE_PASSWORD_FILE: hardlink });
    assertConfigFailure(linkedInode, "password file hardlink boundary");

    const activePassword = path.join(tempDir, "active-password");
    writeFileSync(activePassword, "synthetic-secret-value\n", { mode: 0o600 });
    chmodSync(activePassword, 0o600);
    await assertActiveSessionStopsWrites(activePassword);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("local UX smoke selftest passed.");
}

function runSmoke(overrides: Record<string, string>): { output: string; status: number } {
  const environment = { ...process.env };
  delete environment.AREAFORGE_SMOKE_PASSWORD;
  delete environment.AREAFORGE_SMOKE_PASSWORD_FILE;
  delete environment.AREAFORGE_SMOKE_ALLOW_NON_LOCAL;
  environment.AREAFORGE_SMOKE_ALLOW_WRITES = "true";
  environment.AREAFORGE_SMOKE_EMAIL = "smoke@areasong.local";
  Object.assign(environment, overrides);
  try {
    const output = execFileSync("pnpm", ["exec", "tsx", scriptPath], {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { output, status: 0 };
  } catch (error) {
    const child = error as { status?: number; stdout?: string; stderr?: string };
    return {
      output: `${child.stdout ?? ""}${child.stderr ?? ""}`,
      status: typeof child.status === "number" ? child.status : 1,
    };
  }
}

async function assertActiveSessionStopsWrites(passwordFile: string): Promise<void> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? "GET"} ${request.url ?? ""}`);
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/api/health") {
      response.end(JSON.stringify({ ok: true, service: "AreaForge" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/auth/login") {
      response.setHeader("set-cookie", "session=selftest; Path=/; HttpOnly");
      response.end(JSON.stringify({ user: { email: "smoke@areasong.local" } }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/study-sessions/active") {
      response.end(JSON.stringify({ session: { id: "existing-session" } }));
      return;
    }
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "unexpected selftest request" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address();
    assert(address && typeof address !== "string", "selftest server must expose a TCP address");
    const result = await runSmokeAsync({
      AREAFORGE_SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
      AREAFORGE_SMOKE_PASSWORD_FILE: passwordFile,
    });
    assertStructuredFailure(result, "active-session preflight", "active session preflight");
    const businessWrites = requests.filter((entry) => entry.startsWith("POST ") && entry !== "POST /api/auth/login");
    assert(businessWrites.length === 0, "active-session preflight must stop before every synthetic business POST");
    assert(requests.includes("GET /api/study-sessions/active"), "active-session fixture must be reached");
    const report = parseReport(result.output);
    assert(report.checks?.some((check) => check.name === "active session preflight" && check.ok === false) === true,
      "active session must be the failed check, not only a generic fatal result");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function runSmokeAsync(overrides: Record<string, string>): Promise<{ output: string; status: number }> {
  const environment = { ...process.env };
  delete environment.AREAFORGE_SMOKE_PASSWORD;
  delete environment.AREAFORGE_SMOKE_PASSWORD_FILE;
  delete environment.AREAFORGE_SMOKE_ALLOW_NON_LOCAL;
  environment.AREAFORGE_SMOKE_ALLOW_WRITES = "true";
  environment.AREAFORGE_SMOKE_EMAIL = "smoke@areasong.local";
  Object.assign(environment, overrides);

  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "tsx", scriptPath], {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.on("close", (status) => resolve({ output, status: status ?? 1 }));
    child.on("error", () => resolve({ output, status: 1 }));
  });
}

function assertConfigFailure(result: { output: string; status: number }, label: string): void {
  assertStructuredFailure(result, label, "config");
}

function assertStructuredFailure(result: { output: string; status: number }, label: string, checkName: string): void {
  assert(result.status !== 0, `${label} must fail closed`);
  const report = parseReport(result.output);
  assert(report.ok === false, `${label} must emit a failed structured report`);
  assert(report.checks?.some((check) => check.name === checkName && check.ok === false) === true,
    `${label} must identify the ${checkName} failure; checks=${JSON.stringify(report.checks ?? [])}`);
}

function parseReport(output: string): { ok?: boolean; checks?: Array<{ name?: string; ok?: boolean }> } {
  const jsonLine = output.trim().split("\n").reverse()
    .find((line) => line.trim().startsWith("{") && line.trim().endsWith("}")) ?? "";
  return JSON.parse(jsonLine) as { ok?: boolean; checks?: Array<{ name?: string; ok?: boolean }> };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
