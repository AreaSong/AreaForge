# AreaForge GitHub Release Updater

This directory contains the server-side updater for GitHub Release driven
updates. It is intentionally outside the web runtime: the AreaForge UI must not
execute deployment, backup, restore, Docker, or migration commands.

Current remote production state:

- Public URL: `https://forge.areasong.top/`
- Current app version: `0.1.9`
- Verified production release: `v0.1.9` at commit `749692ba719d801f14186a94af97b96350380141`
- Web image digest: `ghcr.io/areasong/areaforge-web:v0.1.9@sha256:2d91436a4c54a77365676265172ccd88242b05377666e40328f1390c3d747b4d`
- Migration image digest: `ghcr.io/areasong/areaforge-migration:v0.1.9@sha256:cb9c3ecfe8cb2d1ccad7eb63c439ea872f6c53f81416a6cc17f4794a15ff06ab`
- Update record: `/opt/areaforge/backups/github-release-updates/github-0.1.9-20260721050738/update-record.txt`
- Protected historical rollback: `v0.1.7` at Web digest `sha256:3a54995ca3776456c197e60f4a179ea0e6e30cf763ccb6ea372c5cbf555d48fd`
- Signature policy: `AREAFORGE_REQUIRE_SIGNATURE=true`
- Auto-apply policy: `AREAFORGE_AUTO_APPLY=none`

The detailed release evidence is tracked in
`docs/development/release-v0.1.9-record.md`. The `v0.1.7` record is retained as
protected historical rollback evidence, and the earlier `v0.1.5` evidence
remains in `docs/development/package-e-remote-github-release-record.md`.
The repository checkout is an unreleased `1.1.0` release candidate; it does not
mean that a `v1.1.0` Release or production apply exists.

Repository releases now run the `.github/workflows/release.yml` validate job
before any image build/push. Stable releases fail closed if cosign signing key
secrets are missing; unsigned placeholder assets are only allowed for preview
channel experiments and are not production trust evidence. New releases also
publish `areaforge-sbom.spdx.json` and `areaforge-provenance.json`; the updater
downloads both assets, verifies their `SHA256SUMS` entries, and stores them with
the update record. The current `v0.1.9` production release includes those
assets. `AF-RISK-SC-001` is `closed-evidence` for that release after strict
validation and explicit residual-ledger review; a new Release or signing-policy
change requires fresh evidence and may reopen it.

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
  apply --yes --tag v0.1.9 --config /etc/areaforge/updater.env
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
AREAFORGE_READINESS_EXPECTED_VERSION=0.1.9 \
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
AREAFORGE_SMOKE_EXPECTED_VERSION=0.1.9
AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none
```

Do not put the smoke password directly in Git or release records. The helper
may read `AREAFORGE_SMOKE_PASSWORD_FILE` only to submit the smoke login request;
stdout, update records, support summaries, and committed evidence must not
contain the password value.

The Web version center may submit controlled check/apply/rollback/policy
requests into the ops-state directory. The server-side update agent consumes
those requests and invokes this updater; the Web runtime still does not execute
server commands directly.

When a production version change, stale evidence, or validation failure requires
a fresh OPS-001 review, a root operator can export redacted evidence without
running updater apply, migrations, backups, restores, rollbacks, or production
writes. The existing `v0.1.9` closeout should not be recollected without such a
trigger:

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-evidence-export.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-$(date -u +%Y%m%d%H%M%S)
```

Before running the helper, make sure the host or controlled release workdir can
run the repository `pnpm` scripts, and that updater config includes
`AREAFORGE_EXTRA_SMOKE_COMMAND`, `AREAFORGE_SMOKE_BASE_URL`,
`AREAFORGE_SMOKE_EMAIL`, a restricted `AREAFORGE_SMOKE_PASSWORD_FILE`, expected
version, and `AREAFORGE_SMOKE_EXPECTED_AUTO_APPLY=none`. Missing runtime or
smoke credentials is an OPS-001 blocker, not a reason to fall back to admin
credentials or write smoke.

When the host cannot run Node.js/pnpm, use the curl fallback helper to export
only redacted inputs for local record generation:

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-ops001-readonly-fallback.sh \
  --config /etc/areaforge/updater.env \
  --state-dir /opt/areaforge/ops-state \
  --output-dir /tmp/areaforge-ops001-fallback-$(date -u +%Y%m%d%H%M%S)
```

The fallback helper writes `redacted-update-status.json`,
`remote-prerequisites.json`, optional `prod-readonly-smoke-output.log`, and
`remote-summary.txt`. It does not create the final OPS-001 closure packet and
does not close the residual ledger. After copying the redacted directory back
locally, prefer:

```bash
AREAFORGE_READINESS_RELEASE_MANIFEST_FILE=/path/to/areaforge-release-manifest.json \
pnpm ops:ops-001:fallback:finalize /path/to/areaforge-ops001-fallback-<timestamp> /tmp/areaforge-ops001-local-$(date -u +%Y%m%d%H%M%S)
```

When generating a local smoke record manually from fallback output, set
`AREAFORGE_PROD_READONLY_SMOKE_COMMAND=ops/update-agent/areaforge-ops001-readonly-fallback.sh`
so the record labels the evidence source accurately. Also set
`AREAFORGE_UPDATE_RECORD_SUMMARY` to a redacted update record or redacted
update-agent status `sha256:<64 hex>` summary before generating the local
smoke record; the OPS-001 closure packet validator requires that hash summary
and it must not include secrets.

For interactive SSH or tmux runs, complete `sudo -v` in the TTY first, then run
the helper once. Use an output directory under
`/tmp/areaforge-ops001-fallback-*`; the helper hands that redacted directory
back to the sudo-invoking user and records `redactedHandoffStatus` in
`remote-summary.txt`. Copy the directory with `scp -r` only when the handoff
status is `granted`; if it is `skipped-*` or `failed`, fix the output directory
or rerun through the interactive TTY instead of chaining extra `sudo tar/chown`
commands.

When the confirmed scope forbids reading the smoke password file, use the
no-secret release evidence exporter instead:

```bash
sudo /opt/areaforge/ops/update-agent/areaforge-release-evidence-redacted-export.sh \
  --update-record /opt/areaforge/backups/github-release-updates/github-0.1.9-20260721050738/update-record.txt \
  --status /opt/areaforge/ops-state/status.json \
  --output-dir /tmp/areaforge-release-evidence-redacted-$(date -u +%Y%m%d%H%M%S)
```

This exporter does not source updater.env, read smoke password files, login, or
run smoke. It writes allowlisted update-record fields, redacted update status,
existing smoke PASS/FAIL output when available, and a summary hash. Output
directories must use `/tmp/areaforge-release-evidence-redacted-*`; root-only
backup/config/smoke log paths are written only as redacted placeholders. It can
support release-record backup hash completion and update-record summaries only
after:

```bash
pnpm release:evidence:redacted-export:validate /path/to/areaforge-release-evidence-redacted-<timestamp>
```

The validator checks backup hashes, redacted update status, bounded smoke output,
smoke `checkedAt >= update-record updatedAt`, summary safety facts, and
secret-like leaks. It prints hash fields and redacted path presence, not
root-only absolute paths. If the existing smoke log is missing, the helper can
write a placeholder for diagnosis but validation must fail for release evidence
completion. This path does not create an OPS-001 closure packet or prove
authenticated smoke freshness.

Only copy the generated redacted records and closure packet out of the server;
do not copy updater env files, smoke password files, production `.env`, database
dumps, attachment content, or raw sensitive logs.
