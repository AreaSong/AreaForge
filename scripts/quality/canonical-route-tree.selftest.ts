import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CANONICAL_ROUTES } from "../../apps/web/lib/navigation/canonical-routes";
import { getRouteTitle } from "../../apps/web/lib/navigation/app-navigation";

const root = process.cwd();

const canonicalFiles = CANONICAL_ROUTES.map((route) => canonicalPageFile(route.path));
const toolbarlessRoutes = new Set([
  "/confirmations",
  "/confirmations/[confirmationId]",
  "/confirmations/history",
  "/focus",
  "/today",
]);

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
  "apps/web/lib/navigation/batch7.ts",
  "apps/web/app/(app)/roadmap/arrangements/page.tsx",
  "apps/web/app/(app)/roadmap/arrangements/drafts/page.tsx",
  "apps/web/app/(app)/roadmap/arrangements/drafts/[itemId]/page.tsx",
  "apps/web/app/(app)/roadmap/arrangements/tasks/[taskId]/page.tsx",
  "apps/web/app/(app)/roadmap/reports/page.tsx",
  "apps/web/app/(app)/roadmap/reports/daily/page.tsx",
  "apps/web/app/(app)/roadmap/reports/history/[decisionId]/page.tsx",
  "apps/web/app/(app)/knowledge/syllabus/page.tsx",
  "apps/web/app/(app)/knowledge/syllabus/[nodeId]/page.tsx",
  "apps/web/app/(app)/knowledge/notes/page.tsx",
  "apps/web/app/(app)/knowledge/notes/[noteId]/page.tsx",
  "apps/web/app/(app)/settings/workspace/page.tsx",
  "apps/web/app/(app)/settings/preferences/page.tsx",
] as const;

const missingCanonical = canonicalFiles.filter((file) => !existsSync(resolve(file)));
assert.deepEqual(missingCanonical, [], `canonical route files are missing: ${missingCanonical.join(", ")}`);
assert.equal(CANONICAL_ROUTES.length, 49, "canonical route manifest must contain all 49 pages");
assert.equal(new Set(CANONICAL_ROUTES.map((route) => route.path)).size, CANONICAL_ROUTES.length, "canonical route paths must be unique");

const actualPageFiles = listPageFiles(resolve("apps/web/app"));
assert.deepEqual(actualPageFiles, [...canonicalFiles].sort(), "page.tsx files and the canonical route manifest must match exactly");

for (const route of CANONICAL_ROUTES) {
  const concretePath = route.path.replace(/\[([^\]]+)\]/g, "fixture-$1");
  assert.equal(getRouteTitle(concretePath), route.title, `route registry must resolve ${route.path}`);
  if (route.shell === "app") {
    assert(route.workbench, `${route.path} must declare a workbench`);
    assert(["primary", "secondary", "content"].includes(route.navigationLevel), `${route.path} must declare its navigation level`);
    assert(["dashboard-wide", "split-view", "content-focus", "workspace-full"].includes(route.template), `${route.path} must declare a PageFrame template`);
    assert.equal(
      route.toolbar,
      toolbarlessRoutes.has(route.path) ? "none" : "standard",
      `${route.path} must declare the expected PageToolbar mode`,
    );
    const fallback = CANONICAL_ROUTES.find((candidate) => candidate.path === route.returnFallback);
    assert(fallback?.shell === "app", `${route.path} must have a canonical app return fallback`);
  }
}
assert.deepEqual(
  CANONICAL_ROUTES.filter((route) => route.shell === "app" && route.toolbar === "none").map((route) => route.path).sort(),
  [...toolbarlessRoutes].sort(),
  "only action roots and invisible confirmation window entries may omit the shared PageToolbar",
);
assert.equal(getRouteTitle("/setup"), "页面不存在", "/setup must not remain registered after its page was removed");

const presentRemoved = removedFiles.filter((file) => existsSync(resolve(file)));
assert.deepEqual(presentRemoved, [], `removed route files must stay absent: ${presentRemoved.join(", ")}`);

const navigation = [
  readFileSync(resolve("apps/web/lib/navigation/app-navigation.ts"), "utf8"),
  readFileSync(resolve("apps/web/lib/navigation/canonical-routes.ts"), "utf8"),
].join("\n");
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

const navigationDoc = readFileSync(resolve("docs/ux/site-navigation.md"), "utf8");
const pageList = navigationDoc.match(/## 页面清单([\s\S]*?)## 已移除的旧路由/)?.[1] ?? "";
const documentedRoutes = [...pageList.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]!).sort();
assert.deepEqual(documentedRoutes, CANONICAL_ROUTES.map((route) => route.path).sort(), "site-navigation page table must list every canonical route exactly once");

console.log(`canonical route tree selftest passed: ${canonicalFiles.length} canonical files, registry entries, and documentation rows agree; ${removedFiles.length} removed files absent`);

function resolve(file: string): string {
  return path.join(root, file);
}

function canonicalPageFile(routePath: string): string {
  if (routePath === "/") return "apps/web/app/page.tsx";
  if (routePath === "/login") return "apps/web/app/login/page.tsx";
  return `apps/web/app/(app)${routePath}/page.tsx`;
}

function listPageFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listPageFiles(absolute));
    else if (entry.isFile() && entry.name === "page.tsx") {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}
