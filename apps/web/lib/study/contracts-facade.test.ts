import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import * as contracts from "@/lib/contracts";
import type {
  ActionCenterTodayDto as ContractActionCenterTodayDto,
  AppShellStatusDto as ContractAppShellStatusDto,
  KnowledgePointDto as ContractKnowledgePointDto,
  PlanInboxItemDto as ContractPlanInboxItemDto,
  StudyResourceDto as ContractStudyResourceDto,
  SubjectDto as ContractSubjectDto,
} from "@/lib/contracts";
import type { ActionCenterTodayDto as ServiceActionCenterTodayDto } from "@/lib/study/action-center-service";
import type { AppShellStatusDto as ServiceAppShellStatusDto } from "@/lib/study/app-shell-service";
import type { KnowledgePointDto as ServiceKnowledgePointDto } from "@/lib/study/knowledge-point-service";
import type { PlanInboxItemDto as ServicePlanInboxItemDto } from "@/lib/study/plan-inbox-service";
import type { StudyResourceDto as ServiceStudyResourceDto } from "@/lib/study/study-resource-service";
import type { SubjectDto as DomainSubjectDto } from "@/lib/contracts/subject";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;

function assertTypeParity<Parity extends true>(): Parity {
  return true as Parity;
}

test("contract index preserves domain DTO identities", () => {
  assertTypeParity<Equal<ContractSubjectDto, DomainSubjectDto>>();
  assertTypeParity<Equal<ContractActionCenterTodayDto, ServiceActionCenterTodayDto>>();
  assertTypeParity<Equal<ContractAppShellStatusDto, ServiceAppShellStatusDto>>();
  assertTypeParity<Equal<ContractKnowledgePointDto, ServiceKnowledgePointDto>>();
  assertTypeParity<Equal<ContractPlanInboxItemDto, ServicePlanInboxItemDto>>();
  assertTypeParity<Equal<ContractStudyResourceDto, ServiceStudyResourceDto>>();
});

test("contract modules have no runtime exports or server framework imports", () => {
  assert.deepEqual(Object.keys(contracts), []);

  const directory = resolve(process.cwd(), "lib/contracts");
  for (const filename of readdirSync(directory).filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"))) {
    const source = readFileSync(resolve(directory, filename), "utf8");
    assert.doesNotMatch(source, /@areaforge\/db|@prisma|(?:from|import\s+type).*?["'](?:react|react\/[^"']+)["']/);

    for (const statement of source.matchAll(/^(?:import|export)\s+[^\n]+/gm)) {
      assert.match(
        statement[0],
        /^(?:import\s+type\b|export\s+type\b|export\s+interface\b)/,
        `${filename} must only expose type-only imports/exports`,
      );
    }
  }
});
