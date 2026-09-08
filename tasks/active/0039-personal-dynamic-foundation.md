# 0039 v1.3 个人版完全动态化

```yaml
status: in-progress
phase: awaiting-signed-release
blockers:
  - signed Release and production apply remain separate stages
risk: medium
ownerSkill: areaforge-product-experience
validation:
  - pnpm --filter @areaforge/core test
  - pnpm --filter @areaforge/web test
  - pnpm --filter @areaforge/web typecheck
  - pnpm ops:v13:subject-merge:typecheck
  - AREAFORGE_V13_SUBJECT_MERGE_ISOLATED_DB=1 pnpm ops:v13:subject-merge:runtime:selftest
  - pnpm check
  - pnpm dev:test:latest -- --json
residualRiskIds: []
releaseRequired: true
```

## 目标

完成多科目/分组首次设置、通用模板目录、408 去特殊化、重复科目处理和科目工作台，使个人版不依赖运行时写死业务数据。

## 范围与验收

- 范围和批次以 `workflow/versions/v1.3-v2.0-platform-evolution.md` 的 v1.3 为准。
- 空库、模板、自定义、多科目、归档恢复、重复处理和桌面/移动路径均需真实验证。
- 科目合并先做预览和安全转换，不在本任务物理删除历史对象。

## 当前进度

- 已实现多自定义科目/分组首次设置、版本化通用模板、408 去特殊化、科目/分组 CRUD、排序、归档和恢复。
- 已增加六个版本化阶段模板；选择只填充可编辑表单字段，提交前不写库。任务类型与八类资料分类已收敛到 Core 共享目录，API、服务和多处 UI 不再各自复制。
- 已实现重复科目规则、业务引用统计、活动 session 阻断提示、考纲/模拟/模拟补救冲突预览、知识点确定性去重、主知识点重分配统计和推荐保留科目。
- 已实现严格 preview/confirm/undo API、执行前 snapshot/revision/幂等校验、单事务全引用迁移、范围 hash/精确 preimage、来源科目软归档和 24 小时撤销；撤销遇到后续引用漂移、过期或唯一冲突时 fail closed。
- 2026-09-05 使用全新临时 PostgreSQL 17 应用当前 36 个 migration 后，v1.3 runtime selftest 的 10 组检查通过，覆盖完整引用、跨 Workspace、活动 session、四类预览冲突、故障注入 rollback、幂等重放、模拟来源漂移、撤销过期和唯一冲突 rollback；最终新建隔离库 `areaforge_v13subjectmerge_final_20260905_01` 重跑仍为 PASS。Core 109/109、Web 914/914、Core/Web/专项 typecheck 通过，Web lint 为 0 error / 200 个既有 warning。
- 2026-09-05 共享测试池已由本任务刷新到 slot 1 / `http://127.0.0.1:43171`，最终 source fingerprint `sha256:32da0af477aa89a57255d8129836bb260fabf37530afc0460b6e8a687e0565c3`；阶段模板、任务类型、资料分类、科目管理以及重复 preview/confirm/undo 已真实浏览器验收，任务详情阶段名称修复后已重建并复核。
- 2026-09-05 在隔离空库且未选择考试模板的条件下，完成自定义工作区、分组、唯一科目、阶段模板编辑/创建、关联任务、专注收口、知识卡片、每日复盘与今日闭环。模板提交前 `StagePlan=0`；今日页最终显示“1 段有效学习 / 1 条证据 / 今日已闭环”。目标考试日编辑保存后按上海日期 `2027-12-20` 读回。
- 空库旅程发现任务编辑能读回阶段关联、任务详情却显示“未关联”；已让详情查询加载阶段名称，重建后浏览器确认显示“系统强化期（空库验收）”，并补充回归契约测试。
- 390×844 移动端与 1440×900 桌面端的今日/考试科目页面均完成截图检查，`documentElement.scrollWidth === innerWidth`，未发现页面级横向溢出。
- `pnpm check` 已通过架构/Web 治理、全包 typecheck/test、Prisma validate 和 production build；docs/readiness/completion、risk、governance、tasks、residual 与 `git diff --check` 收口门禁均通过。
- PR #56 的 push 与 pull_request 两个 `ci/verify` 均通过，并于 2026-09-05 squash 合并到 `main` commit `40f1b36780418bbd544aaaadcd29c385aa2154e8`；随后 main push CI run `33906942919` 也成功。
- M0 已完成并合并到 `main`。本任务本地总门禁与受保护 PR/CI 已完成，仍缺 v1.3 独立签名 Release 和 production apply；本地/CI 验证不替代后续层级。

## 高风险边界

- 若新增 Prisma migration，先提交精确 migration 确认包。
- 不触碰生产、不删除历史数据、不扩大 AI 或运维能力。
