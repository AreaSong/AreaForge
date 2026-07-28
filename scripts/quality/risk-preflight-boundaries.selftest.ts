import {
  hasMasteryProofSubmissionGuard,
  isAllowedBusinessRestoreRoute,
} from "./risk-preflight-boundaries";

const allowedRoutes = [
  "apps/web/app/api/mistakes/[id]/restore/route.ts",
  "apps/web/app/api/notes/[noteId]/restore/route.ts",
  "apps/web/app/api/simulation/subject-results/[id]/loss-items/[lossItemId]/restore/route.ts",
  "apps/web/app/api/study-resources/[id]/restore/route.ts",
  "apps/web/app/api/syllabus/nodes/[id]/restore/route.ts",
];

for (const route of allowedRoutes) {
  assert(isAllowedBusinessRestoreRoute(route), `${route} should be an allowed business restore route`);
}

for (const route of [
  "apps/web/app/api/system/restore/route.ts",
  "apps/web/app/api/notes/[noteId]/restore-all/route.ts",
  "apps/web/app/api/syllabus/nodes/restore/route.ts",
  "apps/web/app/api/backup/route.ts",
  "apps/web/app/api/migrations/route.ts",
]) {
  assert(!isAllowedBusinessRestoreRoute(route), `${route} must remain outside the exact allowlist`);
}

assert(
  hasMasteryProofSubmissionGuard("<button disabled={pending || !canSubmitProof}>保存证明</button>"),
  "the stricter pending and proof guard should pass",
);
assert(
  !hasMasteryProofSubmissionGuard("<button disabled={pending}>保存证明</button>"),
  "pending alone must not satisfy the proof guard",
);
assert(
  !hasMasteryProofSubmissionGuard("<button disabled={!canSubmitProof}>保存证明</button>"),
  "the current guard must also block duplicate submission while pending",
);

console.log("risk preflight boundary selftest passed.");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
