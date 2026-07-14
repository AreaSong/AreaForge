import { accessSync, constants, statSync } from "node:fs";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function main(): void {
  checkBaseUrl();
  checkExtraSmokeCommand();
  checkSmokeIdentity();
  checkPasswordFile();
  checkExpectedVersion();
  checkExpectedAutoApply();
  checkForbiddenEnv();

  const failed = checks.filter((check) => !check.ok);
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  }
  console.log(JSON.stringify({
    ok: failed.length === 0,
    checkedAt: new Date().toISOString(),
    command: "smoke:prod-readonly:config",
    residualRiskIds: ["AF-RISK-OPS-001"],
    safetyFacts: {
      readOnly: true,
      passwordFileContentRead: false,
      networkRequested: false,
      serverCommandAttempted: false,
      productionWriteAttempted: false,
      secretValuePrinted: false,
    },
    summary: {
      baseUrl: redactedBaseUrl(),
      extraSmokeCommand: process.env.AREAFORGE_EXTRA_SMOKE_COMMAND ? "<configured>" : "<missing>",
      smokeEmail: process.env.AREAFORGE_SMOKE_EMAIL ? "<configured>" : "<missing>",
      smokePasswordFile: process.env.AREAFORGE_SMOKE_PASSWORD_FILE ? "<redacted path>" : "<missing>",
      expectedVersion: process.env.AREAFORGE_SMOKE_EXPECTED_VERSION ?? process.env.APP_VERSION ?? "<missing>",
      expectedAutoApply: process.env.AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY ?? "<missing>",
    },
  }));

  if (failed.length > 0) {
    console.error(`production readonly smoke config preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("production readonly smoke config preflight passed.");
}

function checkBaseUrl(): void {
  const baseUrl = resolvedBaseUrl();
  checks.push({
    name: "base URL",
    ok: Boolean(baseUrl) && /^https:\/\/[^ \n]+$/i.test(baseUrl),
    detail: baseUrl
      ? `configured as ${redactedBaseUrl()}`
      : "AREAFORGE_SMOKE_BASE_URL, APP_URL, or AREAFORGE_HEALTH_URL is required",
  });
}

function checkExtraSmokeCommand(): void {
  const command = process.env.AREAFORGE_EXTRA_SMOKE_COMMAND ?? "";
  checks.push({
    name: "extra smoke command",
    ok: command.includes("pnpm smoke:prod-readonly"),
    detail: command ? "references pnpm smoke:prod-readonly" : "AREAFORGE_EXTRA_SMOKE_COMMAND is required",
  });
}

function checkSmokeIdentity(): void {
  checks.push({
    name: "smoke account",
    ok: Boolean(process.env.AREAFORGE_SMOKE_EMAIL),
    detail: process.env.AREAFORGE_SMOKE_EMAIL ? "smoke email configured; value redacted" : "AREAFORGE_SMOKE_EMAIL is required",
  });
}

function checkPasswordFile(): void {
  const passwordFile = process.env.AREAFORGE_SMOKE_PASSWORD_FILE;
  if (!passwordFile) {
    checks.push({
      name: "smoke password file",
      ok: false,
      detail: "AREAFORGE_SMOKE_PASSWORD_FILE is required; do not use AREAFORGE_SMOKE_PASSWORD for production records",
    });
    return;
  }

  let ok = false;
  let detail = "password file path redacted";
  try {
    accessSync(passwordFile, constants.R_OK);
    const stat = statSync(passwordFile);
    const mode = stat.mode & 0o777;
    const tooBroad = (mode & 0o077) !== 0;
    ok = stat.isFile() && !tooBroad;
    detail = ok
      ? `file exists, is readable, and mode ${mode.toString(8)} is not group/world readable`
      : `file must be a regular file and not group/world readable; current mode ${mode.toString(8)}`;
  } catch (error) {
    detail = error instanceof Error ? `cannot access password file: ${redact(error.message)}` : "cannot access password file";
  }

  checks.push({ name: "smoke password file", ok, detail });
}

function checkExpectedVersion(): void {
  const version = process.env.AREAFORGE_SMOKE_EXPECTED_VERSION ?? process.env.APP_VERSION;
  checks.push({
    name: "expected version",
    ok: Boolean(version) && /^\d+\.\d+\.\d+$/.test(version ?? ""),
    detail: version ? `configured as ${version}` : "AREAFORGE_SMOKE_EXPECTED_VERSION or APP_VERSION is required",
  });
}

function checkExpectedAutoApply(): void {
  const autoApply = process.env.AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY;
  checks.push({
    name: "expected auto apply",
    ok: ["none", "patch", "minor", "all"].includes(autoApply ?? ""),
    detail: autoApply ? `configured as ${autoApply}` : "AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY is required",
  });
}

function checkForbiddenEnv(): void {
  checks.push({
    name: "password env fallback",
    ok: !process.env.AREAFORGE_SMOKE_PASSWORD,
    detail: process.env.AREAFORGE_SMOKE_PASSWORD
      ? "AREAFORGE_SMOKE_PASSWORD must not be used for production smoke evidence"
      : "AREAFORGE_SMOKE_PASSWORD is not set",
  });
}

function resolvedBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.AREAFORGE_SMOKE_BASE_URL ??
      process.env.APP_URL ??
      baseUrlFromHealthUrl(process.env.AREAFORGE_HEALTH_URL) ??
      "",
  );
}

function redactedBaseUrl(): string {
  const baseUrl = resolvedBaseUrl();
  return baseUrl ? baseUrl.replace(/\/\/([^/@]+)@/, "//<redacted>@") : "<missing>";
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function baseUrlFromHealthUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/api\/health\/?$/, "");
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer <redacted>")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>")
    .replace(/AREAFORGE_SMOKE_PASSWORD=\S+/g, "AREAFORGE_SMOKE_PASSWORD=<redacted>");
}

main();
