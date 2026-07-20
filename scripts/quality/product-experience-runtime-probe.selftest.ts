import { createServer, type ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createDevelopmentRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-development";
import { getRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity";
import {
  normalizeBaseUrl,
  runRuntimeProbe,
  safeOutputPath,
} from "../ops/product-experience-runtime-probe";

const root = process.cwd();
const developmentRuntimeIdentity = createDevelopmentRuntimeIdentity(root);
mkdirSync(path.join(root, "output"), { recursive: true });
const tempDir = mkdtempSync(path.join(root, "output/.tmp-runtime-probe-"));
let mode = "valid";
const server = createServer((request, response) => {
  if (request.url !== "/api/health" || request.method !== "GET") {
    response.writeHead(404).end();
    return;
  }
  respond(response, mode);
});

try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not expose a TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const output = path.relative(root, path.join(tempDir, "runtime-identity.json"));

  mode = "valid";
  await runRuntimeProbe(baseUrl, output);
  const written = JSON.parse(readFileSync(path.join(root, output), "utf8")) as Record<string, unknown>;
  assert(written.schemaVersion === 1 && written.baseUrl === baseUrl, "valid probe must write exact local origin evidence");
  const original = readFileSync(path.join(root, output), "utf8");
  await expectReject("existing output no-clobber", () => runRuntimeProbe(baseUrl, output), "EEXIST");
  assert(readFileSync(path.join(root, output), "utf8") === original, "no-clobber failure must preserve existing evidence");

  for (const [caseMode, expected] of [
    ["redirect", "HTTP 302"],
    ["server-error", "HTTP 500"],
    ["wrong-content-type", "must be JSON"],
    ["invalid-json", "valid JSON"],
    ["oversized", "exceeds 16384 bytes"],
    ["unavailable", "unavailable"],
    ["identity-hash-mismatch", "hash mismatch"],
  ] as const) {
    mode = caseMode;
    await expectReject(caseMode, () => runRuntimeProbe(baseUrl, path.relative(root, path.join(tempDir, `${caseMode}.json`))), expected);
  }

  for (const value of [
    "http://user:pass@127.0.0.1:3000",
    "http://127.0.0.1:3000/path",
    "http://127.0.0.1:3000?query=1",
    "http://127.0.0.1:3000#fragment",
  ]) expectThrow(`unsafe baseUrl ${value}`, () => normalizeBaseUrl(value), "baseUrl");
  expectThrow("non-local requires opt-in", () => normalizeBaseUrl("https://example.com"), "ALLOW_NON_LOCAL");
  expectThrow("non-local requires HTTPS", () => normalizeBaseUrl("http://example.com", true), "requires HTTPS");
  expectThrow("output traversal", () => safeOutputPath("../runtime.json"), "repo-relative");
  expectThrow("absolute output", () => safeOutputPath(path.join(tempDir, "absolute.json")), "repo-relative");
  expectThrow("non-json output", () => safeOutputPath("output/runtime.txt"), "repo-relative");

  console.log("product experience runtime probe selftest passed.");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
}

function respond(response: ServerResponse, responseMode: string): void {
  if (responseMode === "redirect") {
    response.writeHead(302, { location: "/api/health" }).end();
    return;
  }
  if (responseMode === "server-error") {
    response.writeHead(500, { "content-type": "application/json" }).end("{}\n");
    return;
  }
  if (responseMode === "wrong-content-type") {
    response.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
    return;
  }
  if (responseMode === "invalid-json") {
    response.writeHead(200, { "content-type": "application/json" }).end("{invalid\n");
    return;
  }
  if (responseMode === "oversized") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ padding: "x".repeat(17 * 1024) }));
    return;
  }
  const runtimeIdentity = getRuntimeIdentity(new Date(), developmentRuntimeIdentity);
  const body: Record<string, unknown> = {
    ok: true,
    service: "AreaForge",
    version: runtimeIdentity.appVersion,
    runtimeIdentity,
  };
  if (responseMode === "unavailable") {
    body.runtimeIdentity = { ...runtimeIdentity, status: "unavailable", reasonCode: "RUNTIME_IDENTITY_INVALID" };
  }
  if (responseMode === "identity-hash-mismatch") {
    body.runtimeIdentity = { ...runtimeIdentity, identityHash: `sha256:${"0".repeat(64)}` };
  }
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(`${JSON.stringify(body)}\n`);
}

async function expectReject(label: string, action: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expected)) return;
    throw new Error(`FAIL ${label}: expected ${expected}, got ${message}`);
  }
  throw new Error(`FAIL ${label}: expected rejection`);
}

function expectThrow(label: string, action: () => unknown, expected: string): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expected)) return;
    throw new Error(`FAIL ${label}: expected ${expected}, got ${message}`);
  }
  throw new Error(`FAIL ${label}: expected throw`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}
