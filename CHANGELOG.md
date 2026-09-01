# Changelog

本文件面向使用者和自托管操作者，记录每个版本值得知道的变化，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

版本的事实源是签名 GitHub Release 与仓库 tag；本文件是人类可读摘要，机器可校验的逐版本证据见 `docs/development/` 下对应 release record。

## [Unreleased]

暂无。

## [1.2.0] - 2026-09-01

本节为 `v1.2.0` 发布候选说明；当前尚未创建 tag 或 GitHub Release，也未执行 production apply。最新稳定 Release 仍为 `v1.1.2`，生产与回滚基线仍为 `v1.1.1`。

### Added

- 增加全局 Dynamic Island 状态胶囊、活动卫星气泡、命令面板和跨页面状态接力，统一承接恢复、计时、晚间收口与同步提示。
- 增加错题 v2 学习证据闭环：结构化题面/答案/原因、持久作答记录、笔记关联、模拟失分来源关联和专项练习入口。
- 增加 Web 共享边界与浏览器治理门禁，覆盖 API adapter、DTO、UI 原语、浏览器存储、异步操作门和组件复杂度。

### Changed

- 全站核心工作台改为高信息密度、容器查询驱动的响应式布局，压缩工具栏和无效留白，并统一 8pt 间距与卡片层级。
- 今日、知识、检验、路线和设置工作台补充紧凑指标、微型可视化、窄屏等价布局和恢复路径。
- Prisma schema 增加第 36 条 additive migration；本地候选只允许隔离 apply/repeat 验证，不授权生产 migration。
- 全部 AreaForge workspace package version 统一提升到 `1.2.0`。

### Security

- 保持 AI 外呼显式授权、最小化 payload、Provider 密钥服务端加密和附件私有鉴权边界；本次不扩大 AI 数据范围或附件生命周期权限。
- 保持 Web runtime 禁止执行服务器命令、稳定 Release 必须签名并使用不可变镜像 digest、`AREAFORGE_AUTO_APPLY=none` 的边界。

## [1.1.2] - 2026-08-11

本版本完成学习行动中心的完整收口并已形成稳定 GitHub Release；发布不表示生产已更新，生产与回滚目标仍保持 `v1.1.1`，且 `AREAFORGE_AUTO_APPLY=none` 不变。

### Added

- 增加统一的五入口 App Shell、全局工具与工作窗口、确认中心、活动槽和跨页面学习收口。
- 增加知识卡片、学习树导入、资料工作台、统一复习、专项复测、模拟考试、阶段与计划收件箱的完整闭环。
- 增加本地固定测试池和完整测试数据生成入口，便于复用 production build 进行桌面与移动验收。

### Changed

- 数据模型新增 11 条有序 migration，覆盖 AI Provider 配置、知识中心、学习会话收口、设备 presence、复测结果、任务阶段/知识点关联与统一活动会话。
- Next.js 升级到 `16.3.0`、React 升级到 `19.2.8`、Prisma 升级到 `7.9.1`、yaml 升级到 `2.9.0`。
- 全部 AreaForge workspace package version 统一提升到 `1.1.2`。

### Security

- 保持 AI 当前浏览器显式授权、Provider 凭据服务端加密、附件鉴权访问和 Web runtime 禁止服务器命令等边界。
- Release 继续要求不可变镜像 digest、SBOM、provenance、SHA256SUMS 与 cosign 签名；本次不授权 production apply。

## [1.1.1] - 2026-07-31

稳定 GitHub Release `v1.1.1` 已发布；生产仍运行 `v1.1.0`，本条 Release 记录不表示 production apply 已执行。

### Fixed

- 修复首次创建工作区时默认科目与待接管旧科目的 stable key 冲突，改为可理解的 409 结果并避免重复创建数学与 408 科目。
- 补齐无工作区引导、科目与分组管理，并收敛今日、计划、知识、复盘、阶段和设置页面的信息层级与移动端导航。
- 修复异步冲突 Modal 的焦点返回竞态，并让 v1.1 专用 Release admission 覆盖整个 `v1.1.x` patch 系列且继续精确绑定 tag/version/commit 证据。

## [1.1.0] - 2026-07-31

稳定 GitHub Release `v1.1.0` 已发布，Release 资产包含 manifest、SBOM、provenance、SHA256SUMS 与签名文件；生产 health 绑定 commit `4dbdb31a96498487af09aa7f90275bfc549448f3`。发布后产品化修复继续记录在 `[Unreleased]`，不属于本版本既有资产。

### Added

- 学习行动中心：当前考试工作区、七天计划、计划收件箱、专注与快速复习构成统一行动入口。
- 知识工作台：学习树模板、严格预览与原子确认、知识卡片、错题、资料、统一复习和关联画布。
- 阶段闭环：结构化模拟考试与失分、补救候选入箱、周期报告决策、阶段调整确认和 7/30 天分析。
- 体验与协助：动机内容库、通知偏好、四类显式 AI 草稿，以及桌面和移动端 canonical 路由。

### Changed

- 数据模型通过八个有序 additive migration 扩展到 workspace、导入历史、复习、画布、动机、通知和模拟失分。
- 应用版本与全部 AreaForge workspace package version 统一提升到 `1.1.0`。

### Security

- 保持 AI payload 最小化、附件鉴权访问、Web runtime 禁止服务器命令及 `AREAFORGE_AUTO_APPLY=none`；Release 或生产更新不自动关闭 residual。

## [0.1.9] - 2026-07-21

### Added

- 面向使用者的长期文档：产品上手、使用指南、配置参考、FAQ 与排障（`docs/guide/`）。
- 文档链接完整性与 Prisma 分层边界静态门禁（`pnpm docs:links`、`pnpm arch:boundary`）。
- 服务器侧只读告警推送 helper（`ops/alerting/`）：health、update-agent 状态、备份新鲜度、磁盘、证书五类信号按阈值推送 ntfy/Telegram/webhook，支持降噪与恢复通知。
- 站点导航、全项目功能图与坑点库长期文档（`docs/ux/site-navigation.md`、`docs/development/feature-map.md`、`docs/development/gotchas.md`）。
- 附件上传写入意图协议：数据库先登记 PENDING 意图，staging 写入 + fsync + 原子 rename 后 CAS 置 READY；下载仅允许 READY 且以 O_NOFOLLOW 同句柄校验；新增有界 claim/lease 对账维护命令。
- 服务器侧 updater 阶段日志与维护 hold/drain：hash-chained 不可覆盖阶段事件、备份清单持久化屏障、崩溃后 fail-closed hold 与固定锁序的队列准入。

### Changed

- 长期文档与阶段性记录分层：模块/架构/部署文档回归长期表述，当前状态收敛到指定入口。
- 登录限速只信任反向代理可控来源头；附件上传增加 Content-Length 预检。
- 首页、考纲、报表查询编排性能优化（请求级共享、轻量选项树、查询合并与节流）。

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

[Unreleased]: https://github.com/AreaSong/AreaForge/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/AreaSong/AreaForge/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/AreaSong/AreaForge/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/AreaSong/AreaForge/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/AreaSong/AreaForge/compare/v0.1.9...v1.1.0
[0.1.9]: https://github.com/AreaSong/AreaForge/compare/v0.1.7...v0.1.9
[0.1.7]: https://github.com/AreaSong/AreaForge/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/AreaSong/AreaForge/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/AreaSong/AreaForge/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/AreaSong/AreaForge/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/AreaSong/AreaForge/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/AreaSong/AreaForge/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/AreaSong/AreaForge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/AreaSong/AreaForge/releases/tag/v0.1.0
