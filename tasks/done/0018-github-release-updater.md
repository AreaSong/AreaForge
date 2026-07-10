# GitHub Release 自动更新器

## 目标

完成 AreaForge 的 GitHub Release 驱动服务器侧自动更新器，让远端单机部署可以通过 Release manifest、镜像 digest、备份、migration、烟测和回滚完成受控更新。

## 范围

- 包含：
  - GitHub Release manifest 规范。
  - GHCR Web image 与 migration image 发布 workflow。
  - 服务器侧 `areaforge-updater.sh`。
  - systemd service/timer 示例。
  - GitHub Actions CI 和 Release workflow。
  - 更新前数据库、上传 volume、env、compose、Nginx 备份。
  - 一次性 migration image。
  - health smoke、可选 extra smoke、失败应用镜像回滚。
  - 只读 preflight 门禁。
- 不包含：
  - 网页内一键更新。
  - Web API 执行服务器命令。
  - 静默 major 更新。
  - 默认数据库恢复或上传目录移动。
  - 跳过 hash/签名校验的生产自动更新。

## 参考源事实

- `docs/development/github-release-updater-design.md`
- `docs/deployment/github-release-updater.md`
- `docs/development/production-release-runbook.md`
- `docs/security/file-ai-safety.md`

## 验收标准

- GitHub Release workflow 能定义 Web image、migration image、manifest、`SHA256SUMS` 和 `SHA256SUMS.sig` 产物。
- updater 能 `check`、`run`、`apply --yes`，并支持 `AREAFORGE_AUTO_APPLY=none|patch|minor|all`。
- updater 校验 Release、manifest、hash、签名、channel、版本和镜像 digest。
- updater 更新前先备份数据库、上传 volume、env、compose、Nginx 和 release assets。
- migration 只通过一次性 migration image 执行，日志不泄露数据库 URL。
- 失败时默认只回滚应用镜像和 `APP_VERSION`，不自动覆盖生产数据库。
- Web runtime 无 updater、Docker、备份、恢复或 migration 命令入口。

## 验证

- `pnpm github-release-updater:preflight`
- `pnpm shellcheck:updater`
- `pnpm check`
- `git diff --check`

## 风险

- 真实远端 GitHub Release、GHCR 权限、签名密钥和 systemd timer 仍需在服务器环境中验证。
- 未配置签名密钥时 workflow 会生成占位 `SHA256SUMS.sig`；生产若保持 `AREAFORGE_REQUIRE_SIGNATURE=true`，updater 会拒绝应用，这是预期的安全失败。
- 完整登录、任务计时、附件等烟测依赖生产专用 `AREAFORGE_EXTRA_SMOKE_COMMAND`。
