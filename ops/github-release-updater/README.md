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

Repository releases now run the `.github/workflows/release.yml` validate job
before any image build/push. Stable releases fail closed if cosign signing key
secrets are missing; unsigned placeholder assets are only allowed for preview
channel experiments and are not production trust evidence. New releases also
publish `areaforge-sbom.spdx.json` and `areaforge-provenance.json`; the updater
downloads both assets, verifies their `SHA256SUMS` entries, and stores them with
the update record. The current `v0.1.5` production release predates these two
assets, so `AF-RISK-SC-001` stays open until the next signed release records
that evidence.

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

Production currently stays on `AREAFORGE_AUTO_APPLY=none`. Changing it to
`patch` or any stronger auto-apply policy requires an explicit policy change,
fresh signed-release evidence, backup readiness, rollback evidence, and smoke
coverage.

Long-term operations readiness and residual risk IDs are tracked in
`docs/development/operational-readiness.md` and
`docs/development/residual-risk-ledger.md`. Run the local read-only gate with:

```bash
pnpm ops:readiness
```

To generate a JSON readiness summary for a release record or operator handoff,
run:

```bash
AREAFORGE_READINESS_BASE_URL=https://forge.areasong.top \
AREAFORGE_READINESS_EXPECTED_VERSION=0.1.5 \
pnpm ops:readiness:summary
```

The summary command is read-only. It may call `/api/health`, optionally log in
with a smoke account to read `/api/system/update-status`, and optionally read a
redacted status or smoke output file. It must not execute Docker, backup,
restore, migration, rollback, shell, or server commands.

Read-only extra smoke can be wired through `AREAFORGE_EXTRA_SMOKE_COMMAND`.
The repo-provided command logs in with a smoke account, checks core read-only
APIs, checks update status, and optionally downloads one known attachment:

```bash
AREAFORGE_EXTRA_SMOKE_COMMAND='cd /opt/areaforge && pnpm smoke:prod-readonly'
AREAFORGE_SMOKE_BASE_URL=https://forge.areasong.top
AREAFORGE_SMOKE_EMAIL=admin@example.com
AREAFORGE_SMOKE_PASSWORD_FILE=/etc/areaforge/smoke-password
AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.5
AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none
```

Do not put the smoke password directly in Git or release records.

The Web version center may submit controlled check/apply/rollback/policy
requests into the ops-state directory. The server-side update agent consumes
those requests and invokes this updater; the Web runtime still does not execute
server commands directly.
