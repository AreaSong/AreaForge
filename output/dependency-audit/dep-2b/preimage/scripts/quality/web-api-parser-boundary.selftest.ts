import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as ts from "typescript";
import {
  classifyJsonReceiver,
  collectParserImports,
  collectParserViolations,
  PARSER_MODULE,
} from "./web-api-parser-boundary";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/quality/web-api-parser-boundary.ts");
const tsxBin = path.join(root, "node_modules/.bin/tsx");
const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-web-api-parser-boundary-"));

try {
  mkdirSync(path.join(workspace, "apps/web/components"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/app/api/example"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/client"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/api"), { recursive: true });

  write("apps/web/lib/api/client.ts", "export async function readApiJson(response: Response) { return response.json(); }\n");
  write("apps/web/components/valid.tsx", `
import { readApiJson, requestApiResult } from "${PARSER_MODULE}";
import type { ResponseBody } from "${PARSER_MODULE}";
const result = await requestApiResult("/api");
const response = result.response;
const body = await readApiJson(
  response,
);
const lazy = import("${PARSER_MODULE}");
const factory = Response.json({ ok: true });
export type { ResponseBody } from "${PARSER_MODULE}";
`);
  write("apps/web/lib/client/request.ts", `
async function submit(request: Request) {
  return request.json();
}
`);
  assert.deepEqual(collectParserViolations(workspace, { allowRequestJson: true }), [], "valid parser usage should pass");
  const browserRequestViolations = collectParserViolations(workspace);
  assert(browserRequestViolations.some((item) => item.file.endsWith("lib/client/request.ts") && item.reason.includes("request.json")));

  write("apps/web/app/server-page.tsx", `
const response = await fetch("/api/server-component");
const body = await response.json();
export default function ServerPage() { return body; }
`);
  write("apps/web/app/api/example/route.ts", `
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json(body);
}
`);
  write("apps/web/app/client-page.tsx", `
"use client";
const response = await fetch("/api/client-page");
const body = await response.json();
export default function ClientPage() { return body; }
`);
  const appViolations = collectParserViolations(workspace);
  assert.equal(
    appViolations.filter((item) => item.file.endsWith("app/client-page.tsx")).length,
    2,
    "top-level use-client App Router modules must be scanned",
  );
  assert.equal(
    appViolations.filter((item) => item.file.endsWith("app/server-page.tsx") || item.file.endsWith("route.ts")).length,
    0,
    "server components and route handlers must remain outside the browser parser boundary",
  );

  write("apps/web/components/violations.tsx", `
export {};
const response = await fetch("/api");
const globalResponse = await globalThis.fetch("/api/global");
const windowResponse = await window.fetch("/api/window");
const direct = await response.json();
const wrapped = await (response).json();
const lineBreak = await response
  .json();
const unknown = await payload.json();
const indexed = await response["json"]();
const extracted = response.json;
`);
  const violations = collectParserViolations(workspace);
  const fixtureViolations = violations.filter((item) => item.file.endsWith("components/violations.tsx"));
  assert.equal(
    fixtureViolations.filter((item) => item.reason.includes("direct fetch")).length,
    3,
    "direct fetch variants must be rejected",
  );
  for (const [line, reason] of [
    [6, "response.json"],
    [7, "response.json"],
    [8, "response.json"],
    [10, "unknown receiver"],
    [11, "response.json"],
    [12, "response.json"],
  ] as const) {
    assert(
      fixtureViolations.some((item) => item.line === line && item.reason.includes(reason)),
      `expected parser violation at fixture line ${line}`,
    );
  }

  const strictRequestViolations = collectParserViolations(workspace, { allowRequestJson: false });
  assert(strictRequestViolations.some((item) => item.file.endsWith("lib/client/request.ts") && item.reason.includes("request.json")));

  const importFile = path.join(workspace, "apps/web/components/valid.tsx");
  const imports = collectParserImports(workspace, importFile);
  const parserImports = imports.filter((item) => item.specifier === PARSER_MODULE);
  assert.equal(parserImports.length, 4, "static, type-only, dynamic and export parser imports should be discovered");
  assert(parserImports.some((item) => item.typeOnly));
  assert(parserImports.some((item) => item.dynamic));

  assert.equal(classifyFixtureReceiver("response.json()"), "response");
  assert.equal(classifyFixtureReceiver("request.json()"), "request");
  assert.equal(classifyFixtureReceiver("Response.json({ ok: true })"), "static-response-factory");
  assert.equal(classifyFixtureReceiver("payload.json()"), "unknown");

  const cliResult = spawnSync(tsxBin, [scriptPath, "--workspace", workspace], { encoding: "utf8" });
  assert.equal(cliResult.status, 1, "CLI should fail when a direct parser violation exists");
  const cliOutput = `${cliResult.stdout}\n${cliResult.stderr}`;
  assert.match(cliOutput, /FAIL apps\/web\/components\/violations\.tsx:\d+:/);
  assert.match(cliOutput, /FAIL apps\/web\/app\/client-page\.tsx:\d+:/);
  assert.match(cliOutput, /web API parser boundary check failed/);

  rmSync(path.join(workspace, "apps/web/components/violations.tsx"), { force: true });
  rmSync(path.join(workspace, "apps/web/lib/client/request.ts"), { force: true });
  rmSync(path.join(workspace, "apps/web/app/client-page.tsx"), { force: true });
  const cleanResult = spawnSync(tsxBin, [scriptPath, "--workspace", workspace], { encoding: "utf8" });
  assert.equal(cleanResult.status, 0, "CLI should pass after all direct parser usage is removed");

  console.log("web API parser boundary selftest passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function write(relative: string, contents: string): void {
  writeFileSync(path.join(workspace, relative), contents);
}

function classifyFixtureReceiver(source: string): ReturnType<typeof classifyJsonReceiver> {
  const sourceFile = ts.createSourceFile("fixture.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let result: ReturnType<typeof classifyJsonReceiver> = "unknown";
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "json") {
      result = classifyJsonReceiver(node.expression.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result;
}
