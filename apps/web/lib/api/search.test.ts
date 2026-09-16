import assert from "node:assert/strict";
import test from "node:test";
import { isWorkspaceSearchResponse } from "./search";

test("workspace search response parser accepts only the bounded contract", () => {
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v2",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: false,
    indexState: "MISSING", indexedAt: null,
    truncated: false,
    results: [{ id: "point-1", kind: "KNOWLEDGE_POINT", label: "极限", href: "/knowledge/points/point-1", visibility: "OWNER" }],
  }), true);
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v2",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: true,
    truncated: false,
    results: [],
  }), false);
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v2",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: false,
    indexState: "STALE", indexedAt: null,
    truncated: false,
    results: [{ id: "x", kind: "PRIVATE_BODY", label: "x", href: "/x", visibility: "OWNER" }],
  }), false);
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v2",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: false,
    indexState: "DISABLED", indexedAt: null,
    truncated: false,
    results: [{ id: "x", kind: "NOTE", label: "x", href: "javascript:alert(1)", visibility: "OWNER" }],
  }), false);
});

test("已验证索引要求 CURRENT 与有效时间，失效结果不得携带旧时间", () => {
  const response = { contractVersion: "workspace-search-v2", workspaceId: "workspace-1", query: "数学", indexed: true,
    indexState: "CURRENT", indexedAt: "2026-09-15T00:00:00.000Z", truncated: false, results: [] };
  assert.equal(isWorkspaceSearchResponse(response), true);
  for (const change of [{ indexState: "STALE" }, { indexedAt: null }, { indexedAt: "not-a-date" }, { indexed: false }, { results: Array(101).fill({}) }]) {
    assert.equal(isWorkspaceSearchResponse({ ...response, ...change }), false);
  }
});
