# 0007 轻量 Codex 治理规范

状态：已完成。

## 目标

吸收 AreaMatrix 和 AreaFlow 中适合 AreaForge 的轻量协作规范，形成“足够规范但不过度治理”的开发前工作方式。

## 范围

- Codex 协作工作流。
- 文档同步检查清单。
- 验证矩阵。
- 文件与 AI 安全边界。
- 与 `README.md`、`AGENTS.md`、`docs/README.md` 的入口同步。

## 不包含

- AreaMatrix task-loop。
- residual ledger。
- Codex OS runtime registry。
- prompt execution queue。
- 企业级 CODEOWNERS / PR 模板。

## 参考源事实

- `docs/development/codex-workflow.md`
- `docs/development/doc-sync-checklist.md`
- `docs/development/validation-matrix.md`
- `docs/security/file-ai-safety.md`
- `docs/development/pre-code-closure.md`

## 验收标准

- 新增规范在 `docs/README.md` 有入口。
- 高风险边界和文件/AI 安全规则能互相追踪。
- 验证矩阵能覆盖 docs、tasks、workflow、schema、packages、web、infra。
- 明确不引入 AreaMatrix 重型 task-loop 和 residual ledger。

## 验证

- `rg -n "codex-workflow|doc-sync-checklist|validation-matrix|file-ai-safety" docs tasks README.md AGENTS.md`
- `git diff --check`
- `pnpm check`
