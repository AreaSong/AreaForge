# AreaForge GitHub Release Updater

This directory contains the server-side updater for GitHub Release driven
updates. It is intentionally outside the web runtime: the AreaForge UI must not
execute deployment, backup, restore, Docker, or migration commands.

The updater supports three modes:

- `check`: verify the latest release manifest and report whether an update is available.
- `run`: check and apply only when `AREAFORGE_AUTO_APPLY` allows the version class.
- `apply --yes`: explicitly apply a release tag or the latest release.

Typical manual update:

```bash
sudo /opt/areaforge/ops/github-release-updater/areaforge-updater.sh \
  apply --yes --tag v1.0.3 --config /etc/areaforge/updater.env
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
