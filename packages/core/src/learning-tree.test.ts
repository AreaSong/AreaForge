import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  LEARNING_TREE_MAX_OBJECTS,
  buildLearningTreeDiff,
  canonicalizeHttpsUrl,
  createLearningTreeImportSelectionSnapshot,
  exportLearningTreeMarkdown,
  getLearningTreeTemplate,
  learningTreeObjectSemanticSignature,
  parseLearningTreeMarkdown,
  restoreLearningTreeImportSelections,
} from "./index.ts";
import {
  mintLearningTreePreviewToken,
  verifyLearningTreePreviewToken,
} from "../../auth/src/learning-tree-crypto.ts";

const GOLDEN_SUBJECT = `---
protocol: AREAFORGE_LEARNING_TREE_V1
scope: subject
workspaceKey: ws_golden
subjectKey: subject_ds
---

# 线性表
::af-node{#node_list}

## 顺序表
::af-node{#node_array}

:::af-card{#card_array kind="CONCEPT" title="顺序表定义" subjectKey="subject_ds" primaryNode="node_array"}
顺序表是用连续存储空间实现的线性表。
:::

::af-resource{#resource_ref kind="LINK" subjectKey="subject_ds" title="参考资料" url="https://example.com/docs"}

::af-plan{#plan_read subjectKey="subject_ds" title="精读顺序表" durationMinutes="25" dependencyType="SOFT"}
`;

test("learning tree global template parses", () => {
  const parsed = parseLearningTreeMarkdown(getLearningTreeTemplate("global"));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.ok(parsed.objects.some((object) => object.type === "group"));
  assert.ok(parsed.objects.some((object) => object.type === "subject"));
  assert.ok(parsed.objects.some((object) => object.type === "node"));
  assert.ok(parsed.objects.some((object) => object.type === "card"));
  assert.ok(parsed.objects.some((object) => object.type === "resource"));
  assert.ok(parsed.objects.some((object) => object.type === "plan"));
  assert.ok(parsed.canonicalMarkdown.includes("AREAFORGE_LEARNING_TREE_V1"));
});

test("learning tree golden subject fixture parses with expected object keys", () => {
  const parsed = parseLearningTreeMarkdown(GOLDEN_SUBJECT);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.equal(parsed.frontmatter?.workspaceKey, "ws_golden");
  assert.deepEqual(
    parsed.objects.map((object) => `${object.type}:${object.stableKey}`),
    [
      "node:node_list",
      "node:node_array",
      "card:card_array",
      "resource:resource_ref",
      "plan:plan_read",
    ],
  );
  const resource = parsed.objects.find((object) => object.type === "resource");
  assert.ok(resource && resource.type === "resource");
  assert.equal(resource.url, "https://example.com/docs");
  assert.equal(resource.displayHost, "example.com");
});

test("learning tree parser exporter round-trip preserves stable keys", () => {
  const first = parseLearningTreeMarkdown(GOLDEN_SUBJECT);
  assert.equal(first.ok, true, JSON.stringify(first.errors));

  const exported = exportLearningTreeMarkdown({
    scope: "subject",
    workspaceKey: "ws_golden",
    subjectKey: "subject_ds",
    subjects: [
      {
        stableKey: "subject_ds",
        title: "数据结构",
        nodes: [
          {
            stableKey: "node_list",
            title: "线性表",
            depth: 1,
            children: [{ stableKey: "node_array", title: "顺序表", depth: 2 }],
          },
        ],
      },
    ],
  });
  const second = parseLearningTreeMarkdown(exported);
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.deepEqual(
    second.objects.filter((object) => object.type === "node").map((object) => object.stableKey),
    ["node_list", "node_array"],
  );

  const third = parseLearningTreeMarkdown(first.canonicalMarkdown);
  assert.equal(third.ok, true, JSON.stringify(third.errors));
  assert.equal(third.canonicalMarkdown, first.canonicalMarkdown);
  assert.deepEqual(
    third.objects.map((object) => `${object.type}:${object.stableKey}`),
    first.objects.map((object) => `${object.type}:${object.stableKey}`),
  );
});

test("learning tree all templates round-trip via canonical markdown", () => {
  for (const scope of ["global", "subject", "branch"] as const) {
    const first = parseLearningTreeMarkdown(getLearningTreeTemplate(scope));
    assert.equal(first.ok, true, `${scope}: ${JSON.stringify(first.errors)}`);
    const second = parseLearningTreeMarkdown(first.canonicalMarkdown);
    assert.equal(second.ok, true, `${scope} reparse: ${JSON.stringify(second.errors)}`);
    assert.equal(second.canonicalMarkdown, first.canonicalMarkdown);
    assert.deepEqual(
      second.objects.map((object) => `${object.type}:${object.stableKey}`),
      first.objects.map((object) => `${object.type}:${object.stableKey}`),
    );
  }
});

test("learning tree malicious markdown corpus fails closed", () => {
  const cases: Array<{ name: string; markdown: string; codes: string[] }> = [
    {
      name: "raw_script_html",
      markdown: withSubjectFrontmatter(`# Node\n::af-node{#n1}\n\n<script>alert(1)</script>\n`),
      codes: ["RAW_HTML_FORBIDDEN"],
    },
    {
      name: "raw_iframe_html",
      markdown: withSubjectFrontmatter(`# Node\n::af-node{#n1}\n\n<iframe src="https://evil.test"></iframe>\n`),
      codes: ["RAW_HTML_FORBIDDEN"],
    },
    {
      name: "image_markdown",
      markdown: withSubjectFrontmatter(`# Node\n::af-node{#n1}\n\n![x](https://example.com/a.png)\n`),
      codes: ["IMAGE_FORBIDDEN"],
    },
    {
      name: "http_scheme",
      markdown: withSubjectFrontmatter(
        `::af-resource{#r1 kind="LINK" subjectKey="subj" title="bad" url="http://example.com"}\n`,
      ),
      codes: ["URL_INVALID"],
    },
    {
      name: "javascript_scheme",
      markdown: withSubjectFrontmatter(
        `::af-resource{#r1 kind="LINK" subjectKey="subj" title="bad" url="javascript:alert(1)"}\n`,
      ),
      codes: ["URL_INVALID"],
    },
    {
      name: "data_scheme",
      markdown: withSubjectFrontmatter(
        `::af-resource{#r1 kind="LINK" subjectKey="subj" title="bad" url="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="}\n`,
      ),
      codes: ["URL_INVALID"],
    },
    {
      name: "mailto_scheme",
      markdown: withSubjectFrontmatter(
        `::af-resource{#r1 kind="LINK" subjectKey="subj" title="bad" url="mailto:a@example.com"}\n`,
      ),
      codes: ["URL_INVALID"],
    },
    {
      name: "file_scheme",
      markdown: withSubjectFrontmatter(
        `::af-resource{#r1 kind="LINK" subjectKey="subj" title="bad" url="file:///etc/passwd"}\n`,
      ),
      codes: ["URL_INVALID"],
    },
  ];

  for (const item of cases) {
    const parsed = parseLearningTreeMarkdown(item.markdown);
    assert.equal(parsed.ok, false, item.name);
    for (const code of item.codes) {
      assert.ok(
        parsed.errors.some((error) => error.code === code),
        `${item.name} missing ${code}: ${JSON.stringify(parsed.errors)}`,
      );
    }
  }
});

test("canonicalizeHttpsUrl rejects localhost and ip", () => {
  assert.equal(canonicalizeHttpsUrl("https://localhost/a").ok, false);
  assert.equal(canonicalizeHttpsUrl("https://127.0.0.1/a").ok, false);
  assert.equal(canonicalizeHttpsUrl("https://example.com/a#x").ok, false);
  assert.equal(canonicalizeHttpsUrl("javascript:alert(1)").ok, false);
  assert.equal(canonicalizeHttpsUrl("data:text/html,hi").ok, false);
  const ok = canonicalizeHttpsUrl("https://Example.COM/path");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.host, "example.com");
});

test("learning tree preview token roundtrip", () => {
  const secret = "x".repeat(32);
  const minted = mintLearningTreePreviewToken(
    {
      actorId: "u1",
      workspaceId: "w1",
      sourceSha256: createHash("sha256").update("a").digest("hex"),
      canonicalPlanHash: createHash("sha256").update("b").digest("hex"),
      diffSnapshotHash: createHash("sha256").update("c").digest("hex"),
      scope: "subject",
      rootRevision: 1,
    },
    secret,
  );
  const verified = verifyLearningTreePreviewToken(minted.token, secret);
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.claims.actorId, "u1");
    assert.equal(verified.claims.nonce, minted.claims.nonce);
  }
  assert.equal(verifyLearningTreePreviewToken(minted.token, "y".repeat(32)).ok, false);
});

test("learning tree diff ADD and CONFLICT", () => {
  const parsed = parseLearningTreeMarkdown(getLearningTreeTemplate("subject"));
  assert.equal(parsed.ok, true);
  const diff = buildLearningTreeDiff({
    incoming: parsed.objects,
    existing: [
      {
        objectType: "node",
        stableKey: null,
        title: "栈与队列",
        subjectKey: "subject_ds",
        pathTitles: ["栈与队列"],
        entityId: "a",
      },
      {
        objectType: "node",
        stableKey: null,
        title: "栈与队列",
        subjectKey: "subject_ds",
        pathTitles: ["栈与队列"],
        entityId: "b",
      },
    ],
  });
  assert.ok(diff.some((item) => item.diffType === "CONFLICT"));
  assert.ok(diff.some((item) => item.diffType === "ADD"));
});

test("learning tree parser validates normalized references and syllabus status", () => {
  const normalized = parseLearningTreeMarkdown(withSubjectFrontmatter([
    "# Primary",
    "::af-node{#node_primary status=\"LEARNING\"}",
    "",
    "# Related",
    "::af-node{#node_related}",
    "",
    ':::af-card{#card_refs kind="CONCEPT" title="Refs" subjectKey="subj" primaryNode="node_primary" relatedNodes="node_primary,node_related,node_related"}',
    "Body",
    ":::",
  ].join("\n")));
  assert.equal(normalized.ok, true, JSON.stringify(normalized.errors));
  const card = normalized.objects.find((object) => object.type === "card");
  assert.ok(card?.type === "card");
  assert.deepEqual(card.relatedNodes, ["node_related"]);

  const missing = parseLearningTreeMarkdown(withSubjectFrontmatter(
    ':::af-card{#card_missing title="Missing" subjectKey="subj" primaryNode="node_missing"}\n:::\n',
  ));
  assert.ok(missing.errors.some((issue) => issue.code === "PARSE_ERROR"));

  const invalidStatus = parseLearningTreeMarkdown(withSubjectFrontmatter(
    '# Invalid\n::af-node{#node_invalid status="learning"}\n',
  ));
  assert.ok(invalidStatus.errors.some((issue) => issue.code === "PARSE_ERROR"));
});

test("learning tree parser rejects cross-subject card and plan references", () => {
  const parsed = parseLearningTreeMarkdown(`---
protocol: AREAFORGE_LEARNING_TREE_V1
scope: global
workspaceKey: ws
---

::af-subject{#subject_a title="A"}

# Node A
::af-node{#node_a}

::af-plan{#plan_a subjectKey="subject_a" title="Plan A"}

::af-subject{#subject_b title="B"}

# Node B
::af-node{#node_b}

:::af-card{#card_b title="Card B" subjectKey="subject_b" primaryNode="node_a"}
Body
:::

::af-plan{#plan_b subjectKey="subject_b" title="Plan B" dependsOn="plan:plan_a"}
`);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors.filter((issue) => issue.code === "CROSS_SUBJECT_REF").length, 2);
});

test("learning tree diff keeps node and card stable matches inside their subject", () => {
  const incoming = parseLearningTreeMarkdown(withSubjectFrontmatter([
    "# Same node",
    "::af-node{#shared_node}",
    "",
    ':::af-card{#shared_card title="Same card" subjectKey="subj"}',
    "Body",
    ":::",
  ].join("\n")));
  assert.equal(incoming.ok, true, JSON.stringify(incoming.errors));
  const diff = buildLearningTreeDiff({
    incoming: incoming.objects,
    existing: [
      { objectType: "node", stableKey: "shared_node", title: "Same node", subjectKey: "other", entityId: "n1" },
      { objectType: "card", stableKey: "shared_card", title: "Same card", subjectKey: "other", entityId: "c1" },
    ],
  });
  assert.deepEqual(diff.map((item) => item.diffType), ["ADD", "ADD"]);
});

test("learning tree diff compares full card resource plan and node semantics", () => {
  const base = parseLearningTreeMarkdown(withSubjectFrontmatter([
    "# Node",
    '::af-node{#node_sem sortOrder="2" status="LEARNING"}',
    "",
    "# Related",
    "::af-node{#node_related}",
    "",
    ':::af-card{#card_sem title="Card" subjectKey="subj" primaryNode="node_sem" relatedNodes="node_related"}',
    "Old body",
    ":::",
    "",
    '::af-resource{#resource_sem subjectKey="subj" title="Resource" url="https://example.com/old"}',
    "",
    '::af-plan{#plan_dep subjectKey="subj" title="Dependency"}',
    '::af-plan{#plan_sem subjectKey="subj" title="Plan" dependsOn="plan:plan_dep" dependencyType="SOFT"}',
  ].join("\n")));
  assert.equal(base.ok, true, JSON.stringify(base.errors));
  const changed = base.objects
    .filter((object) => ["node_sem", "card_sem", "resource_sem", "plan_sem"].includes(object.stableKey))
    .map((object) => {
      if (object.type === "node") return { ...object, status: "MASTERED" };
      if (object.type === "card") return { ...object, bodyMarkdown: "New body", relatedNodes: [] };
      if (object.type === "resource") return { ...object, url: "https://example.com/new" };
      if (object.type === "plan") return { ...object, dependsOn: undefined, dependencyType: "HARD" as const };
      return object;
    });
  const existing = base.objects
    .filter((object) => ["node_sem", "card_sem", "resource_sem", "plan_sem"].includes(object.stableKey))
    .map((object, index) => ({
      objectType: object.type,
      stableKey: object.stableKey,
      title: object.title,
      subjectKey: "subjectKey" in object ? object.subjectKey : null,
      parentStableKey: object.type === "node" ? object.parentStableKey : undefined,
      archived: object.type === "node" ? object.archived : undefined,
      sortOrder: object.type === "node" ? object.sortOrder : undefined,
      status: object.type === "node" ? object.status : undefined,
      semanticSignature: learningTreeObjectSemanticSignature(object),
      entityId: `entity_${index}`,
      revision: index + 1,
      updatedAt: `2026-07-2${index + 1}T00:00:00.000Z`,
    }));
  const diff = buildLearningTreeDiff({ incoming: changed, existing });
  assert.deepEqual(diff.map((item) => item.diffType), ["UPDATE", "UPDATE", "UPDATE", "UPDATE"]);
  assert.deepEqual(diff.map((item) => item.candidateMatches[0]?.revision), [1, 2, 3, 4]);
  assert.ok(diff.every((item) => item.candidateMatches[0]?.updatedAt));
});

test("learning tree parser accepts 5000 objects and rejects 5001", () => {
  const directives = Array.from(
    { length: LEARNING_TREE_MAX_OBJECTS + 1 },
    (_, index) => `::af-plan{#plan_${index} subjectKey="subj" title="Plan ${index}"}`,
  );
  const atLimit = parseLearningTreeMarkdown(withSubjectFrontmatter(
    `${directives.slice(0, LEARNING_TREE_MAX_OBJECTS).join("\n")}\n`,
  ));
  assert.equal(atLimit.ok, true, JSON.stringify(atLimit.errors));
  assert.equal(atLimit.objects.length, LEARNING_TREE_MAX_OBJECTS);

  const overLimit = parseLearningTreeMarkdown(withSubjectFrontmatter(`${directives.join("\n")}\n`));
  assert.equal(overLimit.ok, false);
  assert.ok(overLimit.errors.some((issue) => issue.code === "OBJECT_LIMIT"));
});

test("learning tree export includes stable keys", () => {
  const markdown = exportLearningTreeMarkdown({
    scope: "subject",
    workspaceKey: "ws",
    subjectKey: "subj",
    subjects: [
      {
        stableKey: "subj",
        title: "数据结构",
        nodes: [{ stableKey: "n1", title: "线性表", depth: 1 }],
      },
    ],
  });
  assert.match(markdown, /::af-node\{#n1/);
  const reparsed = parseLearningTreeMarkdown(markdown);
  assert.equal(reparsed.ok, true, JSON.stringify(reparsed.errors));
});

test("learning tree node export round-trips order and status without false updates", () => {
  const markdown = exportLearningTreeMarkdown({
    scope: "subject",
    workspaceKey: "ws",
    subjectKey: "subj",
    subjects: [{
      stableKey: "subj",
      title: "数据结构",
      nodes: [{
        stableKey: "node_semantic",
        title: "线性表",
        depth: 1,
        sortOrder: 9,
        status: "LEARNING",
      }],
    }],
  });
  assert.match(markdown, /sortOrder="9"/);
  assert.match(markdown, /status="LEARNING"/);

  const parsed = parseLearningTreeMarkdown(markdown);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const exportedNode = parsed.objects.find((object) => object.type === "node");
  assert.ok(exportedNode?.type === "node");
  assert.equal(exportedNode.sortOrder, 9);
  assert.equal(exportedNode.status, "LEARNING");

  const existing = [{
    objectType: "node" as const,
    stableKey: exportedNode.stableKey,
    title: exportedNode.title,
    subjectKey: exportedNode.subjectKey,
    parentStableKey: exportedNode.parentStableKey,
    archived: false,
    sortOrder: 9,
    status: "LEARNING",
    entityId: "node-existing",
    semanticSignature: learningTreeObjectSemanticSignature(exportedNode),
  }];
  assert.equal(buildLearningTreeDiff({ incoming: [exportedNode], existing })[0]?.diffType, "UNCHANGED");

  const omitted = parseLearningTreeMarkdown(withSubjectFrontmatter([
    "# 线性表",
    "::af-node{#node_semantic}",
  ].join("\n")));
  assert.equal(omitted.ok, true, JSON.stringify(omitted.errors));
  const omittedNode = omitted.objects.find((object) => object.type === "node");
  assert.ok(omittedNode?.type === "node");
  assert.equal(buildLearningTreeDiff({ incoming: [omittedNode], existing })[0]?.diffType, "UNCHANGED");
  assert.equal(buildLearningTreeDiff({
    incoming: [{ ...omittedNode, sortOrder: 10 }],
    existing,
  })[0]?.diffType, "UPDATE");
  assert.equal(buildLearningTreeDiff({
    incoming: [{ ...omittedNode, status: "MASTERED" }],
    existing,
  })[0]?.diffType, "UPDATE");
});

test("learning tree export round-trips cards resources and plans", () => {
  const markdown = exportLearningTreeMarkdown({
    scope: "subject",
    workspaceKey: "ws",
    subjectKey: "subj",
    subjects: [{
      stableKey: "subj",
      title: "数据结构",
      nodes: [{ stableKey: "node_list", title: "线性表", depth: 1 }],
      cards: [{
        stableKey: "card_list",
        title: "线性表卡片",
        kind: "CONCEPT",
        subjectKey: "subj",
        primaryNode: "node_list",
        relatedNodes: ["node_list"],
        bodyMarkdown: "**连续存储**与链式存储。",
      }],
      resources: [{
        stableKey: "resource_list",
        title: "参考资料",
        subjectKey: "subj",
        url: "https://example.com/list",
      }],
      plans: [{
        stableKey: "plan_list",
        title: "复习线性表",
        subjectKey: "subj",
        durationMinutes: 25,
        dependencyType: "SOFT",
      }],
    }],
  });
  const parsed = parseLearningTreeMarkdown(markdown);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  assert.deepEqual(
    parsed.objects.map((object) => `${object.type}:${object.stableKey}`),
    ["node:node_list", "card:card_list", "resource:resource_list", "plan:plan_list"],
  );
  const card = parsed.objects.find((object) => object.type === "card");
  assert.ok(card?.type === "card");
  assert.equal(card.bodyMarkdown, "**连续存储**与链式存储。");
});

test("nested branch export preserves its external parent across roundtrip", () => {
  const markdown = exportLearningTreeMarkdown({
    scope: "branch",
    workspaceKey: "ws",
    subjectKey: "subj",
    rootNodeKey: "node_nested",
    rootParentNodeKey: "node_parent",
    subjects: [{
      stableKey: "subj",
      title: "数据结构",
      nodes: [{
        stableKey: "node_nested",
        title: "嵌套分支",
        depth: 1,
        children: [{ stableKey: "node_leaf", title: "叶节点", depth: 2 }],
      }],
    }],
  });
  assert.match(markdown, /rootParentNodeKey: node_parent/);
  const parsed = parseLearningTreeMarkdown(markdown);
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const nodes = parsed.objects.filter((object) => object.type === "node");
  assert.equal(nodes[0]?.parentStableKey, "node_parent");
  const diff = buildLearningTreeDiff({
    incoming: parsed.objects,
    existing: nodes.map((node, index) => ({
      objectType: "node" as const,
      stableKey: node.stableKey,
      title: node.title,
      subjectKey: node.subjectKey,
      parentStableKey: node.parentStableKey,
      entityId: `node-${index}`,
      semanticSignature: learningTreeObjectSemanticSignature(node),
    })),
  });
  assert.deepEqual(diff.map((item) => item.diffType), ["UNCHANGED", "UNCHANGED"]);
});

test("branch parser requires exactly one actual root matching rootNodeKey", () => {
  const wrongRootKey = parseLearningTreeMarkdown(`---
protocol: AREAFORGE_LEARNING_TREE_V1
scope: branch
workspaceKey: ws
subjectKey: subj
rootNodeKey: declared_root
---

# Actual root
::af-node{#actual_root}
`);
  assert.equal(wrongRootKey.ok, false);
  assert.ok(wrongRootKey.errors.some((issue) =>
    issue.code === "FRONTMATTER_INVALID" && issue.stableKey === "actual_root"
  ));

  const multipleRoots = parseLearningTreeMarkdown(`---
protocol: AREAFORGE_LEARNING_TREE_V1
scope: branch
workspaceKey: ws
subjectKey: subj
rootNodeKey: root_one
---

# Root one
::af-node{#root_one}

# Root two
::af-node{#root_two}
`);
  assert.equal(multipleRoots.ok, false);
  assert.ok(multipleRoots.errors.some((issue) =>
    issue.code === "FRONTMATTER_INVALID" && issue.message.includes("只能包含一个根节点")
  ));
});

test("node move remains visible when the incoming node is also archived", () => {
  const parsed = parseLearningTreeMarkdown(withSubjectFrontmatter([
    "# Root",
    "::af-node{#root}",
    "",
    "## Archived child",
    '::af-node{#moving archived="true"}',
  ].join("\n")));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.errors));
  const moving = parsed.objects.find((object) => object.stableKey === "moving");
  assert.ok(moving?.type === "node");
  const diff = buildLearningTreeDiff({
    incoming: [moving],
    existing: [{
      objectType: "node",
      stableKey: "moving",
      title: moving.title,
      subjectKey: moving.subjectKey,
      parentStableKey: "old_parent",
      archived: false,
      entityId: "moving-id",
      semanticSignature: learningTreeObjectSemanticSignature({ ...moving, parentStableKey: "old_parent", archived: false }),
    }],
  });
  assert.equal(diff[0]?.diffType, "MOVE");
});

test("learning tree selection recovery is bound to source and current candidates", () => {
  const snapshot = createLearningTreeImportSelectionSnapshot({
    sourceSha256: "a".repeat(64),
    canonicalPlanHash: "b".repeat(64),
    selections: {
      conflict: { choice: "apply", mappedTargetId: "target-1" },
      update: { choice: "skip" },
    },
  });
  const items = [
    { stableKey: "conflict", diffType: "CONFLICT" as const, candidateMatches: [{ entityId: "target-1" }] },
    { stableKey: "update", diffType: "UPDATE" as const, candidateMatches: [] },
    { stableKey: "same", diffType: "UNCHANGED" as const, candidateMatches: [] },
  ];
  assert.deepEqual(restoreLearningTreeImportSelections({
    sourceSha256: "a".repeat(64),
    canonicalPlanHash: "b".repeat(64),
    items,
    snapshot,
  }), {
    conflict: { choice: "apply", mappedTargetId: "target-1" },
    update: { choice: "skip" },
    same: { choice: "skip" },
  });

  assert.deepEqual(restoreLearningTreeImportSelections({
    sourceSha256: "a".repeat(64),
    canonicalPlanHash: "b".repeat(64),
    items: [{ ...items[0]!, candidateMatches: [{ entityId: "target-2" }] }],
    snapshot,
  }), { conflict: { choice: "apply" } });
  assert.deepEqual(restoreLearningTreeImportSelections({
    sourceSha256: "c".repeat(64),
    canonicalPlanHash: "b".repeat(64),
    items: items.slice(0, 2),
    snapshot,
  }), {
    conflict: { choice: "apply" },
    update: { choice: "apply" },
  });
});

function withSubjectFrontmatter(body: string): string {
  return `---
protocol: AREAFORGE_LEARNING_TREE_V1
scope: subject
workspaceKey: ws
subjectKey: subj
---

${body}`;
}
