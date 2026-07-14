# 工程结构

## 推荐结构

```text
AreaForge/
  AGENTS.md
  README.md
  package.json
  pnpm-workspace.yaml
  docker-compose.yml
  docker-compose.prod.yml
  .env.example
  .gitignore

  apps/
    web/
    desktop/
    mobile/

  packages/
    core/
    db/
    ai/
    auth/
    storage/
    ui/
    config/
    testkit/

  docs/
    product/
    architecture/
    adr/
    modules/
    ux/
    development/
    deployment/
    security/

  prisma/
    schema.prisma
    migrations/

  infra/
    docker/
    nginx/
    github-actions/

  scripts/
    dev/
    deploy/
    db/
    release/

  tasks/
    active/
    backlog/
    done/
    templates/

  workflow/
    versions/
    templates/
    references/

  assets/
    brand/
      final/
        app-icon/
        favicon/
        lockup/
        mark/
        social/
        stacked/
        symbol/
        wordmark/
    prototypes/
```

## 继承来源

参考 AreaFlow：

- PostgreSQL 作为主状态源事实。
- `docs/product`、`docs/architecture`、`docs/adr` 作为高层源事实。
- Docker Compose 管理基础服务。

参考 AreaMatrix：

- `apps/` 承载多端入口。
- `core` 思路承载平台无关能力。
- `docs/`、`workflow/`、`tasks/` 分离产品、版本和轻量任务。

## 源事实分层

- `docs/product/**`：产品定位、PRD、功能范围、路线图。
- `docs/architecture/**`：工程结构、数据模型、API 边界、部署架构。
- `docs/modules/**`：具体业务模块设计。
- `docs/ux/**`：页面状态、交互状态和动态主题。
- `docs/development/**`：开发顺序、准备清单和验证门禁。
- `docs/deployment/**`：部署、备份和恢复。
- `docs/security/**`：威胁模型和高风险边界。
- `docs/adr/**`：已确认的技术决策。
- `tasks/**`：轻量任务拆分，不替代产品和架构源事实。
- `workflow/**`：版本规划，不替代路线图。
- `assets/brand/brand-manifest.json`：品牌源文件、派生尺寸、Web runtime 副本与原生/印刷交付的机器可读矩阵。
- `assets/brand/final/**`：当前品牌素材包，包含数字 Logo、Web/PWA 图标、macOS/iOS/Android/Windows 原生图标、社交预览和 SVG/PDF/CMYK 印刷交付；当前 checkout 已接入 Web runtime，但不代表线上版本已发布更新。
- `scripts/brand/**`、`scripts/quality/brand-assets-validate.ts`：品牌导出、runtime 同步和完整性校验入口。

## 当前取舍

- 第一版只实现 `apps/web`。
- `apps/desktop` 和 `apps/mobile` 只做预留，不提前实现。
- 第一版只落核心共享包，不复制 AreaMatrix 的完整 task-loop、skills、residual ledger。
- 当前使用 pnpm workspace 脚本直接编排，不引入 Turbo；后续需要缓存或任务流水线时再通过 ADR 决策。
- 文档先少而准，不一次性制造大量空文档。
