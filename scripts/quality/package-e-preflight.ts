import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const root = process.cwd();
const checks: CheckResult[] = [];

function main(): void {
  checkRequiredFiles();
  checkComposeConfig();
  checkComposeBoundaries();
  checkDockerfileBoundaries();
  checkNginxBoundaries();
  checkEnvExample();
  checkWebRuntimeOpsBoundary();

  for (const check of checks) {
    const mark = check.ok ? "PASS" : "FAIL";
    console.log(`${mark} ${check.name}: ${check.detail}`);
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    console.error(`Package E preflight failed: ${failed.length} issue(s).`);
    process.exit(1);
  }

  console.log("Package E preflight passed: local release artifacts are structurally ready; no production deploy, backup, restore, or migration was executed.");
}

function checkRequiredFiles(): void {
  const requiredFiles = [
    ".env.example",
    "docker-compose.prod.yml",
    "infra/docker/web.Dockerfile",
    "infra/nginx/forge.areasong.top.conf.example",
    "docs/development/production-release-runbook.md",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(resolve(file)));
  checks.push({
    name: "required release files",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `${requiredFiles.length} files present` : `missing ${missing.join(", ")}`,
  });
}

function checkComposeConfig(): void {
  const result = spawnSync("docker", ["compose", "--env-file", ".env.example", "-f", "docker-compose.prod.yml", "config"], {
    cwd: root,
    encoding: "utf8",
  });
  checks.push({
    name: "compose config with example env",
    ok: result.status === 0,
    detail: result.status === 0
      ? "docker compose config passes with .env.example placeholders"
      : compactOutput(result.stderr || result.stdout || "docker compose config failed"),
  });
}

function checkComposeBoundaries(): void {
  const compose = read("docker-compose.prod.yml");
  const forbiddenTerms = ["docker.sock", "privileged: true", "network_mode: host"];
  const missingTerms = [
    "127.0.0.1:${WEB_PORT:-3000}:3000",
    "areaforge-postgres-data:/var/lib/postgresql/data",
    "areaforge-uploads:/app/uploads",
    "condition: service_healthy",
    "UPLOAD_DIR: /app/uploads",
  ].filter((term) => !compose.includes(term));
  const forbiddenMatches = forbiddenTerms.filter((term) => compose.includes(term));
  const postgresPublicPort = /^\s*-\s*["']?\d+:\s*5432\b/m.test(compose);

  checks.push({
    name: "compose production boundaries",
    ok: missingTerms.length === 0 && forbiddenMatches.length === 0 && !postgresPublicPort,
    detail: missingTerms.length === 0 && forbiddenMatches.length === 0 && !postgresPublicPort
      ? "web binds localhost, postgres is private, uploads use a private volume, and no privileged host access is declared"
      : `missing ${missingTerms.join(", ") || "none"}; forbidden ${forbiddenMatches.join(", ") || "none"}; postgresPublicPort=${postgresPublicPort}`,
  });
}

function checkDockerfileBoundaries(): void {
  const dockerfile = read("infra/docker/web.Dockerfile");
  const requiredTerms = [
    "FROM node:24-alpine AS runner",
    "USER nextjs",
    "COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./",
    "RUN mkdir -p /app/uploads",
    "CMD [\"node\", \"apps/web/server.js\"]",
  ];
  const forbiddenTerms = ["db:migrate:deploy", "prisma migrate deploy", "prisma/migrations", "AUTH_SESSION_SECRET"];
  const missingTerms = requiredTerms.filter((term) => !dockerfile.includes(term));
  const forbiddenMatches = forbiddenTerms.filter((term) => dockerfile.includes(term));
  checks.push({
    name: "web image release boundary",
    ok: missingTerms.length === 0 && forbiddenMatches.length === 0,
    detail: missingTerms.length === 0 && forbiddenMatches.length === 0
      ? "runtime image runs Next standalone as non-root and does not pretend to be a migration runner"
      : `missing ${missingTerms.join(", ") || "none"}; forbidden ${forbiddenMatches.join(", ") || "none"}`,
  });
}

function checkNginxBoundaries(): void {
  const nginx = read("infra/nginx/forge.areasong.top.conf.example");
  const requiredTerms = [
    "proxy_pass http://127.0.0.1:3000",
    "client_max_body_size 25m",
    "X-Content-Type-Options",
    "Strict-Transport-Security",
  ];
  const forbiddenTerms = ["/app/uploads", "alias /", "root /app", "autoindex on"];
  const missingTerms = requiredTerms.filter((term) => !nginx.includes(term));
  const forbiddenMatches = forbiddenTerms.filter((term) => nginx.includes(term));
  checks.push({
    name: "nginx private upload boundary",
    ok: missingTerms.length === 0 && forbiddenMatches.length === 0,
    detail: missingTerms.length === 0 && forbiddenMatches.length === 0
      ? "nginx proxies to local web service and does not statically expose upload storage"
      : `missing ${missingTerms.join(", ") || "none"}; forbidden ${forbiddenMatches.join(", ") || "none"}`,
  });
}

function checkEnvExample(): void {
  const env = read(".env.example");
  const requiredKeys = [
    "APP_URL=",
    "AUTH_SESSION_SECRET=",
    "POSTGRES_PASSWORD=",
    "AREAFORGE_IMAGE=",
    "AI_ENABLED=false",
    "AI_LOG_PROMPTS=false",
    "AI_ALLOW_SENSITIVE_CONTEXT=false",
    "UPLOAD_DIR=/app/uploads",
    "BACKUP_DIR=/backups",
    "BACKUP_RETENTION_DAYS=14",
  ];
  const missingKeys = requiredKeys.filter((term) => !env.includes(term));
  checks.push({
    name: "example release env",
    ok: missingKeys.length === 0,
    detail: missingKeys.length === 0
      ? "example env documents production release, upload, AI fallback, and backup knobs"
      : `missing ${missingKeys.join(", ")}`,
  });
}

function checkWebRuntimeOpsBoundary(): void {
  const files = [
    ...listFiles("apps/web/app"),
    ...listFiles("apps/web/lib"),
    ...listFiles("apps/web/components"),
  ].filter((file) => /\.(ts|tsx)$/.test(file));
  const forbiddenPatterns = [
    { label: "child_process", pattern: /\bchild_process\b/ },
    { label: "execSync", pattern: /\bexecSync\b/ },
    { label: "spawnSync", pattern: /\bspawnSync\b/ },
    { label: "docker compose", pattern: /\bdocker\s+compose\b/ },
    { label: "pg_dump", pattern: /\bpg_dump\b/ },
    { label: "pg_restore", pattern: /\bpg_restore\b/ },
    { label: "prisma migrate deploy", pattern: /\bprisma\s+migrate\s+deploy\b/ },
    { label: "db:migrate:deploy", pattern: /\bdb:migrate:deploy\b/ },
  ];
  const matches = files.flatMap((file) => {
    const content = read(file);
    return forbiddenPatterns
      .filter((item) => item.pattern.test(content))
      .map((item) => `${file}:${item.label}`);
  });

  checks.push({
    name: "web runtime ops boundary",
    ok: matches.length === 0,
    detail: matches.length === 0
      ? "web runtime contains no deploy, backup, restore, or migration command execution surface"
      : `found forbidden ops surface: ${matches.join(", ")}`,
  });
}

function read(file: string): string {
  return readFileSync(resolve(file), "utf8");
}

function resolve(file: string): string {
  return path.join(root, file);
}

function compactOutput(output: string): string {
  return output.trim().replace(/\s+/g, " ").slice(0, 500);
}

function listFiles(dir: string): string[] {
  const absolute = resolve(dir);
  if (!existsSync(absolute)) return [];

  const entries = readdirSync(absolute, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(child);
    if (entry.isFile()) return [child];
    return [];
  });
}

main();
