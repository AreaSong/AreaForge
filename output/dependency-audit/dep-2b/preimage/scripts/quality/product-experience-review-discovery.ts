import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseIndentedKeyValueRecord } from "./record-validator-common";

const recordPrefix = "product-experience-review-";
const templateName = "product-experience-review-record-template.md";

/**
 * Resolve the UX evidence input without silently falling back to a dated historical record.
 * An explicit path always wins; otherwise the newest parseable reviewedAt is selected and
 * the downstream current-binding validator remains the source of truth for validity.
 */
export function resolveProductExperienceReviewPath(root: string, configuredPath?: string): string | undefined {
  const explicit = configuredPath?.trim();
  if (explicit) return explicit;

  const recordsDir = path.join(root, "docs", "development");
  if (!existsSync(recordsDir)) return undefined;

  const candidates = readdirSync(recordsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(recordPrefix) && entry.name !== templateName && entry.name.endsWith(".md"))
    .flatMap((entry) => {
      const candidatePath = path.join(recordsDir, entry.name);
      const stat = lstatSync(candidatePath);
      if (stat.isSymbolicLink()) return [];
      const fields = parseIndentedKeyValueRecord(readFileSync(candidatePath, "utf8"));
      const reviewedAt = fields.get("reviewedAt");
      if (!reviewedAt) return [];
      const timestamp = Date.parse(reviewedAt);
      if (!Number.isFinite(timestamp)) return [];
      return [{ entryName: entry.name, candidatePath, timestamp }];
    })
    .sort((left, right) => right.timestamp - left.timestamp || right.entryName.localeCompare(left.entryName));

  const selected = candidates[0]?.candidatePath;
  return selected ? path.relative(root, selected) : undefined;
}
