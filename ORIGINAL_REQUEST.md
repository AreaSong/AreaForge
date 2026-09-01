# Original User Request

## 2026-08-27T02:00:15+08:00

彻底解决当前页面“信息密度偏低、卡片留白过大、大屏空旷、有效数据字段稀疏”的问题，将 AreaForge 全站从“简易卡片列表”升级为**高信息密度、紧凑精致、充满数据洞察的专业备考工作台与仪表盘（IDE-Grade / Bloomberg-Style High-Density Ergonomics）**，在保持深色质感（`bg-[#0e1619]/90 border border-white/10`）的同时，大幅增加单屏有效信息量与交互深度。

Working directory: `/Users/as/Ai-Project/project/AreaForge`
Integrity mode: development

## Requirements

### R1. 全局布局与卡片紧凑化收敛 (Compact Grid & Layout Density)
- 缩减过度膨胀的容器内边距（从 `p-6`/`p-8` 收敛至紧凑的 `p-3.5` ~ `p-4.5`），减小卡片之间的垂直缝隙（`gap-4` 紧凑网格）；
- 在 1080p/900p 视口下实现**首屏黄金信息承载**，核心状态、统计与操作一览无余，无需大范围无谓滚动。

### R2. 核心模块多维数据字段与微图表丰富 (Rich Metrics & Micro-Visualizations)
- **`/today` 今日中心**：
  - 数据盘增加：时段分布热力条、学科投入占比进度条、任务耗时对比与遗忘预警等级；
  - 队列卡片增加：优先级标签、关联考纲路径、预估完成点数、一键快速启动；
- **`/knowledge` 知识中心**：
  - 概览增加：艾宾浩斯复习曲线分布区、科目掌握度雷达/分布条、高频薄弱知识点 Top 5 榜单；
  - 卡片库与错题本增加：作答统计微标签（作答次数、正答率、平均耗时）、考点重要度星级、最后复习距今天数；
- **`/test` 检验中心**：
  - 消除空旷两张大卡片，升级为**全功能检验仪表盘**：包含专项复测即时入口、模考历史得分折线趋势、薄弱模块失分排行榜、今日待测队列；
- **`/roadmap` 路线图中心**：
  - 消除空旷方块，升级为**阶段进度与投入全景看板**：甘特式阶段时间轴、考纲总复习覆盖率（%）、科目预算 vs 实际投入转化对比表；
- **`/settings` 设置中心**：
  - 采用紧凑型专业参数面板布局，增加当前工作空间容量、本地离线同步状态等详细元信息。

### R3. 交互与视觉层级增强 (Hierarchy & Visual Cues)
- 使用紧凑微徽章（Compact Badges）、状态指示灯（Status Dots）、迷你进度条（Mini Progress Bars）丰富视觉节奏；
- 保留标准深色玻璃拟态质感，确保密集而不杂乱，高信息量却清晰易读。

## Acceptance Criteria

### 1. 单屏有效信息承载度倍增
- [ ] 各核心页面（今日、知识概览、卡片库、检验中心、路线图）在 1080p 视口下的有效数据字段与指标展示量相比当前提升 **2x ~ 3x**；
- [ ] 彻底消灭任何“大片纯黑空旷背景仅放置 2~4 个单薄文本方块”的低密度低效排版。

### 2. 人机工学与视觉质感
- [ ] 紧凑排版下文字、徽章与按钮保持极高的对比度与点击热区舒适度；
- [ ] 保持全站青绿微光与深色玻璃拟态的一致性。

### 3. 自动化质量门禁
- [ ] `pnpm typecheck` 全项目 0 错误；
- [ ] `pnpm --filter @areaforge/web test` 全量单元测试 100% 绿灯；
- [ ] Playwright 自动化截取全站高密度重构后的多视口对比图。

## Follow-up — 2026-08-27T03:20:42+08:00

全量排查并重构 AreaForge 系统中散落的页面级粗暴横幅提醒（Status Banners / Alerts / Notifications），统一由全局顶部【搜索灵动岛（Dynamic Island）】进行联动接管与轻量胶囊化展示，净化页面视觉空间，实现全局跨页面的沉浸式督战感知。

Working directory: `/Users/as/Ai-Project/project/AreaForge`
Integrity mode: development

## Requirements

### R1. 全局顶部灵动岛状态胶囊系统升级 (Dynamic Island Status Capsule Engine)
- 在 `DynamicIsland` 与 `GlobalTopBar` 中扩展多态状态感知槽位：
  - **恢复模式状态（Recovery Status）**：展示琥珀色发光胶囊（如 `⚡ 恢复第3阶 · 需完成最小行动`），点击可直接呼出恢复工作流或平滑展开面板；
  - **活动暂停状态（Activity Paused）**：展示青绿微光胶囊（如 `⏸ 活动暂停中 · 可继续`），支持一键恢复；
  - **晚间提醒与收口状态（Evening Review Due）**：展示暮光微光胶囊（如 `🌙 晚间复盘待收口`），点击快速打开收口工作流；
  - **离线与同步状态（Sync & Connectivity）**：在灵动岛内自然指示，无需侵入正文。

### R2. 核心业务页面内粗暴横贯 Banner 全量净化 (Eliminate In-Page Static Banners)
- **`/today` 今日行动中心**：彻底移除页面顶部突兀的黄色/蓝色横贯 `TodayStatusBar`，将状态上移至灵动岛；
- **`/focus` 专注工作台**：移除冗余的静态大横幅提示，状态与断点倒计时统一由灵动岛与专注状态胶囊联动；
- **`/knowledge`、`/test`、`/roadmap`、`/settings`**：排查并移除各页面顶部占位粗暴的静态状态条，统一联动灵动岛调度。

### R3. 表单级局部错误与全局系统状态的清晰分层 (Clear Alert Layering)
- **全局状态/督战提醒**：100% 转移至顶栏灵动岛，不占页面高度；
- **表单输入校验与局部致命错误（Form Validation / Fatal Errors）**：保留为组件级紧凑提示（Inline Micro Feedback），不与全局灵动岛混淆。

## Acceptance Criteria

### 1. 页面清爽度与空间释放
- [ ] `/today` 页面及全站各核心入口彻底消灭破坏沉浸感的横贯长条 Banner，正文内容自然上提；
- [ ] 在 1080p、900p、768p 分辨率下，首屏视觉呈现纯净深色工作台质感。

### 2. 灵动岛联动交互与全局感知
- [ ] 在不同全局状态（恢复模式、暂停状态、晚间待收口）下，顶栏灵动岛均能精准展示对应发光胶囊并支持点击交互；
- [ ] 计时运行（Live Session）与全局状态提醒之间具备清晰的平滑过渡与折叠优先级。

### 3. 工程与自动化测试质量
- [ ] `pnpm typecheck` 0 错误；
- [ ] `pnpm --filter @areaforge/web test` 全量测试 100% 绿灯；
- [ ] Playwright 自动化截取灵动岛在多种状态下的渲染与各业务页面净化后的整体视觉。

