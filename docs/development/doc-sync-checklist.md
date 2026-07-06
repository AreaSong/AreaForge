# 文档同步检查清单

## 目标

防止 `docs/`、`README.md`、`AGENTS.md`、`tasks/`、`workflow/` 之间出现源事实漂移。

## 源事实顺序

1. `docs/product/**`：产品定位、范围、路线图。
2. `docs/architecture/**`：工程结构、数据、API、部署、文件存储、AI 边界。
3. `docs/modules/**`：业务模块行为。
4. `docs/ux/**`：页面状态和交互。
5. `docs/security/**`：高风险边界。
6. `docs/development/**`：开发顺序、验证和工作流。
7. `workflow/versions/**`：版本计划。
8. `tasks/**`：执行任务。

## 必查项

- 新功能是否有 `docs/modules/**` 或 `docs/product/**` 落点。
- 新 API 是否同步 `docs/architecture/api-surface.md`。
- 新表或字段是否同步 `docs/architecture/data-model.md`。
- 上传、附件、AI、认证、部署变化是否同步安全文档。
- README 是否只导航，不承载更深规则。
- AGENTS 是否只放协作规则和高风险边界，不替代详细设计。
- `tasks/**` 是否引用对应源事实。
- `workflow/versions/**` 是否有入口条件、范围、不包含和验收标准。

## 旧内容检查

完成拆分或迁移后，应检查：

- 旧顶层方案文件名无残留引用。
- 同一功能没有在多个文档中定义不同规则。
- 暂缓项没有被写进当前版本验收标准。
- 历史讨论没有变成当前产品事实。

## 推荐命令

```bash
rg -n "AreaForge产品""方案|AreaForge工程结构""方案|产品""方案\\.md|工程结构""方案\\.md" README.md AGENTS.md docs tasks workflow
find docs tasks workflow -maxdepth 3 -type f | sort
git diff --check
```

## 完成标准

- 入口路径一致。
- 源事实和执行任务能互相追踪。
- 暂缓项、当前范围和第二阶段增强没有冲突。
- 未发现旧文件名或旧路径残留。
