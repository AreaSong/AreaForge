# 0009 错题与掌握证明基础版

状态：已完成。基础版复用现有 `Mistake`、`SyllabusNode.masteryLevel`、`AuditEvent` 和节点关联；Package B Batch 4 已补齐显式条件、证据引用和复测记录。

## 目标

把“看过”和“真正掌握”分开，让错题、笔记、计时和任务成为考纲节点的掌握证据。

## 范围

- 错题 CRUD。
- 错题关联科目和考纲节点。
- 错因、正确思路、下次复习时间。
- 考纲节点掌握证明基础版：手动条件勾选、真实证据校验和审计摘要。
- 作战地图能反映薄弱、需要复习和掌握状态。

## 不包含

- 自动 OCR 题目。
- AI 自动批改或自动生成错因。
- 复杂证据图谱。

## 参考源事实

- `docs/architecture/data-model.md`
- `docs/modules/mastery-proof.md`
- `docs/modules/syllabus-map.md`
- `docs/modules/notes.md`

## 验收标准

- 可以创建、查看和更新错题。
- 错题可以关联到科目和考纲节点。
- 掌握状态不能只靠“打勾”，必须能看到至少一种证据来源。
- `pnpm check` 通过。

## 当前进展

- 新增错题列表、创建和更新 API。
- 新增 `/mistakes` 工作页。
- 考纲节点展示任务、计时、笔记、错题证据计数。
- 服务端限制无证据节点不能直接标记 `mastered`。
- `packages/core/src/mastery-proof.ts` 已提供掌握证明纯规则：按课程/教材、自己的理解、基础题、综合题、错题复盘和 7 天后复测条件，判断允许掌握等级、缺失条件、缺失证据和下一步动作。
- `packages/core/src/syllabus-map.ts` 已提供作战地图纯规则：按节点状态、掌握等级、证据数、错题数、上次复习间隔、复测和重点标记，推导网格状态、打勾/打叉/星标/警告标记、原因和下一步动作。
- 考纲服务已把掌握证明和作战地图规则写入 `SyllabusNodeDto`；`/syllabus` 页面已展示地图状态、标记、规则原因、掌握缺口和下一步动作。
- `/syllabus` 节点卡片已支持选择目标掌握等级和勾选本次证明条件；`PATCH /api/syllabus/nodes/:id` 合并本次条件和派生条件后，用任务、计时、笔记、错题真实证据校验，失败返回 `MASTERY_PROOF_REQUIRED`，成功写入 `SyllabusNode.status/masteryLevel` 和 `AuditEvent` 证明摘要。
- Package B Batch 4 已新增 `MasteryConditionRecord`、`MasteryEvidence`、`MasteryRetest`；`/syllabus` 可保存条件、引用证据、记录复测并展示历史；显式证据优先，旧节点无显式证据时继续按 `_count` fallback。
- 复测 `failed/partial` 只记录历史和下一步风险，不自动降低节点状态或掌握等级。
- 不提供删除错题入口，避免破坏性写操作。

## 后续单独确认能力

- 笔记或附件直接关联错题。
- 错题复盘次数、题目正文和答案过程等结构化字段。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/core typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- API 烟测：创建错题、更新错因、设置复习时间；无证据掌握证明返回 `MASTERY_PROOF_REQUIRED`，有真实证据和条件后允许写入掌握等级。
- 页面烟测：错题列表、考纲节点证据展示、掌握证明等级选择和条件勾选。

## 风险

- 当前 `Mistake` 模型仍只有基础字段；笔记或附件直接关联错题、错题复盘次数、题目正文和答案过程等结构化能力需要后续单独确认。
