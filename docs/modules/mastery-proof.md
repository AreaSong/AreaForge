# 知识点掌握证明

## 目标

避免随手打勾造成虚假进度。

## 掌握条件

一个知识点可以设置掌握条件：

- 看完课程或教材。
- 写过自己的理解。
- 做过基础题。
- 做过综合题。
- 错题已经复盘。
- 7 天后仍能答对或讲清。

## 掌握等级

- 见过。
- 学过。
- 会做基础题。
- 能独立讲清。
- 复测通过。
- 考前稳定。

## 原则

- 打勾只是状态，不等于真正掌握。
- 真正掌握需要证据。
- 证据来自计时、任务、笔记、错题、复测记录。

## 当前实现

- `/syllabus` 节点卡片展示任务、计时、笔记、错题证据计数和最近证据时间。
- 用户可以在节点上选择目标掌握等级，并勾选已完成的掌握条件；条件会持久化到 `MasteryConditionRecord`。
- `PATCH /api/syllabus/nodes/:id` 会写入条件记录，并调用 `packages/core/src/mastery-proof.ts` 校验。
- `POST /api/syllabus/nodes/:id/mastery-evidence` 可把同一节点下的任务、计时、笔记、错题或复测记录引用为显式 `MasteryEvidence`；跨节点引用会被拒绝。
- `POST /api/syllabus/nodes/:id/mastery-retests` 可记录 `passed/failed/partial` 复测；只有 `passed` 计入 `delayed_retest` 证据，`failed/partial` 只记录历史，不自动降低节点状态或掌握等级。
- 掌握证明优先读取显式条件和显式证据；没有显式证据时，继续 fallback 到现有任务、计时、笔记和错题 `_count`，保证旧节点可读可证明。
- 无真实关联证据、缺少理解笔记、缺少练习记录、缺少错题复盘或缺少复测信号时，服务端返回 `MASTERY_PROOF_REQUIRED`，不会把节点写成掌握。
- 通过校验后，服务端写入 `SyllabusNode.status/masteryLevel`，并用 `AuditEvent` 记录请求等级、勾选条件、证据计数和允许等级摘要。
- 条件、证据和复测由 `MasteryConditionRecord`、`MasteryEvidence` 和 `MasteryRetest` 持久化（additive migration，不删除旧字段）。

## 不在当前范围

历史文本解析回填、删除旧字段、复测失败自动降级。

实现进度与批次证据（含 Package B Batch 4 的确认边界）见 [功能追踪矩阵](../development/feature-traceability.md)。
