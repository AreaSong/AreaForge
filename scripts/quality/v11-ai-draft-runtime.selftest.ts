import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../packages/db/src/index";
import { generateAiDraft, previewAiDraft } from "../../apps/web/lib/study/ai-draft-service";
import { bindAiLearningTreeDraftMarkdown } from "../../apps/web/lib/client/ai-learning-tree-draft";
import { createFallbackLearningTreeDraftAdvice } from "../../packages/ai/src/index";
import { parseLearningTreeMarkdown } from "../../packages/core/src/learning-tree-parse";
import type { AiDraftEndpoint } from "../../packages/core/src/ai-draft";

const cases: Array<{ endpoint: AiDraftEndpoint; input: Record<string, unknown>; schemaVersion: string }> = [
  { endpoint: "learning-tree", input: { phase: "preview", selectedText: "极限与连续", scope: "subject", checkedProjection: { subjectLabel: "数学" } }, schemaVersion: "learning-tree-draft-v1" },
  { endpoint: "knowledge-card", input: { phase: "preview", selectedText: "先检查定义域", kind: "METHOD", checkedProjection: { subjectLabel: "数学" } }, schemaVersion: "knowledge-card-draft-v1" },
  { endpoint: "plan", input: { phase: "preview", selectedText: "完成极限复测", checkedProjection: { defaultDurationMinutes: 25 } }, schemaVersion: "plan-draft-v1" },
  { endpoint: "motivation", input: { phase: "preview", selectedText: "只做眼前一步", tone: "CALM" }, schemaVersion: "motivation-draft-v1" },
];

try {
  if (process.env.AREAFORGE_V11_AI_ISOLATED_DB !== "1") throw new Error("requires AREAFORGE_V11_AI_ISOLATED_DB=1");
  const [{ current_database: database }] = await prisma.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!database.includes("v11ai")) throw new Error("refused database without v11ai marker");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "AiDraftOperation", "ExamWorkspace", "User" RESTART IDENTITY CASCADE`);
  const user = await prisma.user.create({ data: { email: `v11ai-${randomUUID()}@example.invalid`, passwordHash: "synthetic" } });
  const foreign = await prisma.user.create({ data: { email: `v11ai-foreign-${randomUUID()}@example.invalid`, passwordHash: "synthetic" } });
  await prisma.examWorkspace.create({ data: { userId: user.id, stableKey: "ai", name: "AI", status: "ACTIVE" } });
  await prisma.examWorkspace.create({ data: { userId: foreign.id, stableKey: "foreign", name: "Foreign", status: "ACTIVE" } });

  const fallbackTree = createFallbackLearningTreeDraftAdvice({
    selectedText: "极限与连续",
    scope: "subject",
    subjectLabel: "数学",
  });
  const boundTree = bindAiLearningTreeDraftMarkdown({
    markdown: fallbackTree.markdownDraft,
    scope: "subject",
    workspaceKey: "ai",
    subjectKey: "subject_math",
  });
  assert.equal(boundTree.ok, true);
  assert.equal(boundTree.ok && parseLearningTreeMarkdown(boundTree.markdown).ok, true);
  assert.equal(
    bindAiLearningTreeDraftMarkdown({ markdown: fallbackTree.markdownDraft, scope: "branch", workspaceKey: "ai", subjectKey: "subject_math" }).ok,
    false,
  );

  for (const fixture of cases) {
    const preview = await previewAiDraft(user.id, fixture.endpoint, fixture.input);
    assert.equal(preview.endpoint, fixture.endpoint);
    assert.equal(preview.outputSchema, fixture.schemaVersion);
    assert.equal("selectionHash" in preview, false);
    assert.equal("providerPayloadHash" in preview, false);
    await assert.rejects(
      () => generateAiDraft(foreign.id, fixture.endpoint, preview.previewToken, { ...fixture.input, phase: "generate", previewToken: preview.previewToken }),
      (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_TOKEN_INVALID",
    );
    await assert.rejects(
      () => generateAiDraft(user.id, fixture.endpoint, preview.previewToken, { ...fixture.input, selectedText: `${fixture.input.selectedText} tampered`, phase: "generate", previewToken: preview.previewToken }),
      (error: unknown) => error instanceof Error && error.message === "AI_DRAFT_PROJECTION_MISMATCH",
    );
    const generated = await generateAiDraft(user.id, fixture.endpoint, preview.previewToken, { ...fixture.input, phase: "generate", previewToken: preview.previewToken });
    assert.equal(generated.status, "local_rule_fallback");
    assert.equal(generated.externalCall, false);
    assert.equal((generated.draft as { schemaVersion: string }).schemaVersion, fixture.schemaVersion);
    assert.equal(generated.meta.sensitiveContextIncluded, false);
  }

  const operations = await prisma.aiDraftOperation.findMany({ orderBy: { createdAt: "asc" } });
  assert.equal(operations.length, cases.length);
  assert.ok(operations.every((operation) => operation.status === "SUCCEEDED" && operation.consumedAt));
  assert.ok(operations.every((operation) => operation.resultReference?.startsWith("draft:")));
  console.log(JSON.stringify({
    schemaVersion: "v11-ai-draft-runtime-selftest-v1",
    status: "pass",
    database,
    checks: {
      fourExplicitPurposes: "pass",
      actorWorkspaceBinding: "pass",
      payloadTamperRejected: "pass",
      localFallbackNoProviderCall: "pass",
      digestAndContentNotPersisted: "pass",
      learningTreeDraftCanonicalBinding: "pass",
    },
  }, null, 2));
  console.log("PASS v1.1 AI draft isolated PostgreSQL runtime selftest");
} finally {
  await prisma.$disconnect();
}
