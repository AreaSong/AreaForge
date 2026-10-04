import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_FUNCTION_LINE_LIMIT,
  inspectComponentComplexity,
  LEGACY_COMPONENT_LINE_BUDGETS,
} from "./web-component-complexity";

const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-web-component-complexity-"));
try {
  assert.equal(inspectComponentComplexity(workspace).violations.length, 3, "missing scan roots must fail closed");
  mkdirSync(path.join(workspace, "apps/web/app"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/components"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/routes"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/client"), { recursive: true });

  assert.deepEqual(LEGACY_COMPONENT_LINE_BUDGETS, {}, "legacy component budgets must remain empty");

  write("apps/web/components/small.tsx", "export function Small() { return <div />; }\n");
  assert.deepEqual(inspectComponentComplexity(workspace).violations, []);

  write("apps/web/components/limit.tsx", componentWithLines(500));
  assert.deepEqual(inspectComponentComplexity(workspace).violations, [], "500 physical lines must pass");

  write("apps/web/components/large.tsx", componentWithLines(501));
  assert.match(inspectComponentComplexity(workspace).violations[0]?.reason ?? "", /exceeds the 500-line/);

  write("apps/web/lib/routes/large-route.tsx", componentWithLines(501));
  assert(
    inspectComponentComplexity(workspace).violations.some((item) => item.file.endsWith("lib/routes/large-route.tsx")),
    "route composition TSX files must use the same hard limit",
  );

  write("apps/web/app/long-function.tsx", longFunctionWithLines(DEFAULT_FUNCTION_LINE_LIMIT + 1));
  const observationReport = inspectComponentComplexity(workspace);
  assert(
    observationReport.longFunctions.some((item) => item.file.endsWith("long-function.tsx")),
    "functions above 50 lines must remain visible as observations",
  );
  assert(
    !observationReport.violations.some((item) => item.file.endsWith("long-function.tsx")),
    "the function observation threshold must not become a hard failure",
  );

  write("apps/web/components/ignored.test.tsx", componentWithLines(501));
  assert(
    !inspectComponentComplexity(workspace).violations.some((item) => item.file.endsWith("ignored.test.tsx")),
    "test TSX files are outside the hard component limit",
  );

  write("apps/web/components/broken.tsx", "export function Broken( {\n");
  assert.match(
    inspectComponentComplexity(workspace).violations.find((item) => item.file.endsWith("broken.tsx"))?.reason ?? "",
    /malformed TSX/,
  );

  write("apps/web/lib/client/state-limit.ts", stateWithLines(500));
  assert.deepEqual(inspectComponentComplexity(workspace).stateViolations, [], "500 client state lines must pass");
  write("apps/web/lib/client/state-large.ts", stateWithLines(501));
  assert.match(inspectComponentComplexity(workspace).stateViolations[0]?.reason ?? "", /client state limit/);
  write("apps/web/lib/client/state-broken.ts", "export function Broken( {\n");
  assert(
    inspectComponentComplexity(workspace).stateViolations.some((item) => item.file.endsWith("state-broken.ts") && item.reason.includes("malformed")),
    "malformed client state TS must fail closed",
  );

  console.log("web component complexity selftest passed");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function write(relative: string, source: string): void {
  writeFileSync(path.join(workspace, relative), source);
}

function componentWithLines(lines: number): string {
  const body = Array.from({ length: Math.max(0, lines - 2) }, () => "// line").join("\n");
  return `export function Large() {\n${body}\n}\n`;
}

function longFunctionWithLines(lines: number): string {
  const body = Array.from({ length: Math.max(0, lines - 2) }, () => "  // observation").join("\n");
  return `export function LongFunction() {\n${body}\n}\n`;
}

function stateWithLines(lines: number): string {
  const body = Array.from({ length: Math.max(0, lines - 2) }, () => "// state line").join("\n");
  return `export function State() {\n${body}\n}\n`;
}
