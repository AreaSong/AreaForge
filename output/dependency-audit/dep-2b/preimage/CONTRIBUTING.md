# 贡献指南

感谢关注 AreaForge。这是一个面向个人长期备考的单管理员私有 Web 应用，由单一维护者运营；欢迎 issue 反馈与小范围 PR，大范围功能请先开 issue 讨论再动手。

## 开始之前

- 产品定位与边界：[docs/product/charter.md](docs/product/charter.md)。多用户、排名、原生 App 等明确不在范围内（见 [功能范围](docs/product/feature-scope.md) 的暂缓清单），相关 PR 不会被合并。
- 本地环境搭建：[docs/development/setup.md](docs/development/setup.md)。
- 工程分层约束：[docs/architecture/overview.md](docs/architecture/overview.md)。核心规则：`packages/core` 平台无关；页面不直接调用 Prisma；上传文件不进 `public/`。

## 提交 issue

- 使用仓库提供的 issue 模板（bug、功能、支持、安全边界咨询）。
- 不要在公开 issue 里贴生产日志、环境文件、密钥或个人学习数据；诊断信息用 `pnpm ops:support:bundle-preview` 生成 metadata-only 预览，详见 [SUPPORT.md](SUPPORT.md)。
- 安全漏洞不走公开 issue，按 [SECURITY.md](SECURITY.md) 私密披露。

## 提交 PR

1. 从默认分支创建特性分支，保持单一主题、小改动。
2. 提交说明用中文，代码标识符用英文。
3. 提交前至少通过 `pnpm check`（含 typecheck、lint、test、build 与文档链接门禁）；按改动范围补充验证，见 [验证矩阵](docs/development/validation-matrix.md)。
4. 涉及文档、依赖、CI、安全策略的改动，遵循 [依赖与治理策略](docs/development/dependency-policy.md) 并运行 `pnpm governance:preflight`。
5. 填写 PR 模板；评审门禁见 [CODE_REVIEW.md](CODE_REVIEW.md)。

## 高风险边界（PR 不能直接触碰）

数据库 migration、批量数据修复、认证/会话/密钥、AI 隐私边界、备份恢复策略、发布与更新链路的变更，必须先在 issue 中说明影响、风险、验证与回滚思路，得到维护者确认后再实施。生产部署与发布由维护者独立执行，贡献者 PR 不包含生产操作。
