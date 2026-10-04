# Code Review Policy

本文件定义 AreaForge 的轻量代码评审门禁。它不替代 `AGENTS.md`、`docs/development/validation-matrix.md` 或高风险确认包，而是把评审时必须看见的证据集中到一个入口。

## 评审目标

- 改动必须对齐源事实：产品范围、架构边界、模块设计、UX、开发顺序、部署、安全和残余风险分别以 `docs/**` 的对应目录为准。
- 改动必须走真实业务路径：不要只满足测试替身或静态文案，涉及 Web/API/DB/文件/AI/update 的路径要能说明入口、权限、失败和回退。
- 改动必须保护用户数据：数据库、附件、上传目录、备份、AI 上下文、日志和发布资产不能被意外移动、覆盖、删除、泄露或静默外发。
- 改动必须可验证：评审结论要有命令输出、烟测、截图、发布记录、readiness summary 或明确未验证项支撑。

## 阻断项

以下任一项出现时，评审应阻断合并或发布，除非有明确风险接受记录和回滚方案：

- 未经确认触碰高风险边界：auth/session、uploads、AI 隐私、Prisma migration、备份/恢复、部署/update/rollback、自动应用策略或服务器命令能力。
- Web runtime 获得 Docker、backup、restore、migration、updater apply、rollback 或服务器 shell 能力。
- 上传文件进入 `public/`，或 UI/API 暴露 `Attachment.uri`、`storedName`、上传绝对路径、数据库 URL、API key、cosign 私钥、完整 prompt/raw response。
- GitHub Release、GHCR image、updater manifest、`SHA256SUMS`、签名、SBOM/provenance、rollback target 或 smoke 证据缺失，却声称生产可更新或可回滚。
- 只用 `pnpm check`、静态截图或旧 release 记录证明生产健康、用户体验或供应链信任。
- 残余风险被删除、弱化或改成完成态，但没有满足 `docs/development/residual-risk-ledger.md` 的关闭条件。

## 评审顺序

1. 确认改动范围：code、docs、ops/release、security/privacy、AI、uploads/storage、database/migration。
2. 读取对应源事实：`docs/README.md`、`docs/development/validation-matrix.md`、相关模块文档、高风险确认包和残余风险台账。
3. 检查权限和数据边界：认证、actor 来源、文件路径、AI 最小上下文、日志脱敏、release/updater 信任链。
4. 检查验证证据：命令是否匹配改动范围，是否有失败项、跳过原因、证据新鲜度和未验证残余。
5. 对 release/ops 变更，检查版本、tag、digest、signature、backup、migration runner、smoke、rollback target、readiness summary 和残余风险 ID。

## 输出格式

评审输出默认 findings first：

```text
Findings:
- [P0/P1/P2] path:line - 影响、失败路径、建议修复和验证方式。

Open questions:
- 需要用户或维护者确认的边界。

Validation reviewed:
- 已审验证命令、结果、证据时间和覆盖范围。

Residual risk:
- 保留的 AF-RISK-*，关闭条件，下一 owner。
```

没有问题时，明确写“未发现阻断项”，并列出仍未验证的范围。不要把“没看到问题”写成“生产已健康”。
