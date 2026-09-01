export interface AiSelectionRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PersistedAiSelectionItem {
  identity: string;
  fingerprint: string;
  label: string;
  text: string;
}

export interface AiSelectionItem extends PersistedAiSelectionItem {
  rect: AiSelectionRect | null;
}

export function createAiSelectionItem(
  input: {
    kind: "element" | "text" | "legacy";
    source: string;
    label: string;
    text: string;
    rect: AiSelectionRect | null;
  },
  createIdentity: () => string = createSelectionIdentity,
): AiSelectionItem {
  const label = input.label.slice(0, 256);
  const text = input.text.slice(0, 3_000);
  return {
    identity: createIdentity(),
    fingerprint: createSelectionFingerprint({
      kind: input.kind,
      source: input.source.slice(0, 2_048),
      label,
      text,
    }),
    label,
    text,
    rect: input.rect,
  };
}

export function createSelectionFingerprint(input: {
  kind: string;
  source: string;
  label: string;
  text: string;
}): string {
  return JSON.stringify([input.kind, input.source, input.label, input.text]);
}

export function appendSelectionItem(
  current: AiSelectionItem[],
  addition: AiSelectionItem,
): AiSelectionItem[] {
  return current.some((item) => item.fingerprint === addition.fingerprint)
    ? current
    : [...current, addition];
}

export function mergeSelectionItems(
  current: AiSelectionItem[],
  additions: AiSelectionItem[],
): AiSelectionItem[] {
  const merged = [...current];
  const indexByFingerprint = new Map(current.map((item, index) => [item.fingerprint, index]));
  for (const addition of additions) {
    const existingIndex = indexByFingerprint.get(addition.fingerprint);
    if (existingIndex === undefined) {
      indexByFingerprint.set(addition.fingerprint, merged.length);
      merged.push(addition);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = { ...addition, identity: existing.identity };
  }
  return merged;
}

export function getElementSelectionSource(element: Element): string {
  const explicit = element.getAttribute("data-ai-selection-key") || element.id;
  if (explicit) return `explicit:${explicit}`;
  return getElementPath(element);
}

export function getRangeSelectionSource(range: Range | null, fallback: Element): string {
  if (!range) return `fallback:${getElementSelectionSource(fallback)}`;
  return [
    getNodePath(range.startContainer),
    range.startOffset,
    getNodePath(range.endContainer),
    range.endOffset,
  ].join(":");
}

let fallbackIdentity = 0;

function createSelectionIdentity(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackIdentity += 1;
  return `selection-${Date.now().toString(36)}-${fallbackIdentity.toString(36)}`;
}

function getNodePath(node: Node): string {
  const element = node instanceof Element ? node : node.parentElement;
  const suffix = node instanceof Text
    ? `:text:${Array.from(element?.childNodes ?? []).indexOf(node)}`
    : "";
  return `${element ? getElementPath(element) : "document"}${suffix}`;
}

function getElementPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && segments.length < 10) {
    const explicit = current.getAttribute("data-ai-selection-key") || current.id;
    if (explicit) {
      segments.unshift(`${current.tagName.toLowerCase()}#${explicit}`);
      break;
    }
    const parent: Element | null = current.parentElement;
    const siblings = parent
      ? Array.from(parent.children).filter((sibling) => sibling.tagName === current?.tagName)
      : [];
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${Math.max(index, 1)})`);
    current = parent;
  }
  return segments.join(">");
}
