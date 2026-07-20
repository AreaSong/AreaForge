# Changelog

本文件面向使用者和自托管操作者，记录每个版本值得知道的变化，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

版本的事实源是签名 GitHub Release 与仓库 tag；本文件是人类可读摘要，机器可校验的逐版本证据见 `docs/development/` 下对应 release record。

## [Unreleased]

### Added

- 面向使用者的长期文档：产品上手、使用指南、配置参考、FAQ 与排障（`docs/guide/`）。
- 文档链接完整性与 Prisma 分层边界静态门禁（`pnpm docs:links`、`pnpm arch:boundary`）。

### Changed

- 长期文档与阶段性记录分层：模块/架构/部署文档回归长期表述，当前状态收敛到指定入口。

## [0.1.7] - 2026-07-12

### Fixed

- 修复 Release checksum 签名脚本，保证 `SHA256SUMS.sig` 与资产一致。

### Security

- 本版本作为签名供应链基线：SBOM、provenance、checksum、cosign 签名和 GHCR 不可变 digest 全部校验通过后发布，并由服务器侧 updater 应用到生产。

## [0.1.6] - 2026-07-12

### Added

- 品牌素材包：深浅色应用图标、横向 Logo 和品牌接入说明。
- 长期运营证据工具集：完成声明证据校验、live evidence gate、OPS-001 只读证据导出与收口包、OPS-004 告警证据预检、维护窗口记录生成器、只读支持包预览、update-agent 状态记录生成器。
- CI 供应链证据记录与提交匹配门禁。

### Changed

- 强化发布工作流边界与长期运营声明措辞，运营交接摘要接入控制面清单。

### Fixed

- 修复 CI shellcheck 兼容性与 OPS-001 证据自测夹具。

## [0.1.5] - 2026-07-10

### Fixed

- 修正 Release workflow 与 updater 预检细节（发布链路调试系列小版本之三）。

## [0.1.4] - 2026-07-10

### Fixed

- 完善 Release workflow 的资产生成步骤（发布链路调试系列小版本之二）。

## [0.1.3] - 2026-07-10

### Fixed

- 修正 Release workflow 与 updater 脚本引用（发布链路调试系列小版本之一）。

## [0.1.2] - 2026-07-10

### Added

- 加入 AreaForge Release cosign 签名公钥，自托管更新器可校验资产签名。

## [0.1.1] - 2026-07-10

### Added

- 设置页版本中心与受控更新请求：Web 只提交请求，更新由服务器侧执行。
- 首页版本更新提示弹层。

### Fixed

- 修复 Release updater 私有资产下载与数据库等待逻辑。
- 修复 CI pnpm 初始化顺序。

## [0.1.0] - 2026-07-10

首个签名 GitHub Release，包含第一版完整学习闭环与私有交付能力。

### Added

- 认证与会话：单管理员登录、scrypt 密码哈希、登录限速与审计事件。
- 今日作战台：双节点倒计时、今日任务、风险等级、连续打卡、阶段称号、鞭策文案、状态主题。
- 任务与债务：每日任务、任务债务池（补做/延期/拆小/合并/放弃/转复习）、债务事件账本、重排建议与用户确认应用。
- 计时与打卡：专注计时（暂停/继续/恢复）、结构化结束收口、有效学习判断、`CheckIn` 日快照。
- 考纲与掌握：考纲进度树、Markdown 导入、作战地图聚合、掌握条件/证据/复测的掌握证明链。
- 笔记与错题：文本笔记、私有附件上传与鉴权下载、错题与复习提醒。
- 复盘与报告：每晚复盘、周审判、月复盘、报告决策确认/驳回与快照冻结。
- 模拟与阶段：结构化全真模拟考试、阶段计划、阶段调整草稿（本地规则 + 显式 AI 触发，均需确认）。
- AI 协助：OpenAI-compatible provider、结构化输出校验、本地规则回退、最小化上下文边界。
- 恢复模式：规则触发与手动触发的最小任务恢复流程。
- 私有交付：Docker Compose 生产编排、备份与恢复流程、GitHub Release 服务器侧自动更新器。

[Unreleased]: https://github.com/AreaSong/AreaForge/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/AreaSong/AreaForge/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/AreaSong/AreaForge/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/AreaSong/AreaForge/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/AreaSong/AreaForge/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/AreaSong/AreaForge/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AreaSong/AreaForge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AreaSong/AreaForge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.0
