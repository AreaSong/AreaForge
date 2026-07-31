export type AiLearningTreeScope = "global" | "subject" | "branch";

export type BoundAiLearningTreeDraft =
  | { ok: true; markdown: string }
  | { ok: false; reason: string };

export function bindAiLearningTreeDraftMarkdown(input: {
  markdown: string;
  scope: AiLearningTreeScope;
  workspaceKey: string;
  subjectKey?: string;
  rootNodeKey?: string;
}): BoundAiLearningTreeDraft {
  const workspaceKey = input.workspaceKey.trim();
  const subjectKey = input.subjectKey?.trim();
  const rootNodeKey = input.rootNodeKey?.trim();
  if (!workspaceKey) return { ok: false, reason: "当前工作区缺少 stable key，无法校验 AI 草稿。" };
  if (input.scope !== "global" && !subjectKey) {
    return { ok: false, reason: "请先选择 AI 草稿所属科目。" };
  }
  if (input.scope === "branch" && !rootNodeKey) {
    return { ok: false, reason: "请先选择 AI 草稿所属分支根节点。" };
  }

  const body = stripLeadingFrontmatter(input.markdown).trim();
  if (!body) return { ok: false, reason: "AI 学习树草稿正文为空。" };
  const frontmatter = [
    "---",
    "protocol: AREAFORGE_LEARNING_TREE_V1",
    `scope: ${input.scope}`,
    `workspaceKey: ${workspaceKey}`,
    input.scope !== "global" ? `subjectKey: ${subjectKey}` : null,
    input.scope === "branch" ? `rootNodeKey: ${rootNodeKey}` : null,
    "---",
  ].filter((line): line is string => Boolean(line));
  return { ok: true, markdown: `${frontmatter.join("\n")}\n\n${body}\n` };
}

function stripLeadingFrontmatter(markdown: string): string {
  return markdown.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
