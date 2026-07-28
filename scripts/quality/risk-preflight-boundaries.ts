const allowedBusinessRestoreRoutes = new Set([
  "apps/web/app/api/mistakes/[id]/restore/route.ts",
  "apps/web/app/api/notes/[noteid]/restore/route.ts",
  "apps/web/app/api/simulation/subject-results/[id]/loss-items/[lossitemid]/restore/route.ts",
  "apps/web/app/api/study-resources/[id]/restore/route.ts",
  "apps/web/app/api/syllabus/nodes/[id]/restore/route.ts",
]);

export function hasMasteryProofSubmissionGuard(source: string): boolean {
  return source.includes("disabled={pending || !canSubmitProof}");
}

export function isAllowedBusinessRestoreRoute(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  return allowedBusinessRestoreRoutes.has(normalized);
}
