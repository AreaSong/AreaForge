import assert from "node:assert/strict";
import test from "node:test";
import { desktopListContainerMinWidth, isDesktopListContainerWide } from "./list-return-context";

test("desktop list destination follows the page container budget", () => {
  assert.equal(isDesktopListContainerWide(desktopListContainerMinWidth - 1), false);
  assert.equal(isDesktopListContainerWide(desktopListContainerMinWidth), true);
  assert.equal(isDesktopListContainerWide(Number.NaN), false);
});
