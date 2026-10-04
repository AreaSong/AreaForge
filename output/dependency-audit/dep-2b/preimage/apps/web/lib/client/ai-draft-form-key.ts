export function getAiDraftFormStorageKey(
  endpoint: string,
  userId: string,
  draftContextKey: string,
): string {
  return `areaforge.ai-draft.form.${endpoint}.${userId}.${hashDraftContext(draftContextKey)}`;
}

function hashDraftContext(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
