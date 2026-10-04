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

/** 回收站解除业务栅栏不等于服务器 restore；只识别已确认的精确控制面。 */
export function isScopedDataDeletionControlRoute(file: string, route: string, service: string): boolean {
  if (file.replaceAll("\\", "/").toLowerCase() !== "apps/web/app/api/system/deletions/[intentid]/route.ts") return false;
  const required = ["requireApiUser", "requireRecentReauthentication", "expectedRevision", ".strict()", "controlUserDeletion", "export async function PATCH"];
  const serverExecution = /child_process|node:fs|docker|pg_restore|pg_dump|executeDatabaseDeletion|runDatabaseDeleteWorker|scripts\/workers|\b(?:spawn|exec|execFile|execSync|spawnSync)\s*\(/;
  return required.every(token => route.includes(token))
    && /z\.enum\(\["cancel",\s*"restore",\s*"retry"\]\)/.test(route)
    && service.includes("controlDatabaseDeletion") && service.includes("getDeletionControlClient")
    && !serverExecution.test(route + "\n" + service);
}
