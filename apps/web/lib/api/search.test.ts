import assert from "node:assert/strict";
import test from "node:test";
import { isWorkspaceSearchResponse } from "./search";

test("workspace search response parser accepts only the bounded contract", () => {
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v1",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: false,
    truncated: false,
    results: [{ id: "point-1", kind: "KNOWLEDGE_POINT", label: "极限", href: "/knowledge/points/point-1", visibility: "OWNER" }],
  }), true);
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v1",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: true,
    truncated: false,
    results: [],
  }), false);
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v1",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: false,
    truncated: false,
    results: [{ id: "x", kind: "PRIVATE_BODY", label: "x", href: "/x", visibility: "OWNER" }],
  }), false);
  assert.equal(isWorkspaceSearchResponse({
    contractVersion: "workspace-search-v1",
    workspaceId: "workspace-1",
    query: "数学",
    indexed: false,
    truncated: false,
    results: [{ id: "x", kind: "NOTE", label: "x", href: "javascript:alert(1)", visibility: "OWNER" }],
  }), false);
});
