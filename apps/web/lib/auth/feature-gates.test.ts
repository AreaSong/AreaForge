import assert from "node:assert/strict";
import test from "node:test";
import { requireMultiUserFeature, requireRbacFeature } from "./feature-gates";

const base = {
  DATABASE_URL: "postgresql://example.invalid/areaforge",
  AUTH_SESSION_SECRET: "synthetic-session-secret-at-least-32-characters",
  AUTH_ACTION_TOKEN_SECRET: "synthetic-action-token-secret-at-least-32-characters",
};

test("multi-user and RBAC feature gates fail closed independently", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, base, {
      AUTH_MULTI_USER_ENABLED: "false",
      AUTH_RBAC_ENABLED: "false",
    });
    assert.throws(() => requireMultiUserFeature(), /MULTI_USER_DISABLED/);
    assert.throws(() => requireRbacFeature(), /RBAC_DISABLED/);

    process.env.AUTH_MULTI_USER_ENABLED = "true";
    assert.doesNotThrow(() => requireMultiUserFeature());
    assert.throws(() => requireRbacFeature(), /RBAC_DISABLED/);

    process.env.AUTH_RBAC_ENABLED = "true";
    assert.doesNotThrow(() => requireRbacFeature());
  } finally {
    process.env = previous;
  }
});
