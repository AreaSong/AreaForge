# Workflow

`workflow/` 记录版本级推进方式，不替代 `docs/product/roadmap.md`。

## 目录

- `versions/`：版本计划和验收标准。
- `templates/`：版本计划模板。
- `references/`：流程参考资料。

## 当前版本路线

- `versions/v0.1-mvp.md`：前置主闭环。
- `versions/v0.2-first-version-risk-closures.md`：完整第一版高风险闭环。
- `versions/v0.3-structured-learning-state.md`：结构化学习状态。
- `versions/v0.4-second-stage-long-term-loop.md`：第二阶段长期闭环。
- `versions/v1.0-prod-release.md`：生产发布闭环。

当前进度：v0.1 到 v1.0 对应的当前 docs 100% 证据已闭环。Package A-E 均已完成，远端 `https://forge.areasong.top/` 已通过 GitHub Release `v0.1.5` 签名更新运行 `0.1.5`。后续版本计划用于承接新功能、生产 extra smoke、自动策略调整或未来服务器/域名迁移。

## 使用规则

- 一个版本计划必须说明目标、范围、不包含、验收标准和退出条件。
- 版本计划只描述阶段，不承载具体实现细节。
- 具体执行事项拆到 `tasks/**`。
- 每次功能发布后必须同步对应 release tag、验证结果、线上 health、update-agent 状态和残余风险。
