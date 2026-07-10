# AreaForge GitHub Release Updater

This directory contains the server-side updater for GitHub Release driven
updates. It is intentionally outside the web runtime: the AreaForge UI must not
execute deployment, backup, restore, Docker, or migration commands.

Current remote production state:

- Public URL: `https://forge.areasong.top/`
- Current app version: `0.1.5`
- Verified release: `v0.1.5`
- Web image digest: `ghcr.io/areasong/areaforge-web:v0.1.5@sha256:613dc91e54eaf4d730dcac3aa48b2c92acb8ddfdb8d50c3227d50cd1456f5fa9`
- Migration image digest: `ghcr.io/areasong/areaforge-migration:v0.1.5@sha256:04aa20e92323c9f9b14c8bd096d8cfa9ea62d9baab23f94d4976d7882bfa2ae7`
- Signature policy: `AREAFORGE_REQUIRE_SIGNATURE=true`
- Auto-apply policy: `AREAFORGE_AUTO_APPLY=none`

The detailed release evidence is tracked in
`docs/development/package-e-remote-github-release-record.md`.

The updater supports three modes:

- `check`: verify the latest release manifest and report whether an update is available.
- `run`: check and apply only when `AREAFORGE_AUTO_APPLY` allows the version class.
- `apply --yes`: explicitly apply a release tag or the latest release.

Typical manual update:

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh \
  apply --yes --tag v1.0.3 --config /etc/areaforge/updater.env
```

The current remote release was applied with:

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh \
  apply --yes --tag v0.1.5 --config /etc/areaforge/updater.env
```

Typical timer setup:

```bash
sudo cp ops/github-release-updater/areaforge-updater.env.example /etc/areaforge/updater.env
sudo chmod 600 /etc/areaforge/updater.env
sudo cp ops/github-release-updater/areaforge-updater.service /etc/systemd/system/
sudo cp ops/github-release-updater/areaforge-updater.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now areaforge-updater.timer
```

Production default should start with `AREAFORGE_AUTO_APPLY=none`. After the
first successful manual update, use `patch` if patch versions may be applied
without an operator.

The Web version center may submit controlled check/apply/rollback/policy
requests into the ops-state directory. The server-side update agent consumes
those requests and invokes this updater; the Web runtime still does not execute
server commands directly.
