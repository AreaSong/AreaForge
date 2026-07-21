# v1.1 Batch 4 学习树 preview 与 Migration 4

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm db:validate
  - pnpm governance:preflight
  - pnpm audit:prod
  - pnpm ops:v11:m4:runtime:selftest
  - pnpm --filter @areaforge/core test
residualRiskIds: []
releaseRequired: false
```

## 目标

实现学习树 V1 parser/exporter、模板、无业务写入 preview、diff；实施 Migration 4 StudyResource schema。不开放 confirm。

## 完成摘要（2026-07-21）

- 依赖准入：`packages/core` 引入 `unified` / `remark-*` / `yaml` / `mdast-util-to-markdown` / `unist-util-visit`；`pnpm governance:preflight` 通过；`pnpm audit:prod` 无 high/critical（1 moderate，不阻塞）
- Migration 4：`20260721200000_v11_m4_study_resource`（StudyResource FILE/LINK CHECK、attachment unique、标签与四类关联）
- Core：`AREAFORGE_LEARNING_TREE_V1` parser/exporter/模板/URL/diff/preview-token + 单元测试（golden/round-trip、恶意 Markdown corpus、fail-closed）
- 隔离 API：`GET /api/learning-tree/templates`、`GET /api/learning-tree/export`、`POST /api/learning-tree/imports/preview`
- 临时库 selftest：`AREAFORGE_V11_M4_ISOLATED_DB=1 pnpm ops:v11:m4:runtime:selftest`（库名含 `v11m4`；含 Migration 4 约束、confirm 未开放、preview 零写入）
- **无** confirm 路由；**无**生产页面/导航；**无** StudyResource CRUD API；**未**生产 migration；**未**关闭 `AF-RISK-DATA-001`

## 验证收口（2026-07-21 本会话）

| 命令 | 结果 |
|---|---|
| `pnpm db:validate` | PASS |
| `DATABASE_URL=.../areaforge_v11m4 pnpm db:migrate:deploy` | PASS（No pending） |
| `AREAFORGE_V11_M4_ISOLATED_DB=1 pnpm ops:v11:m4:runtime:selftest` | PASS（含 `confirm_not_open`、`preview_zero_write` auditEvent=0） |
| `pnpm --filter @areaforge/core test` | PASS（65，含 golden/round-trip/恶意 corpus） |
| `pnpm check` | PASS（仅 templates/export/preview，无 confirm） |
| `pnpm governance:preflight` | PASS |
| `pnpm audit:prod` | PASS（无 high/critical） |

确认状态：沿用 migration + unified/remark/yaml 依赖准入边界；不开放 confirm；不关 `AF-RISK-DATA-001`。

## 禁止（仍有效）

- 不新增生产可路由页面或导航入口。
- 不开放 `imports/confirm`。
- 不在本批执行生产 migration / updater / residual 关闭。
