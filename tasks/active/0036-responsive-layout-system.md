# 响应式布局系统与页面迁移

```yaml
status: in-progress
phase: implementation
blockers:
  - G6：主线程以当前 checkout 刷新测试池并补充新鲜浏览器证据
  - 包含本轮 UI 改动的新 GitHub Release
  - 独立 production apply 确认
risk: medium
ownerSkill: areaforge-product-experience
evidenceClass: source
validation:
  - pnpm web:shared-boundary
  - pnpm web:shared-boundary:selftest
  - pnpm web:api-parser-boundary
  - pnpm web:api-parser-boundary:selftest
  - pnpm web:ui-primitives-boundary
  - pnpm web:ui-primitives-boundary:selftest
  - pnpm web:client-boundary
  - pnpm web:client-boundary:selftest
  - pnpm web:component-complexity
  - pnpm web:component-complexity:selftest
  - pnpm web:governance:typecheck
  - pnpm --filter @areaforge/web typecheck
  - pnpm --filter @areaforge/web lint
  - pnpm check
  - pnpm docs:readiness
  - pnpm docs:links
  - pnpm docs:evergreen
  - pnpm docs:completion
  - pnpm risk:preflight
  - pnpm tasks:doctor
  - git diff --check
  - pnpm dev:test:refresh
  - pnpm dev:test:latest -- --json
  - Playwright responsive browser matrix on the task-owned latest URL
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

## 本地实施结果（R1-R6）

R1-R6 已在当前 checkout 完成本地实现，范围与原迁移矩阵一致：

- R1：统一 `AppShell`、顶栏、一级/二级/移动导航、`PageFrame`、页面工具栏、状态栏和公共高度/安全区契约；移动底部一级导航默认隐藏，仅在 `<768px` 显示，`768-1023px` 使用顶栏导航抽屉，`>=1024px` 使用桌面侧栏。
- R2：迁移 `/focus`、`/today`、投入安排和每日复盘；专注工作区只有一个高度所有者，日期带、任务详情和移动返回上下文按内容宽度降级。
- R3：迁移全部 `/knowledge*`，包含知识点、考纲、资料、卡片、错题、复习、导入、画布和错题练习；长二级导航、ListDetail、预览和练习工作区均保留可聚焦滚动或抽屉降级。
- R4：迁移 `/test*`、阶段、趋势、报告、历史报告、模拟考试和专项复测；事实、建议、草稿和确认入口在窄屏保持独立层级。
- R5：迁移 `/settings*`、确认中心、Modal、Drawer、Global Tool、Window 和 Dock；平板导航/手机设置工具可打开、Escape 关闭并恢复触发器焦点。
- R6：清理页面级重复断点、重复视口高度和无效最小宽度，补充 `af-*` 容器查询布局原语，并对全站 canonical 页面做静态收口。

### 前端共享能力与解耦治理（G0-G7）

| Gate | 当前状态 | 当前 checkout 事实 |
|---|---|---|
| G0：能力清单与依赖方向 | DONE / 本地实现完成 | `docs/architecture/web-shared-capability-inventory.json` 登记 canonical 能力、owner、契约和验证命令；清单 schema、路径存在性、父子范围重叠和依赖方向由 `web:shared-boundary` 校验。 |
| G1：DTO、API adapter 与旧门面删除 | DONE / 本地实现完成 | DTO 统一归口 `apps/web/lib/contracts/**`，浏览器请求统一归口 `apps/web/lib/api/**`；`apps/web/lib/contracts/study.ts`、`apps/web/lib/study/service.ts`、`apps/web/lib/study/types.ts` 已删除，门禁禁止重新创建或导入。 |
| G2：共享 UI 原语 | DONE / 本地实现完成 | 非豁免 raw `input/select/textarea/button` debt 为 `0`，`LEGACY_UI_PRIMITIVE_BUDGET` 为空；新增 debt 直接失败。 |
| G3：浏览器存储与 API 错误边界 | DONE / 本地实现完成 | 组件和 client 中直接浏览器 storage debt 为 `0`，显式比较 HTTP `401/409` debt 为 `0`；两类 legacy budget 均为空，分别统一经 `storage-port.ts` / `draft-store.ts` 和 `api-errors.ts` 处理。 |
| G4：组件复杂度 | DONE / 本地实现完成 | 原 24 个超过 500 行的非测试 TSX 均已降至 `<=500`；B6 改动后重新超限的学习树导入、错题列表和卡片详情也已拆回 500 行内。component legacy budget 为空；单函数超过 50 行只输出 observation/warning，不作为硬失败条件。 |
| G5：治理门禁 | DONE / 本地实现完成 | 五个专项 gate、各自 selftest 和 `pnpm web:governance:typecheck` 已接入；五个 gate 同时进入 `pnpm check`。拆分后过期的 local UX、AI provider 与 Quick Review 源码 selftest 已改为跟随 canonical owner。 |
| G6：当前 checkout 浏览器证据 | DONE / current-bound v2 evidence | 已在刷新后的 slot 1（`areaforge-dev-test-1`，`http://127.0.0.1:43171`）完成 responsive 343/343 route-viewport 组合、125% zoom 5/5 和 governance 7/7 交互场景；responsive/governance v2 validator 与 pair validator 均通过。证据路径见下方“G6 当前证据”。 |
| G7：文档同步 | DONE / 当前 checkout 已同步 | 本任务、任务索引、UX 永久契约、Web 入口说明、验证矩阵、doc-sync 清单和机器清单已同步；这只证明当前 checkout 的文档/源事实对齐，不等于 GitHub Release 或 production apply。 |

### 复杂异步与状态一致性收口（B6）

- `apps/web/lib/client/operation-gates.ts` 统一提供 latest-wins 和同步互斥批次 identity；AI 草稿、Shell 手动恢复和资料上传已形成三个稳定消费者，并有代际失效、乱序响应和过期释放单测。
- AI preview/generate 使用显式网络 pending 和不可变 input/token/context/storage-key 快照；表单、路由 context 或 key 变化会使在途请求失效。草稿 envelope 保存 exact `contextKey`，短哈希碰撞不能串用表单草稿。
- 资料上传在首个 await 前同步取得批次锁，冻结文件与 subject/category/tags；上传期间锁定模式、字段、文件和重复项决策，迟到响应不能释放或改写新批次。
- 资料详情草稿升级为 `{ schemaVersion, baseRevision, values }`；current revision 可恢复，stale/legacy 草稿进入显式冲突且不能直接提交。
- AI 选区的唯一 identity、React key/删除 identity 与完整来源 fingerprint 已分离；旧 `{ id, label, text }` 可迁移，已知 32 位哈希碰撞和同文不同 DOM 元素不会错误合并。
- 归档错题的恢复入口已接线；学习树导出流程、卡片详情弹窗和错题列表纯 support 已拆到独立 owner，保留既有鉴权、CAS、错误恢复与焦点语义。

本轮治理没有改变业务 API 写语义、数据模型、migration、认证/会话、AI provider 与隐私边界、附件安全、canonical 路由语义或生产配置；本地实现不等于 Release，也不等于 production apply。

### 历史响应式浏览器证据（不计入 G6）

以下 `responsive-r6` 记录绑定响应式 R1-R6 完成时的旧 checkout，仅保留历史审查上下文；前端共享能力治理完成后必须重新刷新测试池，不能沿用这些截图或 fingerprint 作为 G6 证据。当时的任务专属测试池为：

- slot `1`，container `areaforge-dev-test-1`
- URL `http://127.0.0.1:43171`
- source commit `0efea44da6602072ac274fad93e67c116bc65c87`
- source fingerprint `sha256:c943c3099031d83f8d7c6defc6b61fc6d30a999bec6a77b626cbe04afa23ffe2`

Playwright 会话 `responsive-r6` 复核了 `/focus`、`/today`、`/knowledge`、`/test`、`/roadmap/allocation`、`/roadmap/reviews`、`/settings` 和 `/confirmations`，视口覆盖 `320`、`390`、`768`、`820`、`1024`、`1280`、`1440px`。每档均检查页面根 `scrollWidth <= clientWidth`；另在 `125%` 文本缩放下复核 `/focus`、`/today`、`/knowledge`、`/roadmap/allocation` 和 `/settings`。结果包括：移动/平板导航换型、抽屉 Escape 与焦点回收、状态 Modal、确认中心最小化/恢复/关闭、知识二级导航和日期带滚动、Dock 恢复、深链返回以及根页面无横向溢出均通过。

Window 从 Dock 恢复后关闭时，原触发器可能已经卸载；本轮为底部状态栏增加持久 `data-window-focus-fallback` 锚点，并让 Window/Dock 在原目标失效时回焦该工作区。Playwright 在 `390x844` 移动端底部面板路径和 `1440x900` 桌面直接 Dock 路径分别完成“恢复确认中心 -> 关闭”，两次 `document.activeElement` 均为仍连接的“后台窗口”回焦锚点。

追加全量路由审计：49 条 canonical 页面（含 `/`、`/login`）在 `320`、`768`、`1024`、`1440px` 共完成 196 个页面/视口组合检查；每项检查 HTTP 状态、最终路径、主内容可见性、页面错误、根横向溢出和特殊深链转场。冻结报告早期紧凑快照曾暴露服务端字段兼容缺口，已改为只读兼容回放并在同一测试池重新验证；确认中心深链打开公共窗口、资料外链预览回详情均符合契约。快速复习在测试账号存在普通专注活动时按活动互斥契约转到 `/focus`，该转场在四档视口均无错误或溢出。

截图证据：

- `output/playwright/r6-focus-320.png`、`output/playwright/r6-focus-1024.png`
- `output/playwright/r6-today-320.png`、`output/playwright/r6-today-768.png`、`output/playwright/r6-today-1440.png`
- `output/playwright/r6-knowledge-320.png`、`output/playwright/r6-knowledge-1024.png`、`output/playwright/r6-knowledge-1440.png`
- `output/playwright/r6-allocation-320.png`、`output/playwright/r6-allocation-1024.png`、`output/playwright/r6-allocation-1440.png`
- `output/playwright/r6-settings-320.png`、`output/playwright/r6-settings-1024.png`、`output/playwright/r6-settings-1440.png`

这些截图和矩阵只属于其 source fingerprint 对应 checkout 的历史浏览器审查证据。没有运行会写入隔离账号/数据库的 v1.1 结构化体验证据 runner，因此没有把这些截图冒充正式 `product-experience-review` current-bound 记录；`AF-RISK-UX-001` 台账未在本任务中改写。正式 UX review 记录留给 Release/维护窗口收口时按其独立证据契约重新采集。

### 历史 R6 门禁结果（2026-08-20）

- `pnpm check` 通过：包含架构、canonical 路由自测、全 workspace typecheck、测试、lint、`db:validate` 和生产构建。
- `pnpm docs:readiness`、`pnpm docs:links`、`pnpm docs:evergreen`、`pnpm docs:completion`、`pnpm risk:preflight`、`pnpm tasks:doctor` 和 `git diff --check` 全部通过。
- `pnpm dev:test:latest -- --json` 仍指向本轮更新的 slot 1：`areaforge-dev-test-1` / `http://127.0.0.1:43171`，commit `0efea44da6602072ac274fad93e67c116bc65c87`，fingerprint `sha256:c943c3099031d83f8d7c6defc6b61fc6d30a999bec6a77b626cbe04afa23ffe2`。
- 在该 latest URL 上用 `320/768/1024/1440px` 重跑快速复习活动互斥和冻结报告历史回放：前者四档均到 `/focus?returnTo=%2Ftoday`，后者四档均保留 `/roadmap/reviews/history/test-report-decision?period=week` 并显示早期快照提示；所有组合均无根横向溢出、5xx、console/page error 或非预取请求失败。Next.js 导航期间被取消的 `_rsc` 预取请求按正常浏览器行为排除。

上述只证明当时响应式 R1-R6 的 local-verified 结果，不覆盖当前前端共享能力治理源指纹。任务仍等待 G6 新鲜浏览器证据、包含本轮 UI 改动的新 GitHub Release 和独立 production apply 确认；这些阶段不会由本地前端改动自动完成。

### G6 前既有测试池只读核验（2026-08-22）

- 收尾查询返回 slot `1`、`areaforge-dev-test-1`、`http://127.0.0.1:43171`，状态为 `running`。
- 当前实例标识为 commit `45901f7743996a7b0243807d2e878abd10415ebc`，source fingerprint `sha256:13e85690893733edcd0bc2ea9734d1a7b3bd4aba97d5a92da01b7a466b46f961`，build id `sha256:ca03ecff22a58cbf877efdd16e89518f69625dcfce9094223a1ac79a738ab9d1`。
- 这是刷新前的只读 latest/doctor 结果，只能说明既有实例可见；它不是由当前治理 checkout 刷新的任务实例，也不能作为 G6 新鲜浏览器证据。上面的 `responsive-r6` 截图继续按其原始日期和 fingerprint 作为历史记录保存。

### G6 当前证据（2026-08-25）

- 刷新后测试池：slot `1`，container `areaforge-dev-test-1`，URL `http://127.0.0.1:43171`，状态 `running`，generation `1787607029555`，commit `45901f7743996a7b0243807d2e878abd10415ebc`，source fingerprint `sha256:b53bc2e47bf305687ecfd9c53025e2d9599f5ac67360babb3a863edfe623fcb3`，build id `sha256:b3fdb3efc67e1b953d6d56aaae2567eb01f18cc3c210fcc952952b53e5dbd172`。
- Responsive artifact：`output/playwright/responsive-g8-final-2026-08-24T21-37-00Z/responsive-layout-browser-matrix.json`；49 routes × 7 viewports = 343/343，root overflow 0，console/page/request/error response 0，125% zoom 5/5；独立 validator 通过。
- Governance artifact：`output/playwright/governance-g8-final2-2026-08-24T21-37-00Z/web-governance-browser-interactions.json`；7/7 场景通过，0 console/page/request error，预期 409 为 1；独立 validator 通过。
- 独立验证：两个 artifact 均通过 `g8-browser-evidence-validate`；pair 通过 `g8-browser-evidence-pair-validate`（responsive 8 screenshots，governance 7 screenshots）。
- 以上仅证明当前 checkout 的本地 production-build 浏览器与共享能力治理，不等于 GitHub Release、production apply 或生产 UX。
- `slot` / `container` / `port` / `url`：`pnpm dev:test:latest -- --json` 的机器返回值。
- `sourceGitCommit` / `sourceFingerprint` / `buildId`：刷新实例与当前 checkout 的身份绑定。
- `routes` / `viewports` / `zoom`：本轮实际浏览器矩阵；至少覆盖主要工作台、`320/390/768/820/1024/1280/1440px` 与 `125%`。
- `rootOverflow` / `focusRecovery` / `draftRecovery` / `conflictRecovery`：页面根溢出、键盘回焦、本机草稿和 `409` 输入保留结果。
- `consoleErrors` / `pageErrors` / `failedRequests`：排除正常取消的预取请求后必须为零，或逐项记录归因。
- `screenshotsOrRunId`：本轮新生成的截图路径或 Playwright 会话标识；不得引用旧 `r6-*` 截图替代。
- `result` / `doesNotProve`：只在上述字段完整后填写 `PASS`；仍明确不证明 GitHub Release、production apply、生产健康或 residual 关闭。

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
