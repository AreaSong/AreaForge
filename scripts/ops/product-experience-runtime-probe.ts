import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, findWorkspaceRoot } from "../../apps/web/lib/system/product-experience-source";
import { validateRuntimeIdentity } from "../../apps/web/lib/system/runtime-identity-core";

const timeoutMs = Number(process.env.AREAFORGE_EXPERIENCE_RUNTIME_TIMEOUT_MS ?? "5000");

async function main(): Promise<void> {
  const result = await runRuntimeProbe(process.argv[2], process.argv[3]);
  console.log(`product experience runtime identity probe passed: ${result.output}`);
  console.log(`runtimeIdentityHash: ${result.runtimeIdentityHash}`);
}

export async function runRuntimeProbe(
  rawBaseUrl: string | undefined,
  rawOutput: string | undefined,
): Promise<{ output: string; runtimeIdentityHash: string }> {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  const output = safeOutputPath(rawOutput);
  const response = await fetch(new URL("/api/health", baseUrl), {
    redirect: "manual",
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`runtime identity health request failed with HTTP ${response.status}`);
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("runtime identity health response must be JSON");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 16 * 1024) throw new Error("runtime identity health response exceeds 16384 bytes");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new Error("runtime identity health response must contain valid JSON");
  }
  if (body.ok !== true || body.service !== "AreaForge") throw new Error("health response is not AreaForge ok=true");
  const runtimeIdentity = validateRuntimeIdentity(body.runtimeIdentity);
  const record = {
    schemaVersion: 1,
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    observedAt: new Date().toISOString(),
    runtimeIdentity,
    responseHash: canonicalSha256({ ok: body.ok, service: body.service, version: body.version, runtimeIdentity }),
    safetyFacts: {
      requestMethod: "GET",
      productionWriteAttempted: false,
      serverCommandAttempted: false,
      secretValueIncluded: false,
    },
  };
  await atomicWriteJson(output, record);
  return { output, runtimeIdentityHash: runtimeIdentity.identityHash };
}

export function normalizeBaseUrl(
  raw: string | undefined,
  allowNonLocal = process.env.AREAFORGE_EXPERIENCE_RUNTIME_ALLOW_NON_LOCAL === "true",
): URL {
  if (!raw) throw new Error("Usage: pnpm experience:runtime:probe <baseUrl> <output.json>");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash) throw new Error("baseUrl must not contain credentials, query, or fragment");
  if (url.pathname !== "/" && url.pathname !== "") throw new Error("baseUrl must be an origin without a path");
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (!local && !allowNonLocal) {
    throw new Error("non-local runtime probe requires AREAFORGE_EXPERIENCE_RUNTIME_ALLOW_NON_LOCAL=true");
  }
  if (!local && url.protocol !== "https:") throw new Error("non-local runtime probe requires HTTPS");
  if (local && !["http:", "https:"].includes(url.protocol)) throw new Error("local runtime probe requires HTTP or HTTPS");
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  return url;
}

export function safeOutputPath(raw: string | undefined): string {
  if (!raw) throw new Error("Usage: pnpm experience:runtime:probe <baseUrl> <output.json>");
  if (path.isAbsolute(raw)) throw new Error("output must be a repo-relative JSON path");
  const root = findWorkspaceRoot();
  const output = path.resolve(root, raw);
  const relative = path.relative(root, output);
  if (relative.startsWith("..") || path.isAbsolute(relative) || path.extname(output) !== ".json") {
    throw new Error("output must be a repo-relative JSON path");
  }
  return output;
}

export async function atomicWriteJson(output: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, output);
    await unlink(temporary);
    const directory = await open(path.dirname(output), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
