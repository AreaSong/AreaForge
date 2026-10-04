import type { SearchIndexRequestIdentity } from "@/lib/api/search-index";
export function createSearchIndexIdentity(expectedGeneration: number): SearchIndexRequestIdentity {
  return { expectedGeneration, idempotencyKey: `search-${crypto.randomUUID()}` };
}
