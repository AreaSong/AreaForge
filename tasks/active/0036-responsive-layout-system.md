# 响应式布局系统与页面迁移

```yaml
status: in-progress
phase: planning
blockers:
  - 四档 Shell 行为和迁移批次待维护者确认后进入运行时代码实现
risk: medium
ownerSkill: areaforge-product-experience
validation:
  - pnpm docs:readiness
  - pnpm docs:links
  - pnpm docs:evergreen
  - pnpm tasks:doctor
  - pnpm check
  - pnpm dev:test:latest -- --json
residualRiskIds: []
releaseRequired: true
```

## 目标

让 49 条 canonical 页面遵循同一套四档响应式契约，优先消除平板与窄桌面的布局跳变、内容宽度不足、隐藏横向滚动和重复视口高度问题；保留现有视觉语言、canonical 路由、业务规则和确认边界。

## 当前基线

- 代码级检索已覆盖 `apps/web/app/**`、`apps/web/components/**`、共享 CSS、App Shell 和 canonical 路由。
- 真实视口抽查已覆盖 `280`、`390`、`768`、`900`、`1023`、`1024`、`1100`、`1280`、`1439`、`1440px`，代表页面包括开始学习、今日、知识、投入安排、周期复盘、模拟考试和设置。
- 当前没有普遍的页面根横向溢出；主要问题是 Shell 在 `1024px` 整体换型、三级内容宽度不足时仍强制桌面多栏、部分横向区域缺少滚动提示，以及 `workspace-full` 重复声明视口高度。
- 本基线是设计与迁移输入，不是全站每个状态组合的浏览器完成证据。

## 范围

- 包含：App Shell、一级/二级导航、顶栏、页面工具栏、状态栏、PageFrame、PageHeader、Toolbar、ListDetail、dashboard、移动安全区和页面响应式迁移。
- 包含：空态、加载态、错误态、长文本、动作收纳、键盘焦点、滚动所有权和 `125%` 缩放检查。
- 不包含：业务 API、数据模型、migration、认证、上传、AI、确认语义、canonical 路由或信息架构重做。
- 不包含：把桌面所有辅助信息原样搬到手机；移动端只保留当前任务所需信息和明确的后续入口。

## 参考源事实

- `docs/ux/application-shell-and-workbench-layouts.md`
- `docs/ux/shared-ui-foundations.md`
- `docs/ux/site-navigation.md`
- `docs/development/validation-matrix.md`
- `apps/web/lib/navigation/canonical-routes.ts`

## Owner Skill

- `.codex/skills-src/areaforge-product-experience`
- 浏览器和截图证据交给 `.codex/skills-src/areaforge-qa-smoke`。
- 文档同步与验证选择分别交给 `.codex/skills-src/areaforge-doc-sync` 和 `.codex/skills-src/areaforge-validation-driver`。

## 迁移矩阵

| 批次 | 范围 | 页面/组件 | 目标状态 | 退出条件 |
|---|---|---|---|---|
| R0 | 契约与基线 | 两份 UX 契约、验证矩阵、本任务 | 固定四档 Shell、内容容器预算、滚动与高度规则 | 文档门禁通过；维护者确认后进入 R1 |
| R1 | Shell 与原语 | `AppShell`、顶栏、一级/二级/移动导航、PageToolbar、状态栏、`PageFrame`、`PageHeader`、`Toolbar`、ListDetail | `1023/1024` 不再同时切换全部导航与页面栏数；公共高度和安全区统一 | 七档视口下 Shell 无遮挡、无根横向溢出；键盘焦点可恢复 |
| R2 | 每日行动闭环 | `/focus`、`/today`、`/roadmap/allocation*`、`/roadmap/reviews/daily` | 专注工作区只有一个高度所有者；今日与七日安排按内容宽度重排；移动详情保留来源 | 开始学习、收口、今日下一行动、任务详情和日期/筛选返回可完成 |
| R3 | 知识工作台 | 全部 `/knowledge*`，包含知识点、考纲、资料、卡片、错题、复习、导入、画布和专用运行页 | 长二级导航不靠无提示横向拖动；ListDetail 按轨道预算降级；画布/预览/练习使用稳定工作区 | 列表、详情、创建、筛选、返回和特殊工作区在七档视口可用 |
| R4 | 检验与长期路线 | 全部 `/test*`；`/roadmap`、`/roadmap/stages*`、`/roadmap/reviews`、`/roadmap/reviews/history/*` | 模拟、复测、阶段和报告的事实/建议/确认层级在窄屏不互相挤压 | 草稿、详情、历史和确认入口不丢失，表格/趋势有窄屏等价呈现 |
| R5 | 设置与公共边界 | 全部 `/settings*`、`/confirmations*`、`/login`、`/`、公共窗口和 Drawer | 平板设置导航进入抽屉；公共浮层考虑键盘与安全区；登录页无窄屏裁切 | 设置七入口、窗口最小化/恢复、登录错误态和公共返回均通过 |
| R6 | 全站收口 | 49 条 canonical 页面和共享特殊状态 | 统一清理重复断点、无效最小宽度和页面级视口高度 | 全量浏览器矩阵、`pnpm check` 和对应体验证据通过后再判断 Release |

## 页面模式验收

| 模式 | 手机 `<768px` | 平板 `768-1023px` | 普通桌面 `1024-1439px` | 宽桌面 `>=1440px` |
|---|---|---|---|---|
| `dashboard-wide` | 单列，主行动先于证据 | 单列或满足预算的紧凑两栏 | 按内容宽度使用一栏/两栏 | 允许主列 + 辅列 |
| `split-view` | 列表与详情分路由 | 不满足 ListDetail 预算时仍分路由 | 满足预算后列表 + 详情 | 允许筛选 + 列表 + 详情三轨 |
| `content-focus` | 单列表单，动作纵向全宽 | 保持可读宽度 | 居中或顺应内容区 | 不因宽屏无限拉长正文 |
| `workspace-full` | 主工作区全宽，检查器进入 Drawer | 主工作区优先，辅助面板可覆盖 | 可并排但只有一个主滚动所有者 | 允许完整工具轨和检查器 |

## 验收标准

- 浏览器宽度至少覆盖 `320`、`390`、`768`、`820`、`1024`、`1280`、`1440px`；另检查 `125%` 缩放和长中文文本。
- 每个宽度都检查页面根 `scrollWidth <= clientWidth`；有意横向滚动区必须有边缘提示、可聚焦且不隐藏主动作。
- 断点前后保留当前路由、筛选、选中对象、滚动恢复和焦点；不得因导航换型刷新业务状态。
- 固定顶栏、状态栏、移动导航和底部主动作不遮挡错误、最后一个字段或分页。
- 常规页和 `workspace-full` 各自只有一个主纵向滚动所有者；页面组件不新增 `100vh`、`h-screen` 或 `min-h-screen`。
- 交互尺寸、对比度、键盘路径和 `prefers-reduced-motion` 满足共享 UI 基线。

## 实施边界

- 优先用现有组件和 Tailwind/CSS container query；不新增仅服务单页的响应式框架。
- Shell 媒体查询只控制公共导航；页面栏数通过内容容器实际宽度决定。
- 每批独立验证和提交，不保留同页双实现；若批次回归，可回退该批组件和样式，不涉及数据库恢复。
- UI 代码进入线上需要新的 GitHub Release；本任务文档与本地实现不等同于 Release 或 production apply。

## 允许/禁止路径

- 允许：`apps/web/app/**` 的页面布局、`apps/web/components/**`、共享样式、相关 UI 测试与 `docs/ux/**`、`docs/development/validation-matrix.md`、本任务。
- 禁止：`prisma/**`、业务 API 写语义、认证/会话、AI provider、附件存储、生产配置、updater 和服务器命令。

## 文档同步

- 页面或导航行为实际变化后，同步 `docs/ux/application-shell-and-workbench-layouts.md`、`docs/ux/shared-ui-foundations.md` 和必要的 `docs/ux/site-navigation.md`。
- 每批状态只更新本任务和指定状态入口，不把规划能力写成既有生产事实。
- UI 行为进入线上时再同步 Release、生产 health、update-agent 状态和体验证据。

## 残余风险

- 规划与静态门禁不能证明真实页面体验；每个实施批次必须使用测试池 latest URL 做浏览器检查。
- 当前工作树存在其他功能改动；响应式实施必须按批次隔离差异，不能回滚或覆盖错题、复习和模拟相关改动。
