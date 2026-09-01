# v1.2.0 发布准备与默认分支合并

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-release-operator
validation:
  - pnpm db:validate
  - isolated PostgreSQL 16 migration apply and repeat deploy
  - pnpm enterprise:operability:preflight
  - pnpm release:train:preflight
  - pnpm release:admission:selftest
  - pnpm release:identity:probe:selftest
  - pnpm release:workflow:policy
  - pnpm release:workflow:policy:selftest
  - pnpm release:closeout:binding:selftest
  - pnpm ops:ops-005:local:selftest
  - pnpm package-e:preflight
  - pnpm governance:preflight
  - pnpm github-release-updater:preflight
  - pnpm shellcheck:updater
  - pnpm release:supply-chain:selftest
  - pnpm release:supply-chain:record:selftest
  - pnpm ci:supply-chain:selftest
  - pnpm sc:sc-002:preflight:selftest
  - pnpm docs:readiness
  - pnpm docs:completion
  - pnpm risk:preflight
  - pnpm ops:readiness
  - pnpm tasks:doctor
  - pnpm skills:validate
  - pnpm secrets:scan
  - pnpm audit:prod
  - pnpm check
  - git diff --check
  - pnpm dev:test:refresh
  - pnpm dev:test:latest -- --json
  - responsive and governance browser evidence on the task-owned latest URL
residualRiskIds:
  - AF-RISK-SC-002
  - AF-RISK-UX-001
releaseRequired: true
```

## 目标

把 `feature/ui-optimization` 冻结为 `v1.2.0` 发布候选，完成版本与源事实同步、additive migration 隔离验证、完整本地门禁、测试池浏览器验收和 PR CI，并在 CI 成功后 squash 合并到 `main`。

## 已确认范围

2026-09-01 用户明确确认：

> 确认按 v1.2.0 执行第一阶段：准备发布、验证 additive migration 和完整门禁、创建 PR，CI 通过后 squash 合并并推送 main；不执行 Release tag、生产 migration、生产更新、备份恢复或自动应用策略变更。

本确认允许版本/文档修改、本地一次性 PostgreSQL migration apply/repeat、本地测试池写入、GitHub PR/CI 和 squash merge。它不允许 tag、Release、GHCR 发布、生产数据或服务器动作，也不改变 residual 状态。

## 候选范围

- 统一根与全部 AreaForge workspace package version 为 `1.2.0`。
- 高密度工作台、Dynamic Island、响应式共享能力和 Web 治理门禁。
- 第 36 条 additive migration：错题 v2 字段、`MistakeAttempt`、`NoteMistakeLink` 和模拟失分来源关联。
- 现有 AI/附件实现仅做回归验证；不扩大数据、权限、存储或外呼边界。
- 通过 PR 触发 GitHub CI，成功后 squash 合并到 `main`。

## 风险与停止条件

- migration 含 destructive DDL、历史数据修复、apply/repeat 不一致或 Prisma schema 漂移时停止。
- `pnpm check`、release/governance/supply-chain/docs gate、浏览器矩阵或 CI 任一失败时不合并。
- 版本、CHANGELOG、默认分支身份或候选证据不一致时不合并。
- 输出出现 secret、生产路径、真实学习内容或不可解释的附件/AI 数据时停止。

## 回滚

- PR 前不修改 `main`。
- PR 合并后、tag 前如发现问题，通过普通 revert 撤销 squash commit，不重写共享历史。
- 本阶段不执行生产 migration；additive schema 只存在于一次性本地数据库，失败时删除本轮精确临时数据库即可。
- 任何生产 apply、数据库/上传目录 restore 或 tag 删除都不在本任务权限内。

## 完成边界

- 完成只表示 `v1.2.0` 源码候选已进入默认分支并通过匹配 CI。
- 不证明签名 Release、GHCR digest、生产 health、生产 migration、backup/restore、rollback、长期运营或 residual 关闭。

## 本地验证快照

- 所有 workspace package version 均为 `1.2.0`，`pnpm audit:prod` 报告无已知漏洞。
- 36 条 Prisma migration 在隔离 PostgreSQL 16 数据库中首次 apply 与重复 deploy 均通过；验证库已删除，未触碰生产或共享开发数据库。
- `pnpm check` 通过：Web 测试 868 项通过，lint 0 errors，生产构建通过。
- `pnpm ops:ops-005:local:selftest` 通过；Node/tsx 自测使用可独立解析的相对 client boundary 导入。
- `pnpm package-e:preflight` 通过；Web runtime ops boundary 仅扫描生产源文件，按约定排除 `*.test.*`、`*.spec.*` 与 `__tests__` 测试文件，运行时代码的 deploy/backup/restore/migration 禁区保持不变。
- 响应式浏览器矩阵 `responsive-g8-v1.2.0-20260901-final3`：49 路由 × 7 视口 = 343/343，通过；原生 125% 缩放 5/5，通过；错误与溢出均为 0。
- Web 治理交互 `governance-g8-v1.2.0-20260901-final3b`：7/7 场景通过；业务写请求均为 route-intercepted，未产生本地业务写入，pair validator 通过。
- 上述浏览器证据均绑定当前候选提交、`1.2.0` runtime identity 和产品体验源指纹；证据目录为本地生成物，不作为发布资产提交。
- PR #49 的最终 head `4e8ce38d1eb4a1b12c0ae382574946976fc05b67` 通过 CI run `33505174259`，随后 squash 合并到 `main` commit `c8b5acf241bcaada59c6b469fd562d4fe400d521`。
- 产品代码 commit `c8b5acf241bcaada59c6b469fd562d4fe400d521` 的 main push CI run `33506280124` 通过，PR #51 随后完成状态文档收口；未来 tag 目标必须 fresh readback 当时的 main HEAD。未创建 `v1.2.0` tag、GitHub Release 或 GHCR 资产，未触碰生产 migration、生产更新、备份恢复、自动应用策略或 residual 状态。
