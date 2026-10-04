import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultCloseoutPreferences,
  parseCloseoutPreferences,
} from "./closeout-preferences";

test("closeout preferences accept a complete current-device template", () => {
  assert.deepEqual(parseCloseoutPreferences({
    version: 1,
    outputPrompt: "  写下本次可以复核的产出  ",
    nextActionPrompt: "  标记下一次恢复位置  ",
    expandOptionalReview: true,
  }), {
    version: 1,
    outputPrompt: "写下本次可以复核的产出",
    nextActionPrompt: "标记下一次恢复位置",
    expandOptionalReview: true,
  });
});

test("closeout preferences reject empty, incomplete, and oversized templates", () => {
  assert.equal(parseCloseoutPreferences(null), null);
  assert.equal(parseCloseoutPreferences({ version: 1 }), null);
  assert.equal(parseCloseoutPreferences({
    ...defaultCloseoutPreferences,
    outputPrompt: " ",
  }), null);
  assert.equal(parseCloseoutPreferences({
    ...defaultCloseoutPreferences,
    nextActionPrompt: "a".repeat(161),
  }), null);
});
