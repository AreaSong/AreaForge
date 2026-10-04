import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CAPABILITY_BATCHES,
  CAPABILITY_STATUSES,
  collectBoundaryViolations,
  validateInventory,
} from "./web-shared-boundary";

const workspace = mkdtempSync(path.join(tmpdir(), "areaforge-web-shared-boundary-"));
try {
  mkdirSync(path.join(workspace, "apps/web/components/ui"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/components"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/contracts"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/api"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/client"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/study"), { recursive: true });
  mkdirSync(path.join(workspace, "apps/web/lib/routes"), { recursive: true });

  writeFile("apps/web/components/ui/ok.tsx", "export const ok = true;\n");
  writeFile("apps/web/components/ui/bad.tsx", 'import { auth } from "@/lib/auth/session";\nexport const bad = auth;\n');
  writeFile("apps/web/components/ui/api.tsx", 'import { requestApiResult } from "@/lib/api/client";\nexport const bad = requestApiResult;\n');
  writeFile("apps/web/components/bad.tsx", 'import { prisma } from "@areaforge/db";\nexport const bad = prisma;\n');
  writeFile("apps/web/components/bad-type.tsx", 'import type { Thing } from "@/lib/study/example-service";\nexport type Bad = Thing;\n');
  writeFile("apps/web/components/runtime.tsx", 'import { loadThing } from "@/lib/study/example-service";\nexport const bad = loadThing;\n');
  writeFile("apps/web/components/multiline-runtime.tsx", 'import {\n  loadThing,\n} from "@/lib/study/example-service";\nexport const bad = loadThing;\n');
  writeFile("apps/web/components/dynamic-runtime.tsx", 'export const bad = import("@/lib/study/example-service");\n');
  writeFile("apps/web/components/export-type.tsx", 'export type { Thing } from "@/lib/study/example-service";\n');
  writeFile("apps/web/components/workspace-required-layout.tsx", 'import { findActiveWorkspaceOrNull } from "@/lib/study/exam-workspace-service";\nexport const allowed = findActiveWorkspaceOrNull;\n');
  writeFile("apps/web/lib/study/browser-leak.ts", 'import { readThing } from "@/lib/client/storage-port";\nexport const leak = readThing;\n');
  writeFile("apps/web/lib/study/ui-leak.ts", 'import { Button } from "@/components/ui/button";\nexport const leak = Button;\n');
  writeFile("apps/web/lib/study/service.ts", "export {};\n");
  writeFile("apps/web/lib/study/types.ts", "export type Removed = never;\n");
  writeFile("apps/web/lib/contracts/study.ts", "export type Removed = never;\n");
  writeFile("apps/web/lib/client/allowed-type.ts", 'import type { Thing } from "@/lib/study/types";\nexport type Allowed = Thing;\n');
  writeFile("apps/web/lib/client/allowed-import-equals.ts", 'import type Thing = require("@/lib/study/types");\nexport type Allowed = Thing;\n');
  writeFile("apps/web/lib/api/allowed-type.ts", 'export type { ApiErrorSource } from "../client/api-errors";\n');
  writeFile("apps/web/lib/client/bad-type.ts", 'import type {\n  Thing,\n} from "@/lib/study/example-service";\nexport type Bad = Thing;\n');
  writeFile("apps/web/lib/contracts/bad.ts", 'import React from "react";\nexport type Bad = typeof React;\n');
  writeFile("apps/web/lib/contracts/runtime-study.ts", 'export const bad = require("@/lib/study/example-service");\n');
  writeFile("apps/web/lib/contracts/service-dtos.ts", 'export type { Thing } from "@/lib/study/example-service";\n');
  writeFile("apps/web/lib/contracts/disallowed-type.ts", 'export type { Thing } from "@/lib/study/example-service";\n');
  writeFile("apps/web/lib/routes/facade.ts", 'import { getTodayDashboard } from "@/lib/study/service";\nexport const bad = getTodayDashboard;\n');

  const violations = collectBoundaryViolations(workspace);
  assert.equal(violations.length, 21);
  assert(violations.some((item) => item.reason.includes("database")));
  assert(violations.some((item) => item.reason.includes("API transport")));
  assert(violations.some((item) => item.reason.includes("type-only")));
  assert(violations.some((item) => item.reason.includes("legacy study services")));
  assert(violations.some((item) => item.reason.includes("UI components")));
  assert(violations.some((item) => item.reason.includes("browser/client")));
  assert(violations.some((item) => item.reason.includes("removed study service facade")));
  assert.equal(violations.filter((item) => item.reason.includes("must not be recreated")).length, 3);
  assert.equal(violations.filter((item) => item.file.endsWith("multiline-runtime.tsx")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("dynamic-runtime.tsx")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("export-type.tsx")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("/allowed-type.ts")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("allowed-import-equals.ts")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("workspace-required-layout.tsx")).length, 0);
  assert.equal(violations.filter((item) => item.file.endsWith("service-dtos.ts")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("disallowed-type.ts")).length, 1);
  assert.equal(violations.filter((item) => item.file.endsWith("lib/api/allowed-type.ts")).length, 0);

  writeFile("apps/web/components/workspace-required-layout.tsx", 'import { forbidden } from "@/lib/study/another-service";\nexport const bad = forbidden;\n');
  assert.equal(collectBoundaryViolations(workspace).filter((item) => item.file.endsWith("workspace-required-layout.tsx")).length, 1);

  writeFile("apps/web/lib/api/runtime-client-leak.ts", 'export { isUnauthorized } from "../client/api-errors";\n');
  const apiClientViolations = collectBoundaryViolations(workspace)
    .filter((item) => item.file.endsWith("lib/api/runtime-client-leak.ts"));
  assert.equal(apiClientViolations.length, 1);
  assert.match(apiClientViolations[0]?.reason ?? "", /must not runtime-depend on browser\/client adapters/);

  const validInventory = {
    schemaVersion: 1,
    mode: "areaforge_web_shared_capability_inventory",
    owner: "owner",
    capabilities: [{
      id: "x-capability",
      path: "apps/web/components/ui/ok.tsx",
      kind: "quality-policy",
      owner: "owner",
      status: CAPABILITY_STATUSES[0],
      batch: CAPABILITY_BATCHES[0],
      contract: "apps/web/components/ui/ok.tsx",
      validation: ["test"],
    }],
  };
  assert.deepEqual(validateInventory(validInventory, workspace), []);

  const duplicatePathInventory = {
    ...validInventory,
    capabilities: [
      validInventory.capabilities[0],
      { ...validInventory.capabilities[0], id: "child-capability", path: "apps/web/components/ui" },
    ],
  };
  const overlapErrors = validateInventory(duplicatePathInventory, workspace);
  assert(overlapErrors.some((error) => error.includes("overlaps")));

  const invalidEnumInventory = {
    ...validInventory,
    capabilities: [{ ...validInventory.capabilities[0], kind: "unknown-kind" }],
  };
  assert(validateInventory(invalidEnumInventory, workspace).some((error) => error.includes("must be one of")));

  const canonicalDtoInventory = {
    ...validInventory,
    capabilities: [{
      ...validInventory.capabilities[0],
      id: "dto-contracts",
      path: "apps/web/lib/contracts",
      kind: "type-contract",
    }],
  };
  assert.deepEqual(validateInventory(canonicalDtoInventory, workspace), []);

  const fragmentedDtoInventory = {
    ...canonicalDtoInventory,
    capabilities: [{
      ...canonicalDtoInventory.capabilities[0],
      path: "apps/web/lib/contracts/service-dtos.ts",
    }],
  };
  assert(
    validateInventory(fragmentedDtoInventory, workspace)
      .some((error) => error.includes("canonical DTO contract scope")),
  );

  const nestedContractInventory = {
    ...validInventory,
    capabilities: [{
      ...validInventory.capabilities[0],
      id: "nested-contract",
      path: "apps/web/lib/contracts/service-dtos.ts",
      kind: "type-contract",
    }],
  };
  assert(
    validateInventory(nestedContractInventory, workspace)
      .some((error) => error.includes("single canonical DTO contract scope")),
  );

  const legacyInventory = {
    ...validInventory,
    capabilities: [{
      ...validInventory.capabilities[0],
      id: "study-services",
      path: "apps/web/lib/study",
      kind: "server-adapter",
      status: "legacy-facade",
    }],
  };
  const legacyErrors = validateInventory(legacyInventory, workspace);
  assert(legacyErrors.some((error) => error.includes("legacy study service")));
  assert(legacyErrors.some((error) => error.includes("status must be one of")));

  const malformedInventory = { ...validInventory, capabilities: [{ ...validInventory.capabilities[0], path: 42 }] };
  assert(validateInventory(malformedInventory, workspace).some((error) => error.includes("path must be a non-empty string")));

  console.log("web shared boundary selftest passed.");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}

function writeFile(relative: string, contents: string): void {
  writeFileSync(path.join(workspace, relative), contents);
}
