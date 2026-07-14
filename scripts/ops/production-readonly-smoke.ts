import { readFileSync } from "node:fs";

type SmokeResult = {
  name: string;
  ok: boolean;
  detail: string;
  durationMs: number;
};

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  cookie?: string;
  expect?: (body: unknown, response: Response) => string | null;
};

const timeoutMs = Number(process.env.AREAFORGE_SMOKE_TIMEOUT_MS ?? "10000");
const baseUrl = normalizeBaseUrl(
  process.env.AREAFORGE_SMOKE_BASE_URL ??
    process.env.APP_URL ??
    baseUrlFromHealthUrl(process.env.AREAFORGE_HEALTH_URL) ??
    `http://127.0.0.1:${process.env.WEB_PORT ?? "3000"}`,
);
const expectedVersion = process.env.AREAFORGE_SMOKE_EXPECTED_VERSION ?? process.env.APP_VERSION;
const expectedAutoApply = process.env.AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY;
const smokeEmail = process.env.AREAFORGE_SMOKE_EMAIL;
const smokePassword = readSmokePassword();
const attachmentId = process.env.AREAFORGE_SMOKE_ATTACHMENT_ID;

const results: SmokeResult[] = [];

async function main(): Promise<void> {
  if (!smokeEmail) {
    failConfig("AREAFORGE_SMOKE_EMAIL is required");
  }
  if (!smokePassword) {
    failConfig("AREAFORGE_SMOKE_PASSWORD or AREAFORGE_SMOKE_PASSWORD_FILE is required");
  }

  await check("health", async () => {
    await requestJson("/api/health", {
      expect: (body) => {
        const data = asRecord(body);
        if (data.ok !== true) return "health ok must be true";
        if (data.service !== "AreaForge") return "health service must be AreaForge";
        if (expectedVersion && data.version !== expectedVersion) {
          return `expected version ${expectedVersion}, got ${String(data.version)}`;
        }
        return null;
      },
    });
  });

  let cookie = "";
  await check("login", async () => {
    const response = await requestJson("/api/auth/login", {
      method: "POST",
      body: { email: smokeEmail, password: smokePassword },
      expect: (body) => {
        const user = asRecord(asRecord(body).user);
        return typeof user.email === "string" ? null : "login response missing user.email";
      },
    });
    cookie = cookieFrom(response);
    if (!cookie) throw new Error("login did not return a session cookie");
  });

  await checkJson("auth/me", "/api/auth/me", cookie, (body) => {
    const user = asRecord(asRecord(body).user);
    return typeof user.email === "string" ? null : "auth/me missing user.email";
  });
  await checkJson("dashboard", "/api/dashboard/today", cookie, (body) =>
    asRecord(body).dashboard ? null : "dashboard payload missing");
  await checkJson("notes", "/api/notes", cookie, (body) =>
    Array.isArray(asRecord(body).notes) ? null : "notes must be an array");
  await checkJson("syllabus", "/api/syllabus", cookie, (body) =>
    typeof body === "object" && body !== null ? null : "syllabus payload missing");
  await checkJson("analytics", "/api/analytics/summary", cookie, (body) =>
    asRecord(body).analytics ? null : "analytics payload missing");
  await checkJson("reports", "/api/reports/periodic", cookie, (body) =>
    asRecord(body).reports ? null : "reports payload missing");
  await checkJson("long-term-risks", "/api/analytics/long-term-risks", cookie, (body) =>
    asRecord(body).longTermRisks ? null : "longTermRisks payload missing");
  await checkJson("update-status", "/api/system/update-status", cookie, (body) => {
    const status = asRecord(asRecord(body).status);
    if (expectedAutoApply && status.autoApply !== expectedAutoApply) {
      return `expected autoApply ${expectedAutoApply}, got ${String(status.autoApply)}`;
    }
    return typeof status.currentVersion === "string" ? null : "update status missing currentVersion";
  });

  if (attachmentId) {
    await check("attachment-download", async () => {
      const response = await requestRaw(`/api/attachments/${encodeURIComponent(attachmentId)}?disposition=inline`, {
        cookie,
      });
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength <= 0) throw new Error("attachment response was empty");
    });
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail} (${result.durationMs}ms)`);
  }
  console.log(JSON.stringify({
    ok: failed.length === 0,
    baseUrl,
    checkedAt: new Date().toISOString(),
    checks: results.map((result) => ({
      name: result.name,
      ok: result.ok,
      durationMs: result.durationMs,
    })),
  }));

  if (failed.length > 0) {
    process.exit(1);
  }
}

async function checkJson(
  name: string,
  path: string,
  cookie: string,
  expect: (body: unknown) => string | null,
): Promise<void> {
  await check(name, async () => {
    await requestJson(path, {
      cookie,
      expect: (body) => expect(body),
    });
  });
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, detail: "ok", durationMs: Date.now() - startedAt });
  } catch (error) {
    results.push({
      name,
      ok: false,
      detail: error instanceof Error ? redact(error.message) : "unknown error",
      durationMs: Date.now() - startedAt,
    });
  }
}

async function requestJson(path: string, options: RequestOptions = {}): Promise<Response> {
  const response = await requestRaw(path, options);
  const body = await response.json().catch(() => null);
  const issue = options.expect?.(body, response);
  if (issue) throw new Error(issue);
  return response;
}

async function requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${path}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function cookieFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookie = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return setCookie
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function readSmokePassword(): string | undefined {
  const passwordFile = process.env.AREAFORGE_SMOKE_PASSWORD_FILE;
  if (passwordFile) {
    try {
      return readFileSync(passwordFile, "utf8").trim();
    } catch {
      failConfig(`cannot read AREAFORGE_SMOKE_PASSWORD_FILE at ${passwordFile}`);
    }
  }
  return process.env.AREAFORGE_SMOKE_PASSWORD;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function baseUrlFromHealthUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/api\/health\/?$/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function redact(value: string): string {
  let output = value;
  if (smokePassword) {
    output = output.replace(new RegExp(escapeRegExp(smokePassword), "g"), "<redacted>");
  }
  return output
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function failConfig(message: string): never {
  console.error(`FAIL config: ${message}`);
  process.exit(2);
}

main().catch((error) => {
  console.error(`FAIL smoke: ${error instanceof Error ? redact(error.message) : "unknown error"}`);
  process.exit(1);
});
