import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const canonicalFiles = [
  "apps/web/app/(app)/focus/page.tsx",
  "apps/web/app/(app)/today/page.tsx",
  "apps/web/app/(app)/roadmap/page.tsx",
  "apps/web/app/(app)/roadmap/allocation/page.tsx",
  "apps/web/app/(app)/roadmap/allocation/drafts/page.tsx",
  "apps/web/app/(app)/roadmap/reviews/page.tsx",
  "apps/web/app/(app)/roadmap/reviews/daily/page.tsx",
  "apps/web/app/(app)/knowledge/points/page.tsx",
  "apps/web/app/(app)/knowledge/page.tsx",
  "apps/web/app/(app)/test/page.tsx",
  "apps/web/app/(app)/knowledge/syllabi/page.tsx",
  "apps/web/app/(app)/confirmations/page.tsx",
  "apps/web/app/(app)/settings/page.tsx",
  "apps/web/app/(app)/settings/exams/page.tsx",
  "apps/web/app/(app)/settings/learning/page.tsx",
  "apps/web/app/(app)/test/simulations/page.tsx",
  "apps/web/app/(app)/roadmap/stages/page.tsx",
] as const;

const removedFiles = [
  "apps/web/app/(app)/today/plan/page.tsx",
  "apps/web/app/(app)/today/inbox/page.tsx",
  "apps/web/app/(app)/today/inbox/[itemId]/page.tsx",
  "apps/web/app/(app)/today/tasks/[taskId]/page.tsx",
  "apps/web/app/(app)/stage/page.tsx",
  "apps/web/app/(app)/stage/layout.tsx",
  "apps/web/app/(app)/stage/not-found.tsx",
  "apps/web/app/(app)/stage/overview/page.tsx",
  "apps/web/app/(app)/stage/analytics/page.tsx",
  "apps/web/app/(app)/stage/simulation/page.tsx",
  "apps/web/app/(app)/stage/simulation/[examId]/page.tsx",
  "apps/web/app/analytics/page.tsx",
  "apps/web/app/reports/page.tsx",
  "apps/web/app/simulation/page.tsx",
  "apps/web/app/syllabus/page.tsx",
  "apps/web/app/notes/page.tsx",
  "apps/web/app/mistakes/page.tsx",
  "apps/web/app/motivation/page.tsx",
  "apps/web/lib/navigation/legacy-redirect.ts",
  "apps/web/app/(app)/roadmap/arrangements/page.tsx",
  "apps/web/app/(app)/roadmap/arrangements/drafts/page.tsx",
  "apps/web/app/(app)/roadmap/arrangements/drafts/[itemId]/page.tsx",
  "apps/web/app/(app)/roadmap/arrangements/tasks/[taskId]/page.tsx",
  "apps/web/app/(app)/roadmap/reports/page.tsx",
  "apps/web/app/(app)/roadmap/reports/daily/page.tsx",
  "apps/web/app/(app)/roadmap/reports/history/[decisionId]/page.tsx",
  "apps/web/app/(app)/knowledge/syllabus/page.tsx",
  "apps/web/app/(app)/knowledge/syllabus/[nodeId]/page.tsx",
  "apps/web/app/(app)/settings/workspace/page.tsx",
  "apps/web/app/(app)/settings/preferences/page.tsx",
] as const;

const missingCanonical = canonicalFiles.filter((file) => !existsSync(resolve(file)));
assert.deepEqual(missingCanonical, [], `canonical route files are missing: ${missingCanonical.join(", ")}`);

const presentRemoved = removedFiles.filter((file) => existsSync(resolve(file)));
assert.deepEqual(presentRemoved, [], `removed route files must stay absent: ${presentRemoved.join(", ")}`);

const navigation = readFileSync(resolve("apps/web/lib/navigation/batch7.ts"), "utf8");
for (const removedPath of [
  "/today/plan",
  "/today/inbox",
  "/today/tasks",
  "/stage/",
  "/analytics",
  "/reports",
  "/simulation",
  "/syllabus",
  "/notes",
  "/mistakes",
  "/motivation",
  "/roadmap/arrangements",
  "/roadmap/reports",
  "/knowledge/syllabus",
  "/settings/workspace",
  "/settings/preferences",
]) {
  assert(!navigation.includes(`path === \"${removedPath}\"`) && !navigation.includes(`startsWith(\"${removedPath}`),
    `navigation must not match removed route ${removedPath}`);
}
assert(!navigation.includes("canonicalizeLegacyPathname"), "navigation must not canonicalize legacy paths");

console.log(`canonical route tree selftest passed: ${canonicalFiles.length} canonical files present, ${removedFiles.length} removed files absent`);

function resolve(file: string): string {
  return path.join(root, file);
}
