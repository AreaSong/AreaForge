# Support Bundle Preview

## 目标

本文件定义 AreaForge 的 metadata-only 支持包预览。它借鉴 AreaFlow 的 support bundle preview 思路，但只保留适合 AreaForge 的公开支持和维护交接能力：列出版本、文档入口、残余风险、下一步只读命令、claim boundary、`doesNotProve` 和 redaction/safety facts。

它不是 support bundle export，不复制附件、日志、数据库、备份或用户学习内容；也不连接生产、不执行 Docker、不运行 migration、不触发 updater、不创建 Release、不推 tag、不写生产。

## 入口

```bash
pnpm ops:support:bundle-preview > /path/to/support-bundle-preview.json
pnpm ops:support:bundle-preview:validate /path/to/support-bundle-preview.json
```

本地回归：

```bash
pnpm ops:support:bundle-preview:selftest
```

## 默认包含

- AreaForge package name、version、release tag、线上 URL 和 `AREAFORGE_AUTO_APPLY=none` 安全默认。
- 支持、运维、release、residual 和 operator onboarding 文档入口。
- 可安全公开的命令名，例如 `pnpm ops:handoff`、`pnpm ops:readiness:summary`、`pnpm ops:evidence:bundle`、`pnpm residuals:review-due`。
- `docs/development/residual-risk-ledger.json` 中的 residual ID、类型、复核时间、owner skill、关闭条件和所需证据。
- `doesNotProve`：生产健康、updater apply、备份/恢复/migration/rollback 执行、GitHub Release 创建、residual 关闭、真实支持包导出或高风险操作授权。
- `safetyFacts`：read-only、metadata-only、未导出、未联网、未执行服务器命令、未写生产、未包含敏感内容。

## 默认排除

- secret values、private env、database dumps、backup archives。
- upload file contents、attachment binary/text、private review body、motivation/emotion records、AI context text。
- raw logs、session tokens、未脱敏 stdout/stderr。
- 生产 `.env`、数据库 URL、API key、session secret、GitHub token、cosign 私钥、smoke 密码。

## 与 Evidence Bundle 的区别

| 入口 | 用途 | 不能证明 |
|---|---|---|
| `pnpm ops:support:bundle-preview` | 面向公开支持、自托管用户和维护交接的 metadata-only 预览 | 生产健康、运行信号新鲜、support export |
| `pnpm ops:evidence:bundle` | 面向 release/ops/incident 的运行信号证据索引 | 缺失信号健康、生产写入已执行 |

公开 issue、PR 或 support thread 中优先要求用户提供 support bundle preview 的 redacted 校验结果；只有进入 release/update/incident 证据冻结时，才需要 operational evidence bundle。

## 校验边界

`pnpm ops:support:bundle-preview:validate` 只读取本地 JSON，校验：

- `mode=metadata_only_support_bundle_preview`
- `metadataOnly=true`
- `exportOpen=false`
- canonical `supportBundlePreviewHash`
- 必需 excluded sensitive content 和 forbidden actions
- 必需 `doesNotProve` 边界
- `safetyFacts` 全部保持只读/未导出/未写入/未含敏感内容
- 输出中没有常见 secret、token、数据库 URL、私钥或未脱敏凭据形态

校验通过只说明支持包预览形态安全，不代表生产健康或 residual risk 已关闭。
