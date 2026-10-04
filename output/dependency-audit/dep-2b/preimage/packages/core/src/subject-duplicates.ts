export type SubjectDuplicateReasonCode =
  | "NORMALIZED_NAME"
  | "NORMALIZED_STABLE_KEY"
  | "LEGACY_CODE";

export interface SubjectDuplicateCandidate {
  id: string;
  name: string;
  stableKey: string;
  legacyCode?: string | null;
  archived: boolean;
  sortOrder: number;
  referenceCount: number;
}

export interface SubjectDuplicateSignal {
  code: SubjectDuplicateReasonCode;
  normalizedValue: string;
  subjectIds: string[];
}

export interface SubjectDuplicateSet {
  subjectIds: string[];
  reasons: SubjectDuplicateSignal[];
  recommendedTargetId: string;
}

export interface NormalizedSubjectIdentity {
  name: string;
  stableKey: string;
  legacyCode: string | null;
}

export function normalizeSubjectIdentity(
  input: Pick<SubjectDuplicateCandidate, "name" | "stableKey" | "legacyCode">,
): NormalizedSubjectIdentity {
  return {
    name: normalizeHumanLabel(input.name),
    stableKey: normalizeMachineKey(input.stableKey),
    legacyCode: input.legacyCode ? normalizeMachineKey(input.legacyCode) : null,
  };
}

export function findSubjectDuplicateSets(
  candidates: readonly SubjectDuplicateCandidate[],
): SubjectDuplicateSet[] {
  const uniqueCandidates = uniqueById(candidates);
  const parent = new Map(uniqueCandidates.map((candidate) => [candidate.id, candidate.id]));
  const signals = buildSignals(uniqueCandidates);

  for (const signal of signals) {
    const [first, ...rest] = signal.subjectIds;
    if (!first) continue;
    for (const subjectId of rest) union(parent, first, subjectId);
  }

  const components = new Map<string, SubjectDuplicateCandidate[]>();
  for (const candidate of uniqueCandidates) {
    const root = findRoot(parent, candidate.id);
    const bucket = components.get(root) ?? [];
    bucket.push(candidate);
    components.set(root, bucket);
  }

  return [...components.values()]
    .filter((component) => component.length > 1)
    .map((component) => {
      const subjectIds = component.map((candidate) => candidate.id).sort();
      const componentIds = new Set(subjectIds);
      const ordered = [...component].sort(compareRecommendedTarget);
      return {
        subjectIds,
        reasons: signals.filter((signal) => signal.subjectIds.some((subjectId) => componentIds.has(subjectId))),
        recommendedTargetId: ordered[0]!.id,
      };
    })
    .sort((left, right) => left.recommendedTargetId.localeCompare(right.recommendedTargetId));
}

function buildSignals(candidates: SubjectDuplicateCandidate[]): SubjectDuplicateSignal[] {
  const buckets = new Map<string, { code: SubjectDuplicateReasonCode; value: string; subjectIds: string[] }>();
  for (const candidate of candidates) {
    const identity = normalizeSubjectIdentity(candidate);
    addSignalBucket(buckets, "NORMALIZED_NAME", identity.name, candidate.id);
    addSignalBucket(buckets, "NORMALIZED_STABLE_KEY", identity.stableKey, candidate.id);
    if (identity.legacyCode) addSignalBucket(buckets, "LEGACY_CODE", identity.legacyCode, candidate.id);
  }
  return [...buckets.values()]
    .filter((bucket) => bucket.subjectIds.length > 1)
    .map((bucket) => ({
      code: bucket.code,
      normalizedValue: bucket.value,
      subjectIds: [...bucket.subjectIds].sort(),
    }))
    .sort((left, right) => (left.code + ":" + left.normalizedValue).localeCompare(right.code + ":" + right.normalizedValue));
}

function addSignalBucket(
  buckets: Map<string, { code: SubjectDuplicateReasonCode; value: string; subjectIds: string[] }>,
  code: SubjectDuplicateReasonCode,
  value: string,
  subjectId: string,
): void {
  if (!value) return;
  const key = code + ":" + value;
  const bucket = buckets.get(key) ?? { code, value, subjectIds: [] };
  bucket.subjectIds.push(subjectId);
  buckets.set(key, bucket);
}

function compareRecommendedTarget(left: SubjectDuplicateCandidate, right: SubjectDuplicateCandidate): number {
  if (left.archived !== right.archived) return left.archived ? 1 : -1;
  if (left.referenceCount !== right.referenceCount) return right.referenceCount - left.referenceCount;
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return left.id.localeCompare(right.id);
}

function uniqueById(candidates: readonly SubjectDuplicateCandidate[]): SubjectDuplicateCandidate[] {
  const rows = new Map<string, SubjectDuplicateCandidate>();
  for (const candidate of candidates) {
    if (!rows.has(candidate.id)) rows.set(candidate.id, candidate);
  }
  return [...rows.values()];
}

function findRoot(parent: Map<string, string>, subjectId: string): string {
  const current = parent.get(subjectId);
  if (!current || current === subjectId) return subjectId;
  const root = findRoot(parent, current);
  parent.set(subjectId, root);
  return root;
}

function union(parent: Map<string, string>, left: string, right: string): void {
  const leftRoot = findRoot(parent, left);
  const rightRoot = findRoot(parent, right);
  if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
}

function normalizeHumanLabel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function normalizeMachineKey(value: string): string {
  return value.normalize("NFKC").trim().toLocaleUpperCase();
}
