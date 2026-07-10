import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type Status = "pass" | "warn" | "fail" | "blocked" | "unknown";
export type ReadinessScope = "daily" | "release" | "update" | "migration" | "rollback";

export type Signal = {
  status: Status;
  evidence: string;
  residualRiskIds?: string[];
  data?: Record<string, unknown>;
};

export type OperationalReadinessSummary = {
  checkedAt: string;
  environment: string;
  scope: ReadinessScope;
  baseUrl: string | null;
  safetyFacts: {
    serverCommandAttempted: false;
    backupRestoreAttempted: false;
    migrationAttempted: false;
    productionWriteAttempted: false;
    secretValuePrinted: false;
    smokePasswordReadFromFile: boolean;
    networkRequested: boolean;
  };
  expected: {
    version: string | null;
    releaseTag: string | null;
    autoApply: string | null;
  };
  signals: {
    health: Signal;
    releaseIdentity: Signal;
    updateAgent: Signal;
    authenticatedSmoke: Signal;
    backup: Signal;
    rollback: Signal;
    infrastructure: Signal;
  };
  residualRiskIds: string[];
  overall: Status;
};

type UpdateStatus = {
  currentVersion?: string;
  currentImage?: string | null;
  releaseUrl?: string | null;
  latestVersion?: string | null;
  updateAvailable?: boolean;
  autoApply?: string;
  signatureRequired?: boolean;
  timerEnabled?: boolean | null;
  timerActive?: boolean | null;
  lastCheckedAt?: string | null;
  blocker?: string | null;
  rollback?: {
    available?: boolean;
    targetVersion?: string | null;
    targetImage?: string | null;
  };
  statusUpdatedAt?: string | null;
};

const timeoutMs = Number(process.env.AREAFORGE_READINESS_TIMEOUT_MS ?? "10000");
const scope = normalizeScope(process.env.AREAFORGE_READINESS_SCOPE);
const environment = process.env.AREAFORGE_READINESS_ENVIRONMENT ?? process.env.APP_ENV ?? "unknown";
const baseUrl = maybeNormalizeBaseUrl(
  process.env.AREAFORGE_READINESS_BASE_URL ??
    process.env.AREAFORGE_SMOKE_BASE_URL ??
    process.env.APP_URL ??
    baseUrlFromHealthUrl(process.env.AREAFORGE_HEALTH_URL),
);
const expectedVersion = process.env.AREAFORGE_READINESS_EXPECTED_VERSION ?? process.env.AREAFORGE_SMOKE_EXPECTED_VERSION ?? process.env.APP_VERSION ?? null;
const expectedReleaseTag = process.env.AREAFORGE_READINESS_RELEASE_TAG ?? (expectedVersion ? versionTag(expectedVersion) : null);
const expectedAutoApply = process.env.AREAFORGE_READINESS_EXPECTED_AUTO_APPLY ?? process.env.AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY ?? null;
const expectedWebDigest = process.env.AREAFORGE_READINESS_WEB_IMAGE_DIGEST ?? null;
const expectedMigrationDigest = process.env.AREAFORGE_READINESS_MIGRATION_IMAGE_DIGEST ?? null;

export async function collectOperationalReadinessSummary(): Promise<OperationalReadinessSummary> {
  const health = await collectHealth();
  const updateStatus = await collectUpdateStatus();
  const releaseIdentity = collectReleaseIdentity(health, updateStatus);
  const authenticatedSmoke = collectAuthenticatedSmoke();
  const backup = collectBackup();
  const rollback = collectRollback(updateStatus);
  const infrastructure = collectInfrastructure();
  const signals = {
    health,
    releaseIdentity,
    updateAgent: updateStatusToSignal(updateStatus),
    authenticatedSmoke,
    backup,
    rollback,
    infrastructure,
  };
  const residualRiskIds = unique(Object.values(signals).flatMap((signal) => signal.residualRiskIds ?? []));
  return {
    checkedAt: new Date().toISOString(),
    environment,
    scope,
    baseUrl,
    safetyFacts: buildSafetyFacts(),
    expected: {
      version: expectedVersion,
      releaseTag: expectedReleaseTag,
      autoApply: expectedAutoApply,
    },
    signals,
    residualRiskIds,
    overall: overallStatus(Object.values(signals)),
  };
}

async function main(): Promise<void> {
  const summary = await collectOperationalReadinessSummary();

  console.log(JSON.stringify(summary, null, 2));

  const failOn = process.env.AREAFORGE_READINESS_FAIL_ON;
  if (failOn && shouldFail(summary.overall, failOn)) {
    process.exit(1);
  }
}

function buildSafetyFacts(): OperationalReadinessSummary["safetyFacts"] {
  return {
    serverCommandAttempted: false,
    backupRestoreAttempted: false,
    migrationAttempted: false,
    productionWriteAttempted: false,
    secretValuePrinted: false,
    smokePasswordReadFromFile: Boolean(process.env.AREAFORGE_SMOKE_PASSWORD_FILE),
    networkRequested: Boolean(baseUrl),
  };
}

async function collectHealth(): Promise<Signal> {
  if (!baseUrl) {
    return {
      status: "unknown",
      evidence: "AREAFORGE_READINESS_BASE_URL, AREAFORGE_SMOKE_BASE_URL, APP_URL, or AREAFORGE_HEALTH_URL is not set",
    };
  }

  try {
    const body = asRecord(await requestJson("/api/health"));
    const version = typeof body.version === "string" ? body.version : null;
    if (body.ok !== true || body.service !== "AreaForge") {
      return { status: "fail", evidence: "health response did not identify AreaForge", data: safeHealthData(body) };
    }
    if (expectedVersion && version !== expectedVersion) {
      return {
        status: "fail",
        evidence: `expected version ${expectedVersion}, got ${version ?? "missing"}`,
        data: safeHealthData(body),
      };
    }
    return { status: "pass", evidence: `GET ${baseUrl}/api/health returned AreaForge ${version ?? "unknown"}`, data: safeHealthData(body) };
  } catch (error) {
    return { status: "fail", evidence: redact(error instanceof Error ? error.message : "health check failed") };
  }
}

async function collectUpdateStatus(): Promise<UpdateStatus | null> {
  const statusFile = process.env.AREAFORGE_READINESS_UPDATE_STATUS_FILE;
  if (statusFile) {
    try {
      return normalizeStatusJson(JSON.parse(readFileSync(statusFile, "utf8")));
    } catch (error) {
      return {
        blocker: redact(error instanceof Error ? `cannot read status file: ${error.message}` : "cannot read status file"),
      };
    }
  }

  const smokeEmail = process.env.AREAFORGE_SMOKE_EMAIL;
  const smokePassword = readSmokePassword();
  if (!baseUrl || !smokeEmail || !smokePassword) return null;

  try {
    const loginResponse = await requestRaw("/api/auth/login", {
      method: "POST",
      body: { email: smokeEmail, password: smokePassword },
    });
    const cookie = cookieFrom(loginResponse);
    if (!cookie) return { blocker: "login succeeded without session cookie" };
    const body = await requestJson("/api/system/update-status", cookie);
    return normalizeStatusJson(body);
  } catch (error) {
    return {
      blocker: redact(error instanceof Error ? error.message : "update status check failed"),
    };
  }
}

function collectReleaseIdentity(health: Signal, status: UpdateStatus | null): Signal {
  const data: Record<string, unknown> = {
    releaseTag: expectedReleaseTag,
    webImageDigest: expectedWebDigest,
    migrationImageDigest: expectedMigrationDigest,
    currentVersion: status?.currentVersion ?? null,
    currentImage: status?.currentImage ?? null,
    releaseUrl: status?.releaseUrl ?? null,
  };
  const missing: string[] = [];
  if (!expectedReleaseTag) missing.push("release tag");
  if (!expectedWebDigest) missing.push("web image digest");
  if (!expectedMigrationDigest) missing.push("migration image digest");

  const digestIssues = [
    expectedWebDigest && !isDigest(expectedWebDigest) ? "web image digest is not immutable image@sha256" : null,
    expectedMigrationDigest && !isDigest(expectedMigrationDigest) ? "migration image digest is not immutable image@sha256" : null,
  ].filter(Boolean);

  if (digestIssues.length > 0) {
    return { status: "fail", evidence: digestIssues.join("; "), data };
  }
  if (health.status === "fail") {
    return { status: "warn", evidence: "release identity cannot be fully trusted while health fails", data };
  }
  if (missing.length > 0) {
    return {
      status: scope === "daily" ? "warn" : "fail",
      evidence: `missing ${missing.join(", ")}`,
      residualRiskIds: ["AF-RISK-SC-001"],
      data,
    };
  }
  return { status: "pass", evidence: "release tag and immutable image digests are present", data };
}

function updateStatusToSignal(status: UpdateStatus | null): Signal {
  if (!status) {
    return {
      status: "unknown",
      evidence: "update status not collected; provide AREAFORGE_READINESS_UPDATE_STATUS_FILE or smoke credentials",
      residualRiskIds: ["AF-RISK-OPS-001"],
    };
  }
  if (status.blocker) {
    return { status: "blocked", evidence: `update-agent blocker: ${redact(status.blocker)}`, data: safeUpdateData(status) };
  }
  if (expectedAutoApply && status.autoApply !== expectedAutoApply) {
    return {
      status: "warn",
      evidence: `expected autoApply ${expectedAutoApply}, got ${status.autoApply ?? "missing"}`,
      residualRiskIds: ["AF-RISK-REL-001"],
      data: safeUpdateData(status),
    };
  }
  if (status.signatureRequired !== true) {
    return { status: "blocked", evidence: "signatureRequired is not true", data: safeUpdateData(status) };
  }
  if (status.timerEnabled === false || status.timerActive === false) {
    return { status: "warn", evidence: "update-agent timer is not fully active", data: safeUpdateData(status) };
  }
  return { status: "pass", evidence: "update-agent status has no blocker and signature is required", data: safeUpdateData(status) };
}

function collectAuthenticatedSmoke(): Signal {
  const smokeFile = process.env.AREAFORGE_READINESS_SMOKE_RESULT_FILE;
  if (!smokeFile) {
    return {
      status: "warn",
      evidence: "no authenticated smoke result supplied; run pnpm smoke:prod-readonly or set AREAFORGE_READINESS_SMOKE_RESULT_FILE",
      residualRiskIds: ["AF-RISK-OPS-001"],
    };
  }
  try {
    const smoke = parseLastJson(readFileSync(smokeFile, "utf8"));
    const ok = asRecord(smoke).ok === true;
    return {
      status: ok ? "pass" : "fail",
      evidence: ok ? "authenticated smoke result file reports ok=true" : "authenticated smoke result file reports failure",
      data: {
        checkedAt: asRecord(smoke).checkedAt ?? null,
        checks: asRecord(smoke).checks ?? null,
      },
    };
  } catch (error) {
    return { status: "warn", evidence: redact(error instanceof Error ? error.message : "cannot parse smoke result"), residualRiskIds: ["AF-RISK-OPS-001"] };
  }
}

function collectBackup(): Signal {
  const evidence = process.env.AREAFORGE_READINESS_BACKUP_EVIDENCE;
  if (!evidence) {
    return {
      status: criticalScope() ? "blocked" : "unknown",
      evidence: "backup freshness evidence not supplied",
      residualRiskIds: criticalScope() ? [] : ["AF-RISK-OPS-004"],
    };
  }
  if (!/sha256[:=][a-f0-9]{64}/i.test(evidence)) {
    return { status: "warn", evidence: "backup evidence is present but does not include a sha256 marker" };
  }
  return { status: "pass", evidence: "backup evidence includes sha256 marker" };
}

function collectRollback(status: UpdateStatus | null): Signal {
  const rollback = status?.rollback;
  const data = rollback
    ? { available: Boolean(rollback.available), targetVersion: rollback.targetVersion ?? null, targetImage: rollback.targetImage ?? null }
    : {};
  if (rollback?.available && rollback.targetImage) {
    return { status: "pass", evidence: "rollback target is available", data };
  }
  if (scope === "release" || scope === "update" || scope === "rollback") {
    return { status: "blocked", evidence: "rollback target is missing for release/update/rollback scope", data };
  }
  return { status: "unknown", evidence: "rollback target not supplied", data };
}

function collectInfrastructure(): Signal {
  const disk = process.env.AREAFORGE_READINESS_DISK_STATUS ?? null;
  const certDaysRaw = process.env.AREAFORGE_READINESS_CERT_DAYS;
  const certDays = certDaysRaw ? Number(certDaysRaw) : null;
  const data = { disk, certificateDaysRemaining: certDays };
  if (disk === "fail") return { status: "fail", evidence: "disk status is fail", data };
  if (disk === "warn") return { status: "warn", evidence: "disk status is warn", data, residualRiskIds: ["AF-RISK-OPS-004"] };
  if (typeof certDays === "number" && Number.isFinite(certDays)) {
    if (certDays <= 7) return { status: "blocked", evidence: `certificate expires in ${certDays} day(s)`, data };
    if (certDays <= 14) return { status: "warn", evidence: `certificate expires in ${certDays} day(s)`, data, residualRiskIds: ["AF-RISK-OPS-004"] };
    return { status: "pass", evidence: `certificate expires in ${certDays} day(s)`, data };
  }
  return { status: "unknown", evidence: "disk/certificate evidence not supplied", residualRiskIds: ["AF-RISK-OPS-004"], data };
}

async function requestJson(path: string, cookie?: string): Promise<unknown> {
  const response = await requestRaw(path, { cookie });
  return response.json();
}

async function requestRaw(path: string, options: { method?: "GET" | "POST"; body?: unknown; cookie?: string } = {}): Promise<Response> {
  if (!baseUrl) throw new Error("base URL is not configured");
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
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function readSmokePassword(): string | undefined {
  const passwordFile = process.env.AREAFORGE_SMOKE_PASSWORD_FILE;
  if (passwordFile) {
    try {
      return readFileSync(passwordFile, "utf8").trim();
    } catch {
      return undefined;
    }
  }
  return process.env.AREAFORGE_SMOKE_PASSWORD;
}

function cookieFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookie = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return setCookie
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function normalizeStatusJson(value: unknown): UpdateStatus {
  const record = asRecord(value);
  return asRecord(record.status ?? value) as UpdateStatus;
}

function safeUpdateData(status: UpdateStatus): Record<string, unknown> {
  return {
    currentVersion: status.currentVersion ?? null,
    currentImage: status.currentImage ?? null,
    releaseUrl: status.releaseUrl ?? null,
    latestVersion: status.latestVersion ?? null,
    updateAvailable: Boolean(status.updateAvailable),
    autoApply: status.autoApply ?? null,
    signatureRequired: Boolean(status.signatureRequired),
    timerEnabled: status.timerEnabled ?? null,
    timerActive: status.timerActive ?? null,
    lastCheckedAt: status.lastCheckedAt ?? null,
    blocker: status.blocker ?? null,
    rollback: status.rollback
      ? {
          available: Boolean(status.rollback.available),
          targetVersion: status.rollback.targetVersion ?? null,
          targetImage: status.rollback.targetImage ?? null,
        }
      : null,
    statusUpdatedAt: status.statusUpdatedAt ?? null,
  };
}

function safeHealthData(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: body.ok,
    service: body.service,
    version: body.version,
  };
}

function parseLastJson(value: string): unknown {
  const jsonLine = value
    .trim()
    .split(/\r?\n/)
    .reverse()
    .find((line) => line.trim().startsWith("{"));
  if (!jsonLine) throw new Error("smoke result does not contain JSON summary");
  return JSON.parse(jsonLine);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function maybeNormalizeBaseUrl(value: string | undefined): string | null {
  return value ? value.replace(/\/+$/, "") : null;
}

function baseUrlFromHealthUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/api\/health\/?$/, "");
}

function versionTag(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function isDigest(value: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(value);
}

function normalizeScope(value: string | undefined): ReadinessScope {
  const allowed: ReadinessScope[] = ["daily", "release", "update", "migration", "rollback"];
  return allowed.includes(value as ReadinessScope) ? value as ReadinessScope : "daily";
}

function criticalScope(): boolean {
  return scope === "release" || scope === "update" || scope === "migration" || scope === "rollback";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function overallStatus(signals: Signal[]): Status {
  const order: Status[] = ["pass", "unknown", "warn", "fail", "blocked"];
  return signals.reduce<Status>((worst, signal) =>
    order.indexOf(signal.status) > order.indexOf(worst) ? signal.status : worst, "pass");
}

function shouldFail(status: Status, failOn: string): boolean {
  const order: Status[] = ["pass", "unknown", "warn", "fail", "blocked"];
  const threshold = order.includes(failOn as Status) ? failOn as Status : "fail";
  return order.indexOf(status) >= order.indexOf(threshold);
}

function redact(value: string): string {
  const smokePassword = readSmokePassword();
  let output = value;
  if (smokePassword) {
    output = output.replace(new RegExp(escapeRegExp(smokePassword), "g"), "<redacted>");
  }
  return output
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/(AUTH_SESSION_SECRET|AI_API_KEY|COSIGN_PASSWORD)=\S+/g, "$1=<redacted>");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`FAIL readiness summary: ${error instanceof Error ? redact(error.message) : "unknown error"}`);
    process.exit(1);
  });
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
