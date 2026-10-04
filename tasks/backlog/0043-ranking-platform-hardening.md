# 0043 v1.8 成长指标、私有挑战与排名

```yaml
status: backlog
phase: local-verified
blockers:
  - Full v1.8 lifecycle and cross-domain acceptance remain beyond persistent rebuild scope
  - Protected merge, signed Release and shared/production delivery evidence remain
  - Release, production rollout and residual closure require independent confirmation
risk: high
ownerSkill: areaforge-product-experience
validation:
  - pnpm check
  - pnpm worker:rankings:typecheck
  - pnpm worker:rankings:isolation:selftest
  - pnpm risk:preflight
  - pnpm dev:test:latest -- --json
residualRiskIds:
  - AF-RISK-DATA-003
releaseRequired: true
```

## 目标

先实现可解释的个人成长指数，再实现私有挑战完整 CRUD、参与者管理、所有权转移、主动加入、可重建排名、反作弊和退出/删除联动。

## 隐私与产品边界

- 动机、情绪正文、完整复盘、笔记/错题内容、附件、AI prompt 和私有任务标题不进入排名。
- 排名默认关闭且必须 opt-in；v1.8 不开放全站公开榜。
- 排名是可重建投影，不修改学习源事实，不阻断个人学习闭环。

## 持久重建（2026-09-15 本地已验证）

- 维护者在精确包已展示后明确回复“可以，继续完成”；本地实现、限定合成验证及验收后提交推送已确认。范围见 [高风险确认包](../../docs/development/high-risk-confirmation-packets.md) 的「RANKING 持久重建本地实施确认包（本地已确认）」；正式发布与生产仍独立确认。
- 基线 `149de93`；复用现有 DataJob/RankingProjection 和全部 53 条 migration，未新增 DDL。`ranking-rebuild-job-v1` 绑定请求者、会话入队权限、挑战/规则、权限历史、数据截止时间、来源日期/xmin 与删除可见性修订；同键异内容、旧代次和撤销后重入均不能复活旧任务。
- Owner 显式请求经 202 回执进入独立 worker；准备与提交均重验，整榜与任务成功在同一 Serializable 事务提交。删除共享栅栏先于 scope/任务锁，有界锁等待与失败退避，不放宽 15 秒提交预算；只读投影使用共享挑战锁，不能证明当前有效时返回 stale 与空 entries，不显示半榜或过期计数。
- Web 显示最新任务、当前排名和折叠历史，支持真实进度、暂停确认、恢复、取消与重试；残缺/丢失 202 保留同一幂等请求，乱序刷新、身份/挑战版本变化及权限失效不保留旧结果。HTTP 不再同步重算；六个既有/新增开关均须精确开启，新 `RANKING_REBUILD_QUEUE_ENABLED=false` 默认关闭。
- 不改 `private-challenge-v1` 计分、字段授权或 opt-in 默认值，不回写学习源事实，不增加定时重建。100 个有效参与者、10,000 条 session、20,000 条相关冻结记录超限即拒绝，禁止截断发布；全局删除可见性修订可让无关榜单保守失效，需 Owner 重新请求，不影响个人学习主链。

### 本批本地证据与交付边界

- 新建 RANKING 专用 loopback 合成库已 deploy/repeat deploy 全部 53 条 migration，并核对名称、顺序、完成状态和 SQL checksum；schema 与 migration 源码均未变化。未使用共享/EXPORT/DELETE/OPS 库或真实附件、备份。
- `pnpm worker:rankings:runtime:selftest <private-fixture-root>`：26 组通过，涵盖原子整榜/只读源事实、权限历史、同键并发/单次 claim、旧代次、暂停/取消/死信重放、运行中关开关、准备后来源变化、两处真实 SIGKILL、租约在事务中到期、删除栅栏/反向锁冲突、有界容量拒绝、空榜成功证明、排序，以及真实成员/账户权限和合成冻结/恢复/数据库删除联动。记录见 `output/ranking-rebuild/runtime-evidence.json`。
- `pnpm worker:rankings:browser:selftest <private-fixture-root>`：12 组真实浏览器/API 通过，含 Owner/Member/Viewer/跨 Workspace、残缺回执同请求重试、乱序刷新、状态控制、服务失败、挑战/所有权/会话变化、退出/冻结/恢复。桌面 `1440x1000`、`390x844`、`320x844` 无横向溢出，重建按钮不少于 44px，键盘刷新与历史折叠可用，page error 为 0；记录与三张排名面板截图见 `output/playwright/ranking-rebuild/`。
- 两份记录均绑定当前排名实现与验收器源码指纹。测试池只替换经所有权核验的槽 3，URL `http://127.0.0.1:43173`，产品指纹 `sha256:25e501e538ec49f33e4b59a9229546a81a858240a68c0fe35b4726b4af13a33c`；槽 1/2、旧 OPS 库/卷/私有目录和证据保留。本批库、卷与证据保留，不自动清理。
- 最终本地门禁：冻结安装、完整 `pnpm check`（类型/测试/lint/build）、worker/排名类型与隔离自测、七项 worker 注册/控制自测、测试池 selftest/typecheck/latest/doctor/选择 dry-run、DB validate、Package E、docs/readiness/links/evergreen/completion、tasks/residual/risk/governance/secrets 与 diff 检查均通过；全量/生产依赖审计均为 0 已知漏洞。宿主 Node 25，测试池镜像与 CI 基线 Node 24；本地结果不替代新 CI。
- 只读运维验证：readiness、status/handoff/bundle 默认校验及对应自测、只读副作用/长期 gate/快照、备份预览、支持包、OPS-001/004、smoke/告警与 residual 自测通过；实际 handoff/bundle 绑定 current。离线总状态仍 `blocked`，bundle 为 `needs_attention`，OPS-001/004 为 `needs_evidence`，不是服务故障或生产完成证明；未采集新生产数据。
- 本节仅声明持久重建 `local-verified`；完整 v1.8 生命周期/跨域旅程、受保护合并、新签名 Release、共享/生产迁移与生产运营证据仍待各自门禁，整体任务保留 `backlog`。Git/CI 结果按对应提交与 Actions 单独核对；不改版本号，不发布，不执行生产操作，不关闭 `AF-RISK-DATA-003`。

## 验收

- `scoreVersion`、时间窗口、时区、并列、异常、申诉和删除规则可解释、可重复计算。
- 挑战支持创建、查看、编辑规则、开始、结束、关闭、解散；支持邀请/加入/退出/移除、昵称、字段授权和所有权转移。
- 排名故障可整体关闭，任务、计时、复盘、报告和阶段计划保持正常。

## 历史实现基础（2026-09-06 及后续候选）

本节保留持久重建之前的基础验收范围；当前本地批准和重建证据以上节为准，历史“仍缺”不覆盖独立 EXPORT/DELETE/RANKING 后续验收。

- `packages/core/src/ranking-metrics.ts` 已提供 `calculatePersonalGrowthScore`（别名 `calculatePersonalGrowthIndex`）、`calculatePrivateChallengeScore` 和 `rankPrivateChallengeScores`，分别固定 `personal-growth-v1` / `private-challenge-v1` 的 `scoreVersion`。
- 计算只接受显式白名单字段：带时区的 session 时间戳、有效学习秒数和最低行动标记；窗口按用户 IANA 时区解释为 `[startDate, endDate)`，个人成长基线与当前窗口必须等长且不重叠。
- 纯规则会拒绝敏感或未知字段，去除重复 session，排除无效/超长/窗口外时长，并将单日有效时长限制为 16 小时；返回组件权重、基线/当前值、异常代码和解释文本，挑战排名使用稳定的竞赛并列名次。
- core 计算、反作弊分级与 appeal 状态机 policy 已完成并保持无副作用；不代表 RANKING 确认包已批准，也不改变 `status: backlog` 或前置阻塞项。
- 本地候选已补充排名 opt-in/字段授权、挑战 CRUD 与参与者状态、跨租户授权、可重建数据库投影和删除预览；候选 migration 只在一次性隔离 PostgreSQL fixture 中验证，未 apply 到共享测试库或生产。
- 本地候选已增加专用 `RankingAppeal`、唯一未决申诉、revision CAS、成员提交/撤回和 Owner 复核 UI；排名邀请、挑战/参与者状态、所有权转移及申诉事件会在 `PLATFORM_NOTIFICATIONS_ENABLED=true` 时以受控通用种类写入 `UserNotification`。通知按 recipient/eventKey 幂等，只保存 Workspace 标签和源标识，不保存挑战名称、申诉正文或学习正文，并进入用户导出预览。挑战、当前用户参与记录与本人提交的申诉也已进入 owner/actor-scoped 数据预览，`RankingProjection` 保持可重建排除。
- 当前候选的 schema/migration、投影、申诉、通知和 authenticated API 已通过 Core/Web、隔离 migration 回放及 v1.6-v1.8 runtime；隔离事务链已验证成员关闭 opt-in 后参与记录转为 `LEFT`、投影归零、成员账户删除预览转为 `READY`，而仍拥有未解散挑战的 Owner 删除预览保持 `BLOCKED`。通知 runtime 覆盖跨用户拒绝、读/未读/隐藏/恢复、事件幂等和导出联动。申诉与通知均完成 390×844 成员和 1440×900 Owner 真实旅程，通知另以第二浏览器会话验证跨设备状态，控制台 0 error 且无横向溢出。截图见 `output/playwright/ranking-appeal-member-mobile.png`、`output/playwright/ranking-appeal-owner-desktop.png`、`output/playwright/user-notifications-member-mobile.png`、`output/playwright/user-notifications-owner-desktop.png`。所有相关开关默认关闭，migration 未 apply 到共享测试库或生产；完整归档已由独立 EXPORT 本地包验收；仍缺真实物理删除、完整排名跨租户浏览器矩阵和 Release/生产证据。
