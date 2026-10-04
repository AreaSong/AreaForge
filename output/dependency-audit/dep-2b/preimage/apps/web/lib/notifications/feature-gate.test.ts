import assert from "node:assert/strict";
import test from "node:test";
import { isPlatformNotificationsEnabled } from "./feature-gate";

test("durable notification feature gate defaults closed and accepts only exact true", () => {
  assert.equal(isPlatformNotificationsEnabled({}), false);
  assert.equal(isPlatformNotificationsEnabled({ PLATFORM_NOTIFICATIONS_ENABLED: "false" }), false);
  assert.equal(isPlatformNotificationsEnabled({ PLATFORM_NOTIFICATIONS_ENABLED: "1" }), false);
  assert.equal(isPlatformNotificationsEnabled({ PLATFORM_NOTIFICATIONS_ENABLED: "true" }), true);
});
