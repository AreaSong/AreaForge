import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadSource(relPath: string): string {
  const normalized = relPath.replace(/^apps\/web\//, "");
  const candidates = [
    resolve(process.cwd(), relPath),
    resolve(process.cwd(), normalized),
    resolve(process.cwd(), "apps/web", normalized),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, "utf8");
    }
  }
  throw new Error(`Could not find source file for ${relPath}`);
}

test("Knowledge Overview Page: Container Query & Responsive Layout", () => {
  const overviewSource = loadSource("lib/routes/knowledge-overview-page.tsx");

  // 1. Integrates analytics components
  assert.match(overviewSource, /<KnowledgeEbbinghausDistribution/);
  assert.match(overviewSource, /<KnowledgeSubjectMasteryPanel/);
  assert.match(overviewSource, /<KnowledgeWeakPointsRanking/);

  // 2. 5-KPI Tiles and quick gateways with container queries
  assert.match(overviewSource, /grid grid-cols-2 gap-3 @\[36rem\]:grid-cols-3 @\[60rem\]:grid-cols-4 @\[78rem\]:grid-cols-5/);
});
