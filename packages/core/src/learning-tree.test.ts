import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildLearningTreeDiff,
  canonicalizeHttpsUrl,
  exportLearningTreeMarkdown,
  getLearningTreeTemplate,
  parseLearningTreeMarkdown,
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

function withSubjectFrontmatter(body: string): string {
  return `---
protocol: AREAFORGE_LEARNING_TREE_V1
scope: subject
workspaceKey: ws
subjectKey: subj
---

${body}`;
}
