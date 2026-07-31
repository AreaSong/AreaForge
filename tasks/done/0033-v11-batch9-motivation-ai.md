# v1.1 Batch 9 动机、通知与四类 AI 草稿

```yaml
status: done
phase: complete
blockers: []
risk: high
ownerSkill: areaforge-ai-governance
validation:
  - pnpm check
  - pnpm risk:preflight
  - pnpm smoke:local-ux:selftest
residualRiskIds: []
releaseRequired: false
```

## 目标

动机内容库、克制提醒、浏览器前台通知与四类显式 AI 草稿；配置 `AI_PAYLOAD_BINDING_SECRET` 且禁止进入客户端。

## 完成摘要

- 四类 AI 草稿用途确认包已确认（2026-07-21）。
- `AI_PAYLOAD_BINDING_SECRET` 进入 `.env.example` / `packages/config`；purpose-separated HMAC + 30 分钟 opaque preview token；客户端禁泄漏扫描。
- 动机内容库 `/api/motivation/items/**`、`POST /api/motivation/next`、`POST /api/motivation/reminder-state`。
- 通知 `GET|PATCH /api/notification-preferences`、`POST /api/notifications/test`。
- 四类 `POST /api/ai/drafts/{learning-tree|knowledge-card|plan|motivation}`（preview|generate + `AiDraftOperation` CAS）。
- 开放 `/settings/profile|notifications|ai`（experience/system 薄壳）；Shell「我学不下去了」接内容库；`/motivation` → `/settings/profile`；`/stage` 仍隐藏。
- **未**生产 migration deploy；**未**关闭 residual。

## 验证收口（本会话）

| 命令 | 结果 |
|---|---|
| `pnpm check` | PASS |
| `pnpm risk:preflight` | Batch 9 五项 PASS；仓库另有既有 Package D4 / E restore / B3 Recovery 文案缺口 FAIL（非本批引入） |
| `pnpm --filter @areaforge/core test` | PASS |
| `pnpm --filter @areaforge/auth test` | PASS |
| `pnpm --filter @areaforge/ai test` | PASS |
| `pnpm smoke:local-ux:selftest` | PASS |

硬条件：

1. AI 仅鉴权 POST；选中文本 + 预览勾选投影；不存 prompt/raw；不自动写业务对象。
2. `AI_PAYLOAD_BINDING_SECRET` 仅服务端。
3. 不跑生产 migration/apply/updater；不自动关闭 residual。
