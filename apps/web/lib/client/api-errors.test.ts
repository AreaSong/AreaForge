import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyApiFailure,
  isConflict,
  isUnauthorized,
  readConflictFields,
  readErrorMessage,
  readFieldErrors,
} from "./api-errors";
import { mutationFeedback } from "./mutation-feedback";

test("mutationFeedback maps auth, conflict, and fallback failures consistently", () => {
  assert.deepEqual(mutationFeedback({ status: 401, body: null }, "fallback"), {
    kind: "unauthorized",
    message: "登录已过期，当前命令已保留；重新登录后请显式重试。",
  });
  assert.deepEqual(mutationFeedback({ status: 409, body: { error: "REVISION_CONFLICT" } }, "fallback"), {
    kind: "conflict",
    message: "服务端版本已变化，当前输入已保留；请刷新查看最新状态后显式重试。",
  });
  assert.deepEqual(mutationFeedback({ status: 500, body: { error: "SERVER_ERROR" } }, "fallback"), {
    kind: "error",
    message: "SERVER_ERROR",
  });
});

test("classifyApiFailure preserves status and structured error facts", () => {
  assert.deepEqual(
    classifyApiFailure({ status: 401, body: { error: "UNAUTHORIZED" } }),
    {
      kind: "unauthorized",
      status: 401,
      code: "UNAUTHORIZED",
      conflictFields: [],
      fieldErrors: {},
    },
  );

  assert.deepEqual(
    classifyApiFailure({
      status: 409,
      body: {
        error: "REVISION_CONFLICT",
        conflictFields: ["revision"],
        details: { fieldErrors: { title: ["标题已变化"] } },
      },
    }),
    {
      kind: "conflict",
      status: 409,
      code: "REVISION_CONFLICT",
      conflictFields: ["revision"],
      fieldErrors: { title: ["标题已变化"] },
    },
  );

  assert.deepEqual(
    classifyApiFailure({ status: 400, body: { details: { fieldErrors: { title: ["必填"] } } } }),
    {
      kind: "field",
      status: 400,
      code: null,
      conflictFields: [],
      fieldErrors: { title: ["必填"] },
    },
  );

  assert.deepEqual(classifyApiFailure({ status: 204, body: null }), {
    kind: "unknown",
    status: 204,
    code: null,
    conflictFields: [],
    fieldErrors: {},
  });
});

test("classifyApiFailure is null-safe for malformed transport input", () => {
  assert.deepEqual(classifyApiFailure(undefined), {
    kind: "unknown",
    status: null,
    code: null,
    conflictFields: [],
    fieldErrors: {},
  });
});

test("status predicates only classify transport boundaries", () => {
  assert.equal(isUnauthorized({ status: 401, body: null }), true);
  assert.equal(isUnauthorized({ status: 401, body: { error: "UNAUTHORIZED" } }), true);
  assert.equal(isUnauthorized({ status: 200, body: { error: "UNAUTHORIZED" } }), false);
  assert.equal(isConflict({ status: 409, body: { error: "REVISION_CONFLICT" } }), true);
  assert.equal(isConflict({ status: 400, body: { error: "REVISION_CONFLICT" } }), false);
});

test("error readers tolerate empty, malformed, and non-object bodies", () => {
  for (const body of [null, undefined, "not-json", 0, [], { error: 42, conflictFields: "revision" }]) {
    const source = { status: 409, body };
    assert.equal(readErrorMessage(source), null);
    assert.deepEqual(readConflictFields(source), []);
    assert.deepEqual(readFieldErrors(source), {});
  }
});

test("error readers preserve structured conflict and field details", () => {
  const source = {
    status: 409,
    body: {
      error: "IMPORT_CONFLICT",
      conflictFields: ["confirmState", 42, ""],
      details: {
        conflictFields: ["nested"],
        fieldErrors: {
          title: ["标题不能为空", 1],
          empty: [],
          malformed: "message",
        },
      },
      fieldErrors: {
        title: ["标题过短"],
        source: ["来源无效"],
      },
    },
  };
  assert.equal(readErrorMessage(source), "IMPORT_CONFLICT");
  assert.deepEqual(readConflictFields(source), ["confirmState"]);
  assert.deepEqual(readFieldErrors(source), {
    title: ["标题过短"],
    empty: [],
    source: ["来源无效"],
  });
});

test("field error readers do not copy prototype keys", () => {
  const source = {
    status: 400,
    body: {
      details: {
        fieldErrors: {
          __proto__: ["pollute"],
          constructor: ["ignore"],
          prototype: ["ignore"],
          name: ["ok"],
        },
      },
    },
  };
  const result = readFieldErrors(source);
  assert.deepEqual(result, { name: ["ok"] });
  assert.equal(Object.prototype.hasOwnProperty.call(result, "__proto__"), false);
});
