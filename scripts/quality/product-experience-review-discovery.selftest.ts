import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveProductExperienceReviewPath } from "./product-experience-review-discovery";

const root = mkdtempSync(path.join(os.tmpdir(), "areaforge-ux-discovery-"));
const recordsDir = path.join(root, "docs", "development");
mkdirSync(recordsDir, { recursive: true });

try {
  writeRecord(path.join(recordsDir, "product-experience-review-20260715.md"), "2026-07-15T12:00:00+08:00");
  writeRecord(path.join(recordsDir, "product-experience-review-20260716.md"), "2026-07-16T12:00:00+08:00");
  writeFileSync(path.join(recordsDir, "product-experience-review-malformed.md"), "recordId: malformed\n");
  writeFileSync(path.join(recordsDir, "product-experience-review-record-template.md"), "reviewedAt: 2099-01-01T00:00:00Z\n");

  const selected = resolveProductExperienceReviewPath(root);
  assert(selected === "docs/development/product-experience-review-20260716.md", `latest review was not selected: ${selected}`);

  const explicit = resolveProductExperienceReviewPath(root, "docs/development/product-experience-review-20260715.md");
  assert(explicit === "docs/development/product-experience-review-20260715.md", "explicit UX record path must win");

  const symlinkPath = path.join(recordsDir, "product-experience-review-20990101.md");
  try {
    symlinkSync(path.join(recordsDir, "product-experience-review-20260715.md"), symlinkPath);
  } catch {
    // Symlink creation may be unavailable on a restricted filesystem; regular-file selection remains covered.
  }
  assert(resolveProductExperienceReviewPath(root) === "docs/development/product-experience-review-20260716.md", "symlink must not become the selected evidence record");

  console.log("product experience review discovery selftest passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}

function writeRecord(filePath: string, reviewedAt: string): void {
  writeFileSync(filePath, `recordId: test\nreviewedAt: ${reviewedAt}\n`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
