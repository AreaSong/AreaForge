import { readFileSync } from "node:fs";
import * as tls from "node:tls";
import { pathToFileURL } from "node:url";
import { validateBackupRestorePreview } from "../quality/backup-restore-preview-validate";

export type Status = "pass" | "warn" | "fail" | "blocked" | "unknown";
export type ReadinessScope = "daily" | "release" | "update" | "migration" | "rollback";
type FreshnessStatus = "fresh" | "stale" | "unknown";
type SignalKey =
  | "health"
  | "releaseIdentity"
  | "updateAgent"
  | "authenticatedSmoke"
  | "backup"
  | "rollback"
  | "infrastructure";

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
  freshness: {
    maxAgeSeconds: number;
    latestEvidenceFreshnessStatus: FreshnessStatus;
    signals: Record<SignalKey, {
      checkedAt: string | null;
      ageSeconds: number | null;
      status: FreshnessStatus;
    }>;
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

type ReleaseManifest = {
  schemaVersion?: unknown;
  app?: unknown;
  version?: string;
  channel?: string;
  gitCommit?: string;
  webImage?: string;
  webImageDigest?: string;
  migrationImage?: string;
  migrationImageDigest?: string;
  requiresMigration?: boolean;
  sha256SumsAsset?: string;
  signatureAsset?: string;
  sbomAsset?: string;
  provenanceAsset?: string;
  releaseNotesUrl?: string;
  autoApply?: {
    patch?: boolean;
    minor?: boolean;
    major?: boolean;
  };
};

type ReleaseManifestEvidence =
  | { source: string; manifest: ReleaseManifest }
  | { source: string; error: string };

const timeoutMs = Number(process.env.AREAFORGE_READINESS_TIMEOUT_MS ?? "10000");
const freshnessMaxAgeSeconds = Number(process.env.AREAFORGE_READINESS_FRESHNESS_MAX_AGE_SECONDS ?? "1209600");
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
const releaseManifestFile = process.env.AREAFORGE_READINESS_RELEASE_MANIFEST_FILE ?? null;
const releaseManifestUrl = process.env.AREAFORGE_READINESS_RELEASE_MANIFEST_URL ??
  githubReleaseManifestUrl(process.env.AREAFORGE_READINESS_GITHUB_REPO, expectedReleaseTag);
const backupRestorePreviewFile = process.env.AREAFORGE_READINESS_BACKUP_RESTORE_PREVIEW_FILE ?? null;

export async function collectOperationalReadinessSummary(): Promise<OperationalReadinessSummary> {
  const checkedAt = new Date().toISOString();
  const health = await collectHealth();
  const updateStatus = await collectUpdateStatus();
  const releaseManifest = await collectReleaseManifest();
  const releaseIdentity = collectReleaseIdentity(health, updateStatus, releaseManifest);
  const authenticatedSmoke = collectAuthenticatedSmoke();
  const backup = collectBackup();
  const rollback = collectRollback(updateStatus);
  const infrastructure = await collectInfrastructure();
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
    checkedAt,
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
    freshness: buildFreshness(signals, checkedAt),
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
    networkRequested: Boolean(baseUrl || releaseManifestUrl),
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

async function collectReleaseManifest(): Promise<ReleaseManifestEvidence | null> {
  if (releaseManifestFile) {
    try {
      return {
        source: `file:${releaseManifestFile}`,
        manifest: normalizeReleaseManifest(JSON.parse(readFileSync(releaseManifestFile, "utf8"))),
      };
    } catch (error) {
      return {
        source: `file:${releaseManifestFile}`,
        error: redact(error instanceof Error ? error.message : "cannot read release manifest file"),
      };
    }
  }

  if (releaseManifestUrl) {
    try {
      return {
        source: releaseManifestUrl,
        manifest: normalizeReleaseManifest(await requestAbsoluteJson(releaseManifestUrl)),
      };
    } catch (error) {
      return {
        source: releaseManifestUrl,
        error: redact(error instanceof Error ? error.message : "cannot fetch release manifest URL"),
      };
    }
  }

  return null;
}

function collectReleaseIdentity(
  health: Signal,
  status: UpdateStatus | null,
  releaseManifest: ReleaseManifestEvidence | null,
): Signal {
  const manifest = releaseManifest && "manifest" in releaseManifest ? releaseManifest.manifest : null;
  const manifestError = releaseManifest && "error" in releaseManifest ? releaseManifest.error : null;
  const releaseTag = expectedReleaseTag ?? (manifest?.version ? versionTag(manifest.version) : null);
  const webImageDigest = expectedWebDigest ?? manifest?.webImageDigest ?? digestOrNull(status?.currentImage);
  const migrationImageDigest = expectedMigrationDigest ?? manifest?.migrationImageDigest ?? null;
  const data: Record<string, unknown> = {
    releaseTag,
    webImageDigest,
    migrationImageDigest,
    currentVersion: status?.currentVersion ?? null,
    currentImage: status?.currentImage ?? null,
    releaseUrl: status?.releaseUrl ?? manifest?.releaseNotesUrl ?? null,
    manifestSource: releaseManifest?.source ?? null,
    manifestVersion: manifest?.version ?? null,
    manifestChannel: manifest?.channel ?? null,
    manifestGitCommit: manifest?.gitCommit ?? null,
    manifestAssets: manifest
      ? {
          sha256SumsAsset: manifest.sha256SumsAsset ?? null,
          signatureAsset: manifest.signatureAsset ?? null,
          sbomAsset: manifest.sbomAsset ?? null,
          provenanceAsset: manifest.provenanceAsset ?? null,
        }
      : null,
    manifestError,
  };
  const missing: string[] = [];
  if (!releaseTag) missing.push("release tag");
  if (!webImageDigest) missing.push("web image digest");
  if (!migrationImageDigest) missing.push("migration image digest");

  const digestIssues = [
    webImageDigest && !isDigest(webImageDigest) ? "web image digest is not immutable image@sha256" : null,
    migrationImageDigest && !isDigest(migrationImageDigest) ? "migration image digest is not immutable image@sha256" : null,
  ].filter(Boolean);

  const manifestIssues = [
    manifest && manifest.schemaVersion !== 1 ? `manifest schemaVersion is ${String(manifest.schemaVersion)}` : null,
    manifest && manifest.app !== "AreaForge" ? `manifest app is ${String(manifest.app)}` : null,
    manifest && expectedReleaseTag && versionTag(manifest.version ?? "") !== expectedReleaseTag
      ? `manifest version ${manifest.version ?? "missing"} does not match ${expectedReleaseTag}`
      : null,
  ].filter(Boolean);

  if (manifestError) {
    return {
      status: scope === "daily" ? "warn" : "fail",
      evidence: `release manifest could not be collected from ${releaseManifest?.source}: ${manifestError}`,
      residualRiskIds: ["AF-RISK-SC-001"],
      data,
    };
  }
  if (manifestIssues.length > 0) {
    return { status: "fail", evidence: manifestIssues.join("; "), data };
  }
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
  return {
    status: "pass",
    evidence: manifest
      ? "release manifest provides release tag and immutable image digests"
      : "release tag and immutable image digests are present",
    data,
  };
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
  if (backupRestorePreviewFile) {
    try {
      const raw = readFileSync(backupRestorePreviewFile, "utf8");
      const validationIssues = validateBackupRestorePreview(raw);
      if (validationIssues.length > 0) {
        return {
          status: criticalScope() ? "blocked" : "warn",
          evidence: "backup/restore metadata preview is invalid",
          residualRiskIds: ["AF-RISK-OPS-001", "AF-RISK-OPS-004"],
          data: {
            issueCount: validationIssues.length,
            issueFields: validationIssues.map((issue) => issue.field).slice(0, 10),
          },
        };
      }
      const preview = asRecord(JSON.parse(extractJson(raw)));
      const status = typeof preview.status === "string" ? preview.status : "unknown";
      const inventory = Array.isArray(preview.evidenceInventory)
        ? preview.evidenceInventory.map((item) => {
            const record = asRecord(item);
            return {
              key: record.key ?? null,
              status: record.status ?? null,
              category: record.category ?? null,
            };
          })
        : [];
      const blockingGaps = Array.isArray(preview.blockingGaps)
        ? preview.blockingGaps.map((item) => {
            const record = asRecord(item);
            return {
              key: record.key ?? null,
              status: record.status ?? null,
              category: record.category ?? null,
              gapType: record.gapType ?? null,
              sourceInput: record.sourceInput ?? null,
              sourceField: record.sourceField ?? null,
              blocks: Array.isArray(record.blocks) ? record.blocks : [],
            };
          })
        : [];
      if (status === "ready") {
        return {
          status: criticalScope() ? "blocked" : "warn",
          evidence: "backup/restore metadata preview is ready, but metadata-only preview does not prove live backup archive availability",
          residualRiskIds: ["AF-RISK-OPS-001"],
          data: { previewStatus: status, previewHash: preview.backupRestorePreviewHash ?? null, inventory, blockingGaps },
        };
      }
      if (status === "blocked") {
        return {
          status: "blocked",
          evidence: "backup/restore metadata preview is blocked",
          residualRiskIds: ["AF-RISK-OPS-001", "AF-RISK-OPS-004"],
          data: { previewStatus: status, previewHash: preview.backupRestorePreviewHash ?? null, inventory, blockingGaps },
        };
      }
      return {
        status: criticalScope() ? "blocked" : "warn",
        evidence: `backup/restore metadata preview status is ${status}`,
        residualRiskIds: ["AF-RISK-OPS-001", "AF-RISK-OPS-004"],
        data: { previewStatus: status, previewHash: preview.backupRestorePreviewHash ?? null, inventory, blockingGaps },
      };
    } catch (error) {
      return {
        status: criticalScope() ? "blocked" : "warn",
        evidence: redact(error instanceof Error ? `cannot read backup/restore preview: ${error.message}` : "cannot read backup/restore preview"),
        residualRiskIds: ["AF-RISK-OPS-001"],
      };
    }
  }

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

function extractJson(raw: string): string {
  const firstBrace = raw.indexOf("{");
  if (firstBrace < 0) return raw;
  return raw.slice(firstBrace).trim();
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

async function collectInfrastructure(): Promise<Signal> {
  const disk = process.env.AREAFORGE_READINESS_DISK_STATUS ?? null;
  const certDaysRaw = process.env.AREAFORGE_READINESS_CERT_DAYS;
  const manualCertDays = certDaysRaw ? Number(certDaysRaw) : null;
  const certificate = typeof manualCertDays === "number" && Number.isFinite(manualCertDays)
    ? { source: "env", daysRemaining: manualCertDays }
    : await collectTlsCertificate();
  const data = {
    disk,
    certificateDaysRemaining: certificate?.daysRemaining ?? null,
    certificateValidTo: certificate?.validTo ?? null,
    certificateHost: certificate?.host ?? null,
    certificateSource: certificate?.source ?? null,
    certificateAuthorized: certificate?.authorized ?? null,
    certificateAuthorizationError: certificate?.authorizationError ?? null,
  };
  if (disk === "fail") return { status: "fail", evidence: "disk status is fail", data };
  if (certificate?.authorized === false) {
    return {
      status: "fail",
      evidence: `TLS certificate authorization failed for ${certificate.host ?? "baseUrl"}: ${certificate.authorizationError ?? "unknown"}`,
      data,
    };
  }
  if (disk === "warn") return { status: "warn", evidence: "disk status is warn", data, residualRiskIds: ["AF-RISK-OPS-004"] };
  if (typeof certificate?.daysRemaining === "number") {
    if (certificate.daysRemaining <= 7) return { status: "blocked", evidence: `certificate expires in ${certificate.daysRemaining} day(s)`, data };
    if (certificate.daysRemaining <= 14) return { status: "warn", evidence: `certificate expires in ${certificate.daysRemaining} day(s)`, data, residualRiskIds: ["AF-RISK-OPS-004"] };
    return { status: "pass", evidence: `certificate expires in ${certificate.daysRemaining} day(s)`, data };
  }
  return { status: "unknown", evidence: "disk/certificate evidence not supplied", residualRiskIds: ["AF-RISK-OPS-004"], data };
}

type CertificateEvidence = {
  source: "env" | "tls";
  daysRemaining: number;
  validTo?: string;
  host?: string;
  authorized?: boolean;
  authorizationError?: string | null;
};

async function collectTlsCertificate(): Promise<CertificateEvidence | null> {
  if (!baseUrl) return null;

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;

  return new Promise((resolve) => {
    const host = url.hostname;
    const port = url.port ? Number(url.port) : 443;
    const socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: false,
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeoutMs);

    socket.once("secureConnect", () => {
      clearTimeout(timeout);
      const certificate = socket.getPeerCertificate();
      const validTo = typeof certificate.valid_to === "string" ? certificate.valid_to : undefined;
      const validToMs = validTo ? Date.parse(validTo) : Number.NaN;
      socket.end();
      if (!Number.isFinite(validToMs)) {
        resolve(null);
        return;
      }
      resolve({
        source: "tls",
        host,
        validTo,
        daysRemaining: Math.ceil((validToMs - Date.now()) / 86_400_000),
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
      });
    });

    socket.once("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
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

async function requestAbsoluteJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for release manifest`);
    return response.json();
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

function normalizeReleaseManifest(value: unknown): ReleaseManifest {
  return asRecord(value) as ReleaseManifest;
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

function githubReleaseManifestUrl(repo: string | undefined, tag: string | null): string | null {
  if (!repo || !tag || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/areaforge-release-manifest.json`;
}

function versionTag(value: string): string {
  return value.startsWith("v") ? value : `v${value}`;
}

function isDigest(value: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(value);
}

function digestOrNull(value: string | null | undefined): string | null {
  return value && isDigest(value) ? value : null;
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

function buildFreshness(
  signals: OperationalReadinessSummary["signals"],
  checkedAt: string,
): OperationalReadinessSummary["freshness"] {
  const freshnessBySignal = Object.fromEntries(signalKeys().map((key) => [
    key,
    buildSignalFreshness(key, signals[key], checkedAt),
  ])) as OperationalReadinessSummary["freshness"]["signals"];
  return {
    maxAgeSeconds: freshnessMaxAgeSeconds,
    latestEvidenceFreshnessStatus: aggregateFreshness(Object.values(freshnessBySignal).map((item) => item.status)),
    signals: freshnessBySignal,
  };
}

function buildSignalFreshness(key: SignalKey, signal: Signal, checkedAt: string): OperationalReadinessSummary["freshness"]["signals"][SignalKey] {
  const timestamp = signalTimestamp(key, signal, checkedAt);
  if (!timestamp) {
    return {
      checkedAt: null,
      ageSeconds: null,
      status: "unknown",
    };
  }
  const ageSeconds = Math.max(0, Math.floor((Date.parse(checkedAt) - Date.parse(timestamp)) / 1000));
  return {
    checkedAt: timestamp,
    ageSeconds,
    status: ageSeconds <= freshnessMaxAgeSeconds ? "fresh" : "stale",
  };
}

function signalTimestamp(key: SignalKey, signal: Signal, checkedAt: string): string | null {
  const data = signal.data ?? {};
  for (const field of ["checkedAt", "statusUpdatedAt", "lastCheckedAt"]) {
    const value = data[field];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
      return value;
    }
  }
  if (key === "health" && baseUrl && signal.status !== "unknown") return checkedAt;
  if (key === "releaseIdentity" && hasAnyValue(data, [
    "releaseTag",
    "webImageDigest",
    "migrationImageDigest",
    "currentVersion",
    "currentImage",
    "releaseUrl",
    "manifestSource",
  ])) {
    return checkedAt;
  }
  if (key === "rollback" && hasAnyValue(data, ["available", "targetVersion", "targetImage"])) {
    return checkedAt;
  }
  if (key === "infrastructure" && hasAnyValue(data, ["disk", "certificateSource", "certificateDaysRemaining"])) {
    return checkedAt;
  }
  return null;
}

function hasAnyValue(data: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => data[field] !== null && data[field] !== undefined && data[field] !== "");
}

function aggregateFreshness(statuses: FreshnessStatus[]): FreshnessStatus {
  if (statuses.some((status) => status === "stale")) return "stale";
  if (statuses.some((status) => status === "unknown")) return "unknown";
  return "fresh";
}

function signalKeys(): SignalKey[] {
  return [
    "health",
    "releaseIdentity",
    "updateAgent",
    "authenticatedSmoke",
    "backup",
    "rollback",
    "infrastructure",
  ];
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
