# v1.1.1 当前 checkout 专项验收记录

日期：2026-08-02
范围：当前 checkout 的隔离浏览器与隔离 PostgreSQL，仅用于补齐 Release 后工作树的专项验收证据。

## 边界

- Web：`http://127.0.0.1:3257`
- 隔离数据库：`areaforge_v11browser_current24`（PostgreSQL 16）
- 账号：合成验收账号；密码只从临时文件注入，不写入记录。
- 未停止或修改用户正在使用的 `http://127.0.0.1:3102`。
- 未执行真实 AI Provider key smoke、生产写入、migration、restore、rollback、updater apply、物理删除或完整账户导出。

## 本轮通过

| 专项 | 操作路径 | 预期 / 实际结果 | 证据 |
|---|---|---|---|
| 复习桥接完成 | `/today/tasks/cmsbbv037000001nt1znkot2s` | 选择通过、填写 300 秒和备注后确认；任务变为已完成，排期保留，ReviewEvent 生成；同一幂等键重放两次均 200 且 `reused=true` | `output/playwright/acceptance-review-bridge-complete-desktop.png` |
| 复习桥接延期 | `/today/tasks/cmsbc3h3x000501ntpmyrrkok` | 选择 2026-08-06 后延期；任务变为已延期，计划日期与排期同步 | `output/playwright/acceptance-review-bridge-defer-desktop.png` |
| 复习桥接放弃 | `/today/tasks/cmsbc5lzk000601nt801ar0u0` | 打开确认弹窗并确认放弃；任务变为已放弃，排期仍为 ACTIVE | `output/playwright/acceptance-review-bridge-abandon-desktop.png` |
| PlanInbox 依赖与 revision | `/today/inbox/cmsbaib8h0006c5rtr7ta479f` | 硬依赖可见；保存标题后 revision `1 -> 2`；制造服务端更新后，保存触发 `PLAN_INBOX_REVISION_CONFLICT`，本地草稿保留并出现合并对话框 | `output/playwright/acceptance-plan-inbox-conflict-desktop-final.png` |
| PlanInbox 转换 | `/today/inbox` 两条合成 Inbox | 两条 Inbox 均转换为正式任务；转换后的任务详情显示硬前置依赖，返回链接保留 `/today/inbox` | `output/playwright/acceptance-plan-inbox-converted-desktop-final.png` |
| PlanInbox 幂等重放 | `/api/plan-inbox/cmsbaib8h0006c5rtr7ta479f/convert` | 同一 `idempotencyKey` 重放返回 200，`convertedTaskId` 不变，未重复创建正式任务 | 同一隔离数据库审计事件与 API 响应 |
| 设置中心 | `/settings`、`/settings/exams`、`/settings/profile`、`/settings/learning`、`/settings/ai`、`/settings/data`、`/settings/system` | 七个入口均可达；设置二级导航完整；AI 浏览器开关保持关闭，系统页明确 Web 不执行 migration/deploy/updater apply | 当前 Playwright snapshots |
| 首次使用 | 无工作区合成账号 `/today -> /settings/exams?setup=1` | 无工作区时不展示伪造统计；两步创建考试工作区、首科目和 408 四科；完成后进入 `/today`；刷新后工作区仍存在；桌面与 `390x844` 移动布局均可见 | `output/playwright/acceptance-first-use-desktop-final.png`、`output/playwright/acceptance-first-use-mobile-final.png` |

## 仍未验收或不在本轮范围

| 项目 | 状态 | 原因 / 下一步 |
|---|---|---|
| 真实 AI Provider key smoke | 未执行 | 需要真实 Provider、费用与隐私边界的独立确认；本轮只验证默认关闭和本地 fallback |
| 生产写入型 smoke | 未执行 | `AF-RISK-OPS-002` 仍缺专用账号、清理策略和受控确认 |
| restore / rollback / production updater apply | 未执行 | 高风险操作，不因本地浏览器验收自动获得授权 |
| 物理删除、备份副本同步删除、完整账户导出 | 未执行 | `AF-RISK-DATA-001` 保持 deferred-work |
| 真实线上体验声明与新 Release admission | 未完成 | 当前证据绑定工作树和隔离 runtime，不等同于生产或新 Release 已接受 |

## 发现但尚未整改的产品与架构问题

这些是审计发现，不应被本记录的专项通过项覆盖：

- `FocusSessionPage` 仍直接导入 Prisma；`packages/db` 的边界门禁当前只禁止 deep import，未强制页面/组件不直连数据库。
- `apps/web/lib/study/service.ts`、`learning-tree-service.ts`、`syllabus-manager.tsx` 等文件远超仓库质量阈值，领域服务和客户端状态仍过度集中。
- 恢复模式的“5 分钟启动”与反假学习 `<25` 分钟判定冲突；专注收口仍有占位产出文本绕过真实产出检查的风险。
- 旧 `/reports`、`/simulation` 和部分旧工作台仍保留不可达实现；完整周期报告、债务重排和阶段 AI 建议的当前可见入口与文档存在收敛差异。
- 每日复盘稳定主导航、AI 每日复盘/明日计划建议的用户工作流、专注证据接力回执仍需产品闭环验收。
- 登录限流容量、可选 `actorId` 的 fail-open 查询、legacy 附件空归属授权、附件下载内存峰值、运行态测试未进入 CI、配置数值严格校验和 moderate 依赖 advisory 仍需质量/安全整改。

以上问题应单独进入产品体验、架构或安全任务；本记录不自动关闭 residual，也不替代后续 Release admission。
