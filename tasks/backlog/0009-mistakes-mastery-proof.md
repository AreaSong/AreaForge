# 0009 错题 v2 与掌握证明

状态：已完成本地实现与验收。基础掌握证明、错题 v2、additive migration、隔离 PostgreSQL 事务验证和测试池页面烟测均已通过；生产 migration、部署和 Release 明确不在本次范围。

## 目标

把“看过”和“真正掌握”分开，让错题、笔记、计时和任务成为考纲节点的掌握证据。

## 范围

- 错题 CRUD。
- 错题关联科目和考纲节点。
- 错因、正确思路、下次复习时间。
- 题目正文、可选标准答案、错因补充说明和多次 `MistakeAttempt` 作答历史。
- 独立重做不改变排期；统一复习在同一事务写入 `ReviewEvent` 与一对一 `MistakeAttempt`。
- 直接维护笔记与学习资料关系；模拟失分通过预填表单转为错题并保留来源关联。
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

## 当前边界

- 附件仍通过 `StudyResourceMistakeLink` 关联，不新增错题直连文件体。
- 不包含账户导出、OCR、AI 批改、自动判分和完整题库。
- 历史错题允许题面为空，补全题面、明确错因和正确思路后才能进入统一复习。

## 验证

- `pnpm --filter @areaforge/core test`
- `pnpm --filter @areaforge/core typecheck`
- `pnpm --filter @areaforge/web typecheck`
- `pnpm --filter @areaforge/web lint`
- `pnpm check`
- 全新隔离 PostgreSQL 依次应用 36 条 migration；`20260818090000_v11_mistake_v2` 成功。
- `AREAFORGE_V11_M6_ISOLATED_DB=1 pnpm ops:v11:m6:runtime:selftest`：独立作答幂等/冲突/归档、关系维护、统一复习双写通过。
- `AREAFORGE_V11_OWNER_ISOLATION_DB=1 pnpm ops:v11:owner-isolation:runtime:selftest`：错题作答与笔记/资料关系跨工作区隔离通过。
- API 烟测：创建错题、更新错因、设置复习时间；无证据掌握证明返回 `MASTERY_PROOF_REQUIRED`，有真实证据和条件后允许写入掌握等级。
- 页面烟测：错题列表、考纲节点证据展示、掌握证明等级选择和条件勾选。
- 测试池页面验收（slot 1，`http://127.0.0.1:43171`）：错题列表筛选与创建、详情独立作答/揭示答案/历史、到期统一复习、笔记与资料关联、模拟失分预填转错题、专注收口证据接力创建错题；桌面和移动端截图已留存于 `.playwright-cli/`。
- 模拟失分未关联时显示“转为错题”，预填对话框要求补齐题面和正确思路后才能保存；已关联和 dirty 失分项保持正确边界。
- 错题掌握趋势第一版已接入：列表概览总数/今日到期/最近通过率/最近失败，详情汇总最近通过率、连续通过、最近失败和最近结果。
- 复习排期第一版已接入：明天、3 天后、自定义日期快捷选择，必须显式点击确认才写入统一 `ReviewSchedule`。
- `pnpm dev:test:latest -- --json`：latest 为 slot 1、端口 43171、source fingerprint `sha256:84491497cab72795a81986d66f6783e59f172c564f2fec1527da76bf177b4367`。

## 风险

- 当前只具备本地隔离证据；生产仍运行既有版本，本任务不授权生产 migration、部署或 Release。
