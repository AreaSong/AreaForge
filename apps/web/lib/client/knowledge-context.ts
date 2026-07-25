export const KNOWLEDGE_CONTEXT_EVENT = "areaforge:knowledge-context";
export const KNOWLEDGE_CONTEXT_KEYS = ["workspaceId", "subjectId", "syllabusNodeId", "q"] as const;

export function readKnowledgeContextQuery(): string {
  const current = new URLSearchParams(window.location.search);
  const context = new URLSearchParams();
  for (const key of KNOWLEDGE_CONTEXT_KEYS) {
    const value = current.get(key);
    if (value) context.set(key, value);
  }
  return context.toString();
}

export function updateKnowledgeContext(patch: Partial<Record<(typeof KNOWLEDGE_CONTEXT_KEYS)[number], string | null>>) {
  const next = new URL(window.location.href);
  for (const [key, value] of Object.entries(patch)) {
    if (value?.trim()) next.searchParams.set(key, value.trim());
    else next.searchParams.delete(key);
  }
  window.history.replaceState(window.history.state, "", next);
  window.dispatchEvent(new Event(KNOWLEDGE_CONTEXT_EVENT));
}
