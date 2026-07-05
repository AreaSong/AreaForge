# Docker Compose 部署

第一版部署目标：

- `web`：Next.js standalone 应用。
- `postgres`：PostgreSQL 16。
- `uploads`：附件持久化目录。

部署原则：

- PostgreSQL 不暴露公网端口。
- 上传目录不由 Nginx 直接暴露。
- 正式发布使用固定版本 tag，不直接依赖 `latest`。
- 发布前备份数据库和上传目录。
- migration 由部署流程执行，不提供网页按钮。

