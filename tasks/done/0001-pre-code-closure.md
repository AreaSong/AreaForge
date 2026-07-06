# 0001 开发前闭环

状态：已完成。

## 目标

在开始真实 MVP 代码实现前，完成文档入口、功能范围、版本计划、任务拆分和验收门禁的统一。

## 范围

- 补齐 `docs/README.md`、`README.md`、`AGENTS.md` 的入口说明。
- 补齐 `tasks/**` 的轻量任务入口。
- 补齐 `workflow/versions/**` 的 v0.1 计划。
- 明确哪些已经闭环，哪些还没有闭环。

## 不包含

- 登录实现。
- 数据库 migration。
- 任务 CRUD。
- 计时持久化。
- AI 调用。
- 文件上传。

## 参考源事实

- `docs/development/pre-code-closure.md`
- `docs/product/feature-scope.md`
- `docs/product/roadmap.md`
- `docs/development/implementation-order.md`

## 验收标准

- 文档入口无明显断层。
- 旧顶层方案文件无残留引用。
- `tasks/active`、`tasks/backlog`、`workflow/versions` 不再为空。
- 第一版开发顺序能从文档直接追到任务。

## 验证

- 旧顶层方案文件名无残留引用。
- `find docs tasks workflow -maxdepth 3 -type f | sort`
- `rg -n "AreaForge产品""方案|AreaForge工程结构""方案|产品""方案\\.md|工程结构""方案\\.md" README.md AGENTS.md docs tasks workflow || true`
- `pnpm check`
- `git diff --check`

## 风险

- 只做前期闭环，不宣称业务 MVP 完成。
