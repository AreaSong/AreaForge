import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectClientBoundarySummary, collectClientBoundaryViolations } from "./web-client-boundary";

const root = process.cwd();
const scriptPath = path.join(root, "scripts/quality/web-client-boundary.ts");
const tsxBin = path.join(root, "node_modules/.bin/tsx");
const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-web-client-boundary-"));

try {
  mkdirSync(path.join(workspace, "apps/web/components/ui"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/components/generated"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/app/api/example"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/client"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/routes"), { recursive: true });

  write("apps/web/lib/client/storage-port.ts", `
    const local = window.localStorage;
    const session = globalThis["sessionStorage"];
    export { local, session };
  `);
  write("apps/web/lib/client/api-errors.ts", `
    export const unauthenticated = (response: Response) => response.status === 401;
    export const conflict = (response: Response) => 409 !== response["status"];
  `);
  write("apps/web/lib/client/injected.ts", `
    export function read(environment: { localStorage: { getItem(key: string): string | null } }) {
      return environment.localStorage.getItem("draft");
    }
  `);
  write("apps/web/components/ui/ignored.tsx", `const value = window.localStorage; const status = result.status === 401;`);
  write("apps/web/components/generated/ignored.tsx", `const value = globalThis["sessionStorage"];`);
  write("apps/web/app/server-page.tsx", `
    const value = window.localStorage;
    const unauthorized = response.status === 401;
    export default function ServerPage() { return unauthorized ? value.length : 0; }
  `);
  write("apps/web/app/api/example/route.ts", `
    export function GET() {
      const value = globalThis.sessionStorage;
      return Response.json({ conflict: response.status === 409, value });
    }
  `);

  const emptyBudgets = { storage: {}, status: {} };
  assert.deepEqual(collectClientBoundaryViolations(workspace, emptyBudgets), [], "boundary helpers and injected ports should pass");
  assert.deepEqual(collectClientBoundarySummary(workspace), { storage: {}, status: {} });

  write("apps/web/components/violations.tsx", `
    const local = window
      ["localStorage"];
    const session = globalThis.sessionStorage;
    const unauthenticated = response
      .status === 401;
    const conflict = 409 !== result["status"];
  `);
  const violations = collectClientBoundaryViolations(workspace, emptyBudgets);
  assert(violations.some((item) => item.reason.includes("browser storage access is not in the legacy budget (2 occurrence(s))")));
  assert(violations.some((item) => item.reason.includes("explicit HTTP 401/409 status comparison is not in the legacy budget (2 occurrence(s))")));

  write("apps/web/components/status-aliases.tsx", `
    function fromParameter(status: number) { return status === 401; }
    const { status: conflictCode } = response;
    const conflict = conflictCode === 409;
    const responseCode = response.status;
    const copiedCode = responseCode;
    const unauthorized = 401 === copiedCode;
    function unrelated(code: number) { return code === 409; }
  `);
  const aliasViolations = collectClientBoundaryViolations(workspace, emptyBudgets);
  assert(aliasViolations.some((item) => (
    item.file.endsWith("components/status-aliases.tsx")
      && item.reason.includes("explicit HTTP 401/409 status comparison is not in the legacy budget (3 occurrence(s))")
  )), "status parameters, destructuring, and chained aliases must be rejected without treating unrelated bindings as HTTP status");

  write("apps/web/app/client-page.tsx", `
    "use client";
    const value = window.localStorage;
    const conflict = response.status === 409;
    export default function ClientPage() { return conflict ? value.length : 0; }
  `);
  const appViolations = collectClientBoundaryViolations(workspace, emptyBudgets);
  assert.equal(
    appViolations.filter((item) => item.file.endsWith("app/client-page.tsx")).length,
    2,
    "top-level use-client App Router modules must be scanned",
  );
  assert.equal(
    appViolations.filter((item) => item.file.endsWith("app/server-page.tsx") || item.file.endsWith("route.ts")).length,
    0,
    "server components and route handlers must remain outside the browser client boundary",
  );

  write("apps/web/lib/routes/client-view.tsx", `
    "use client";
    const value = window.sessionStorage;
    const unauthorized = response.status === 401;
    export function ClientView() { return unauthorized ? value.length : 0; }
  `);
  assert.equal(
    collectClientBoundaryViolations(workspace, emptyBudgets)
      .filter((item) => item.file.endsWith("lib/routes/client-view.tsx")).length,
    2,
    "use-client route compositions must stay inside the browser boundary",
  );

  write("apps/web/components/focus-session-client.tsx", "const value = window.localStorage;\n");
  const reducedWithoutRatchet = collectClientBoundaryViolations(workspace, {
    storage: { "apps/web/components/focus-session-client.tsx": 2 },
    status: {},
  });
  assert(reducedWithoutRatchet.some((item) => item.reason.includes("does not match exact legacy budget")));

  write("apps/web/components/malformed.tsx", "const broken = window.localStorage(;");
  const malformed = collectClientBoundaryViolations(workspace, emptyBudgets);
  assert(malformed.some((item) => item.file.endsWith("components/malformed.tsx") && item.reason.includes("unable to parse TypeScript source")), "malformed source must fail closed");

  const cliResult = spawnSync(tsxBin, [scriptPath, "--workspace", workspace], { encoding: "utf8" });
  assert.equal(cliResult.status, 1, "CLI should reject boundary violations");
  const cliOutput = `${cliResult.stdout}\n${cliResult.stderr}`;
  assert.match(cliOutput, /web client boundary debt: storage/);
  assert.match(cliOutput, /web client boundary debt: status/);
  assert.match(cliOutput, /FAIL apps\/web\/app\/client-page\.tsx:\d+:/);
  assert.match(cliOutput, /web client boundary check failed/);

  console.log("web client boundary selftest passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function write(relative: string, contents: string): void {
  writeFileSync(path.join(workspace, relative), contents);
}
