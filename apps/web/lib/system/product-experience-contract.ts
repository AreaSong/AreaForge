import { createHash } from "node:crypto";

export const PRODUCT_EXPERIENCE_SOURCE_FINGERPRINT_SCHEMA = "ux-source-v2";

export const productExperienceSourcePaths = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "apps/web/public",
  "apps/web/package.json",
  "apps/web/next.config.ts",
  "apps/web/postcss.config.mjs",
  "apps/web/tsconfig.json",
  "packages/ai/package.json",
  "packages/ai/src",
  "packages/auth/package.json",
  "packages/auth/src",
  "packages/config/package.json",
  "packages/config/src",
  "packages/core/package.json",
  "packages/core/src",
  "packages/db/package.json",
  "packages/db/src",
  "packages/storage/package.json",
  "packages/storage/src",
  "packages/ui/package.json",
  "packages/ui/src",
  "prisma/schema.prisma",
  "prisma/migrations",
  "scripts/ops/local-ux-smoke.ts",
  "scripts/ops/smoke-password.ts",
  "scripts/ops/product-experience-runtime-probe.ts",
  "scripts/ops/v11-browser-fixtures.ts",
  "scripts/ops/v11-browser-journeys.ts",
  "scripts/ops/v11-accessibility-suite.ts",
  "scripts/ops/v11-browser-evidence.ts",
  "scripts/ops/responsive-layout-browser-matrix.ts",
  "scripts/ops/web-governance-browser-interactions.ts",
  "scripts/quality/product-experience-source.ts",
  "scripts/quality/product-experience-review-validate.ts",
  "scripts/quality/product-experience-review-validate.selftest.ts",
  "scripts/quality/product-experience-runtime-probe.selftest.ts",
  "scripts/quality/v11-browser-evidence-contract.ts",
  "scripts/quality/v11-browser-evidence-validate.ts",
  "scripts/quality/v11-browser-evidence-validate.selftest.ts",
  "scripts/quality/v11-browser-evidence-runner.selftest.ts",
  "scripts/quality/web-governance-preflight.ts",
  "scripts/quality/web-governance-preflight.selftest.ts",
  "scripts/quality/g8-browser-evidence-validate.ts",
  "scripts/quality/g8-browser-evidence-validate.selftest.ts",
  "scripts/quality/g8-browser-evidence-pair-validate.ts",
  "scripts/quality/g8-browser-evidence-pair-validate.selftest.ts",
  "docs/development/product-experience-review-record-template.md",
] as const;

export function canonicalSha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(sortValue(value))).digest("hex")}`;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortValue(nested)]));
}
