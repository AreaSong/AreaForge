import assert from "node:assert/strict";
import test from "node:test";
import {
  appendSelectionItem,
  createAiSelectionItem,
  mergeSelectionItems,
} from "./ai-assistant-selection";

function item(source: string, text: string, identity: string) {
  return createAiSelectionItem({
    kind: "element",
    source,
    label: "标题",
    text,
    rect: null,
  }, () => identity);
}

test("same text from different elements keeps separate identities and fingerprints", () => {
  const first = item("main>section:nth-of-type(1)", "相同正文", "identity-1");
  const second = item("main>section:nth-of-type(2)", "相同正文", "identity-2");
  const merged = mergeSelectionItems([], [first, second]);

  assert.notEqual(first.identity, second.identity);
  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(merged.length, 2);
});

test("full fingerprints do not merge known 32-bit hash collisions", () => {
  const first = item("source", "Aa", "identity-1");
  const second = item("source", "BB", "identity-2");

  assert.notEqual(first.fingerprint, second.fingerprint);
  assert.equal(appendSelectionItem([first], second).length, 2);
});

test("merging the same fingerprint preserves the mounted React identity", () => {
  const first = item("source", "正文", "identity-1");
  const refreshed = { ...item("source", "正文", "identity-2"), rect: { top: 1, left: 2, width: 3, height: 4 } };
  const [merged] = mergeSelectionItems([first], [refreshed]);

  assert.equal(merged.identity, "identity-1");
  assert.deepEqual(merged.rect, refreshed.rect);
});
