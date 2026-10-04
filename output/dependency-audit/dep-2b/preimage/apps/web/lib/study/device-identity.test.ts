import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeClientDeviceLabel } from "@/lib/client/device-identity";

test("client device labels stay compact and header-safe", () => {
  assert.equal(normalizeClientDeviceLabel("  MacBook   Pro  "), "MacBook Pro");
  assert.equal(normalizeClientDeviceLabel("Mac\nBook\u0000 Pro"), "Mac Book Pro");
  assert.equal(normalizeClientDeviceLabel("   \n\t  "), null);
  assert.equal(normalizeClientDeviceLabel("测".repeat(41)), "测".repeat(40));
});
