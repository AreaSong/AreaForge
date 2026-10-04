import {
  LEARNING_TREE_PROTOCOL,
  type LearningTreeScope,
} from "./learning-tree-protocol";

export function getLearningTreeTemplate(scope: LearningTreeScope): string {
  switch (scope) {
    case "global":
      return `---
protocol: ${LEARNING_TREE_PROTOCOL}
scope: global
workspaceKey: example-workspace
---

::af-group{#group_cs title="408"}

::af-subject{#subject_ds title="数据结构" group="group_cs"}

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
    case "subject":
      return `---
protocol: ${LEARNING_TREE_PROTOCOL}
scope: subject
workspaceKey: example-workspace
subjectKey: subject_ds
---

# 栈与队列
::af-node{#node_stack_queue}

## 栈
::af-node{#node_stack}

:::af-card{#card_stack kind="METHOD" title="栈的基本操作" subjectKey="subject_ds" primaryNode="node_stack"}
push / pop / peek
:::
`;
    case "branch":
      return `---
protocol: ${LEARNING_TREE_PROTOCOL}
scope: branch
workspaceKey: example-workspace
subjectKey: subject_ds
rootNodeKey: node_stack_queue
---

# 栈与队列
::af-node{#node_stack_queue}

## 队列
::af-node{#node_queue}
`;
  }
}
