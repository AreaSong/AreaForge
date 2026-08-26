# Original User Request

## Initial Request — 2026-08-25T20:11:24Z

AreaForge 全站系统级 UI 风格与交互规范底层大一统：以 `/focus` 沉浸工作台确立的高质感深色卡片与人机工学规范为基准，首先完成全局基础组件库（Cards、Buttons、Form Fields、Segmented Controls）、设计 Tokens 与全局 App Shell（顶栏灵动岛、侧边栏工具区、底部状态栏）的标准化封装，为后续各业务页面（/today、/knowledge、/test、/roadmap、/settings）提供统一、可复用、免重复劳动的无缝设计基础设施。

Working directory: `/Users/as/Ai-Project/project/AreaForge`
Integrity mode: development

## Requirements

### R1. 全局设计 Tokens 与基础卡片/容器规范 (Design Tokens & Surface Containers)
- 在 `packages/ui` 与 `apps/web/app/globals.css` 中固化高质感深色工作台 Tokens：
  - 容器与工作台底色（Canvas / Subtle Surface）；
  - 主卡片质感：`bg-[#0e1619]/90 border border-white/10 shadow-lg rounded-2xl`；
  - 次级卡片与提示卡：`bg-white/[0.02] border border-white/5 rounded-xl` 与微光提示卡规范；
  - 消除所有残留的未授权呼吸发光与缩放动画。

### R2. 核心表单控件与交互元素统一封装 (Form Inputs & Segmented Controls)
- 统一 `Input`、`Textarea`、`Select`、`Radio`、`Checkbox`、`SegmentedField`：
  - 统一输入框高度（`h-10` / `h-11`）与 `rounded-xl border-white/10 bg-white/5`；
  - 统一 Focus 状态的青绿高亮环（`focus:border-teal-400 focus:outline-none`）；
  - 统一多选项（Segmented Options）的选中青绿光斑效果与未选中半透明悬停交互。

### R3. 按钮系统与底部定死操作栏规范 (Button System & Pinned Bottom Action Bar)
- 统一主操作按钮（Primary Button）：青绿背景 `bg-teal-400` + 柔和青绿外发光 `shadow-[0_0_20px_rgba(45,212,191,0.35)]` + 点击缩放 `active:scale-[0.98]`；
- 统一次级/返回按钮（Secondary/Ghost Button）：半透明边框 + 统一高度；
- 封装通用的 `PinnedActionBar` 布局结构，确保任何工作区中的操作按钮均可绝对定死贴底、与左侧栏严格底边对齐。

### R4. 全局 App Shell 视觉深度与层级统一 (App Shell, Dynamic Island & Sidebar)
- 顶栏灵动岛（Focus Island）：确保展开收缩 60fps 平滑，秒表数字与状态徽章逻辑一致，内部留白与顶栏横线和谐；
- 侧边栏（Sidebar）：统一激活菜单的高光色块、图标微交互以及底部个人/设置区域的分割线；
- 底部状态栏（Footer Status Bar）：统一设备同步状态、离线指示与网络延迟标签的排版与颜色。

## Acceptance Criteria

### 1. 组件库与 Token 完备性
- [ ] 所有基础卡片、按钮、输入框、分段选择器均在 `@areaforge/ui` 或 `components/ui` 中拥有标准化导出，不再出现各页面散装内联样式。
- [ ] 按钮与输入框尺寸、圆角、阴影在全站范围内 100% 保持一致。

### 2. 人机工学与零滚动保障 (Ergonomics & Zero-Scroll)
- [ ] 封装的 `PinnedActionBar` 在 1920x1080、1440x900、1366x768 等所有主流分辨率下，均能实现底边像素级对齐且无内容溢出遮挡。
- [ ] 宽屏下表单元素不发生畸形带鱼拉伸，小屏下无多余垂直滚动。

### 3. 工程质量与自动化验证
- [ ] `pnpm typecheck` 零错误通过。
- [ ] `pnpm --filter @areaforge/web test` 245/245 全部测试绿灯通过。
- [ ] Playwright 截图覆盖基础组件在不同分辨率（1080p / 900p / 768p）下的渲染表现。
