# AreaForge 工程结构方案

## 1. 调研结论

本方案参考了 AreaFlow 与 AreaMatrix 的项目结构，但不直接照搬。

AreaFlow 的特点：

- 后端、数据库迁移、Web Dashboard、Desktop Shell、治理文档和 workflow 分层明确。
- `docs/product`、`docs/architecture`、`docs/adr` 作为源事实。
- PostgreSQL 是主状态源事实，文件主要用于配置、artifact 和审计导出。
- 通过 Docker Compose 管理 PostgreSQL，部署边界清晰。

AreaMatrix 的特点：

- `apps/` 承载多端入口，如 macOS、iOS、Windows、Linux。
- `core/` 承载平台无关核心能力。
- `docs/` 承载产品、架构、模块、API、UX、开发规范。
- `workflow/`、`tasks/`、`.ai-governance/` 用于长期治理、版本规划和任务追踪。
- 高风险边界、安全不变量和验证要求写得很清楚。

AreaForge 的适配方向：

- 第一版是私有 Web 应用，但目录结构要为后续 PWA、桌面端、移动端留下空间。
- 业务规则不要堆在页面里，要抽到共享核心包。
- API 路由保持薄层，真正逻辑放到 service/domain 层。
- AI、文件上传、数据库访问、安全策略必须可替换、可测试。

## 2. 推荐顶层结构

```text
AreaForge/
  AGENTS.md
  README.md
  package.json
  pnpm-workspace.yaml
  turbo.json
  docker-compose.yml
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
    prototypes/
```

## 3. 应用层设计

### 3.1 `apps/web`

第一版主应用，使用 Next.js。

职责：

- 页面与交互
- API Route / Server Action 入口
- 登录会话
- 文件上传入口
- 调用 packages 中的业务能力

建议结构：

```text
apps/web/
  app/
    (auth)/
    (dashboard)/
    api/
    layout.tsx
    page.tsx
  components/
  features/
    dashboard/
    tasks/
    timer/
    syllabus/
    notes/
    reviews/
    analytics/
    settings/
  lib/
    server/
    client/
  public/
  tests/
  next.config.ts
```

原则：

- 页面组件只负责展示和交互编排。
- API Route 只负责鉴权、参数校验、调用 service。
- 不在 React 组件里直接写数据库逻辑。
- 不在 API Route 里写复杂业务规则。

### 3.2 `apps/desktop`

第二阶段预留，优先考虑 Tauri。

职责：

- 提供桌面壳。
- 复用 Web UI 或调用同一套 API。
- 后续可支持本地提醒、托盘、快捷启动、离线缓存。

第一版只保留目录或文档，不实现。

### 3.3 `apps/mobile`

后续移动端预留。

推荐路线：

- 第一阶段：Web 响应式 + PWA。
- 第二阶段：如果需要更强拍照、提醒、离线能力，再考虑 Expo / React Native。

第一版不开发原生移动端。

## 4. 共享包设计

### 4.1 `packages/core`

平台无关业务核心。

职责：

- 阶段计划规则
- 任务债务规则
- 恢复模式规则
- 鞭策状态判断
- 知识点掌握状态计算
- 反假学习检查
- 周/月复盘指标计算

建议结构：

```text
packages/core/
  src/
    domain/
      task.ts
      timer.ts
      syllabus.ts
      mastery.ts
      review.ts
      exam.ts
      motivation.ts
    services/
      progress-service.ts
      debt-service.ts
      recovery-service.ts
      anti-fake-study-service.ts
      mastery-service.ts
    policies/
      risk-policy.ts
      theme-policy.ts
      discipline-policy.ts
    types/
    index.ts
  tests/
```

原则：

- 不依赖 Next.js。
- 不直接访问数据库。
- 输入数据，输出判断、计划、状态、建议。
- 方便未来 Web、桌面、移动端复用。

### 4.2 `packages/db`

数据库访问层。

职责：

- Prisma Client 初始化
- repository 封装
- 数据查询模型
- migration 约定

建议结构：

```text
packages/db/
  src/
    client.ts
    repositories/
      task-repository.ts
      timer-repository.ts
      syllabus-repository.ts
      note-repository.ts
      review-repository.ts
      audit-repository.ts
    read-models/
    transactions/
    index.ts
```

原则：

- 数据库访问集中管理。
- 复杂查询沉到 repository。
- 业务层不直接到处调用 Prisma。

### 4.3 `packages/ai`

AI 适配层。

职责：

- Sub2API / OpenAI 兼容调用
- 提示词模板
- AI 输出结构校验
- 失败回退
- 调用日志与脱敏

建议结构：

```text
packages/ai/
  src/
    client.ts
    prompts/
      discipline.ts
      daily-review.ts
      tomorrow-plan.ts
    schemas/
    safety/
    fallback.ts
    index.ts
```

原则：

- AI 只生成建议，不直接改用户数据。
- 所有 AI 输出必须做结构校验。
- 失败时回退到本地规则文案。
- 不把敏感动机内容默认发送给 AI，除非用户明确允许。

### 4.4 `packages/auth`

认证与会话。

第一版建议：

- 单管理员账号密码。
- 密码使用哈希存储。
- 会话密钥从环境变量读取。

后续可扩展：

- GitHub OAuth
- 邮箱验证码
- 多用户角色

### 4.5 `packages/storage`

文件与附件存储。

职责：

- 图片、PDF、拍照笔记上传
- 文件类型校验
- 文件大小限制
- hash 去重
- 访问权限检查
- 本地磁盘或对象存储适配

第一版建议：

- 服务器本地持久化目录。
- 数据库存 metadata、hash、URI、关联对象。
- 文件本体不直接塞进数据库。

### 4.6 `packages/ui`

共享 UI 组件。

职责：

- Area 系列通用组件
- AreaForge 专属组件
- 图表、进度条、状态标记、计时器组件

原则：

- 与业务数据解耦。
- 多端可复用时再抽象，不提前过度复杂化。

### 4.7 `packages/config`

统一配置读取和校验。

职责：

- 环境变量 schema
- 运行时配置
- feature flags

必须校验：

- `DATABASE_URL`
- `APP_URL`
- `NEXTAUTH_SECRET`
- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`
- `UPLOAD_DIR`

## 5. 文档结构

建议延续 AreaFlow / AreaMatrix 的文档分层。

```text
docs/
  product/
    charter.md
    prd.md
    roadmap.md
    feature-scope.md
  architecture/
    overview.md
    data-model.md
    api-surface.md
    auth-security.md
    ai-boundary.md
    file-storage.md
    deployment.md
  modules/
    dashboard.md
    timer.md
    task-debt.md
    syllabus-map.md
    notes.md
    review.md
    simulation-exam.md
  ux/
    dashboard-states.md
    focus-timer.md
    recovery-mode.md
    dynamic-theme.md
  adr/
    0001-tech-stack.md
    0002-private-web-first.md
    0003-postgresql-primary-state.md
    0004-ai-adapter-boundary.md
  development/
    setup.md
    testing.md
    coding-standards.md
  deployment/
    docker-compose.md
    nginx.md
    release.md
    backup-restore.md
  security/
    threat-model.md
    secrets.md
    upload-policy.md
    privacy.md
```

## 6. 数据与安全边界

关键原则：

- PostgreSQL 是主状态源事实。
- 上传文件存储在持久化目录，数据库只保存 metadata。
- AI 调用必须可关闭、可替换、可审计。
- 动机档案、情绪记录、复盘内容属于高敏感数据。
- 默认不把动机档案发送给 AI。
- 文件上传必须限制类型、大小和访问权限。
- 所有写操作需要登录会话。
- 高风险操作需要二次确认，如删除附件、清空记录、执行数据库迁移、触发部署更新。

必须具备：

- 数据库自动备份。
- 上传文件备份。
- 发布回滚方案。
- 审计日志基础版。
- `.env` 不进入 Git。
- GitHub Actions Secret 最小化。

## 7. 部署结构

第一版推荐：

```text
docker-compose.yml

services:
  web:
    image: ghcr.io/<owner>/areaforge:<version>
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - areaforge-uploads:/app/uploads

  postgres:
    image: postgres:16-alpine
    volumes:
      - areaforge-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U areaforge -d areaforge"]

volumes:
  areaforge-postgres-data:
  areaforge-uploads:
```

Nginx 负责：

- `forge.areasong.top` 反向代理到 web 容器。
- HTTPS 证书。
- 上传大小限制。
- 基础安全响应头。

## 8. 自动发布建议

推荐策略：

- `main` 分支用于合并稳定代码。
- GitHub Release 触发正式部署。
- Release tag 写入 `APP_VERSION`。
- GitHub Actions 构建 Docker 镜像并推送到 GHCR。
- 服务器执行 `docker compose pull && docker compose up -d`。
- 应用启动或部署脚本执行 Prisma migration。

第一版不建议网页内一键更新。

原因：

- 涉及服务器命令执行权限。
- 涉及部署密钥和操作审计。
- 应等基础部署稳定后再做。

## 9. 测试与验证

第一版最低验证门槛：

- TypeScript 类型检查。
- ESLint。
- 单元测试。
- Prisma migration 检查。
- Next.js build。
- Playwright 基础页面烟测。
- Docker Compose 启动检查。

重点测试模块：

- 任务债务计算。
- 恢复模式触发。
- 鞭策状态判断。
- 知识点掌握证明。
- 反假学习检查。
- AI 回退逻辑。
- 文件上传限制。
- 登录鉴权。

## 10. 开发顺序建议

1. 建立 monorepo 基础结构。
2. 建立 Next.js Web 应用。
3. 接入 PostgreSQL + Prisma。
4. 建立登录和会话。
5. 建立核心数据模型。
6. 实现今日作战台。
7. 实现任务、计时、打卡闭环。
8. 实现考纲进度树和笔记附件。
9. 实现鞭策规则和 AI 接口。
10. 实现基础统计、恢复模式、任务债务。
11. 补 Docker Compose 和 Nginx 部署文档。
12. 建立 GitHub Release 自动部署。

