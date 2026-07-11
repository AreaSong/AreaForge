# OPS-001 Production Readonly Evidence Attempt 2026-07-11

## Summary

This record captures the 2026-07-11 `AF-RISK-OPS-001` production read-only evidence attempt for `https://forge.areasong.top`.

Result: `BLOCKED`.

The attempts produced valid redacted update-agent status records, but they did not produce a production read-only smoke record, operational evidence bundle, or OPS-001 closure packet. `AF-RISK-OPS-001` remains open and is a current blocker for claiming long-term operability.

## Evidence

```text
productionHost: LosAngeles
productionBaseUrl: https://forge.areasong.top
releaseTag: v0.1.5
remoteBlockerDir: /tmp/areaforge-ops001-blocked-20260711083435
localEvidenceDir: /tmp/areaforge-ops001-blocked-20260711083435
redactedUpdateStatusHash: sha256:82e94e332b015089061c7944984fff9857b92e1833d4bfef8d8ddf791f5b6a09
blockedRecord: docs/development/ops-001-blocked-record-20260711.txt
```

Second fallback attempt:

```text
productionHost: LosAngeles
productionBaseUrl: https://forge.areasong.top
releaseTag: v0.1.5
remoteFallbackDir: /tmp/areaforge-ops001-fallback-20260711090016
localEvidenceDir: /tmp/areaforge-ops001-fallback-20260711090016
redactedUpdateStatusHash: sha256:8161888a38aab776c1d36351b271768dd785bc9acca87e36b4aa1df60000f8f8
remotePrerequisitesHash: sha256:42e2c47f872b7ac61e5c6270f099609c4eb9a98fdc49126bd3feb465b188e69a
remoteFallbackSummaryHash: sha256:f1c296d4bcff2fbd5c62fde24096b5b639d5beffced3b65d5a3e92a7f1c88841
blockedRecord: docs/development/ops-001-blocked-record-20260711.txt
```

Third fallback attempt after interactive sudo TTY handoff:

```text
productionHost: LosAngeles
productionBaseUrl: https://forge.areasong.top
releaseTag: v0.1.5
remoteFallbackDir: /tmp/areaforge-ops001-fallback-20260711120111
localEvidenceDir: /tmp/areaforge-ops001-fallback-20260711120111
redactedUpdateStatusHash: sha256:d81bc0472446bc64721dd8c758c4fe6df22102f7a9594039e195c56ae74b3e29
remotePrerequisitesHash: sha256:ff37e0bbc572493583074b72906ff6e91cbfacb033ed05ebba70848491d28c48
remoteFallbackSummaryHash: sha256:ba6065578836b60be15535229aa52170519e78396090d569f4fd5b29f3784f2b
remoteSummaryMode: ops001-readonly-fallback-blocked
smokeStatus: not-run
redactedHandoffStatus: granted
blockedRecord: docs/development/ops-001-blocked-record-20260711.txt
```

Validated locally:

```bash
pnpm update-agent:status:validate /tmp/areaforge-ops001-blocked-20260711083435/redacted-update-status.json
pnpm update-agent:status:validate /tmp/areaforge-ops001-fallback-20260711090016/redacted-update-status.json
pnpm update-agent:status:validate /tmp/areaforge-ops001-fallback-20260711120111/redacted-update-status.json
pnpm ops:ops-001:blocked:validate docs/development/ops-001-blocked-record-20260711.txt
AREAFORGE_OPS001_UPDATE_STATUS_RECORD=/tmp/areaforge-ops001-fallback-20260711120111/redacted-update-status.json \
  AREAFORGE_OPS001_BLOCKED_RECORD=docs/development/ops-001-blocked-record-20260711.txt \
  pnpm ops:ops-001:preflight
```

Observed validation result:

```text
update-agent status: valid
blocked record: valid after normalization into ops001-readonly-evidence-blocked shape
OPS-001 preflight status: blocked_on_prerequisite when AREAFORGE_OPS001_BLOCKED_RECORD is provided; otherwise needs_evidence
production read-only smoke record: missing
operational evidence bundle: missing
OPS-001 closure packet: missing
```

## Blockers

- Production host does not currently provide host-level `node`, `pnpm`, or `corepack`, so `areaforge-ops001-evidence-export.sh` cannot run the repository `pnpm` evidence commands directly on the host.
- The 2026-07-11 fallback read of `/etc/areaforge/updater.env` shows production smoke config is incomplete:
  - `AREAFORGE_EXTRA_SMOKE_COMMAND`: missing
  - `AREAFORGE_SMOKE_EMAIL`: missing
  - `AREAFORGE_SMOKE_PASSWORD_FILE`: missing

## Claim Boundary

This record proves:

- Production update-agent status can be exported as redacted JSON.
- The redacted status passes `pnpm update-agent:status:validate`.
- The OPS-001 preflight correctly refuses closure while smoke and evidence bundle records are missing.
- The fallback helper can safely hand off a redacted `/tmp/areaforge-ops001-fallback-*` directory to the SSH user when `redactedHandoffStatus=granted`.

This record does not prove:

- production authenticated read-only smoke passed;
- `AREAFORGE_EXTRA_SMOKE_COMMAND` is configured or usable end-to-end by the update-agent;
- an operational evidence bundle is ready;
- an OPS-001 closure packet is ready;
- `AF-RISK-OPS-001` can be closed;
- AreaForge is long-term operable.

## Required Next Step

Use the production smoke credential configuration confirmation packet in `docs/development/high-risk-confirmation-packets.md` before changing `/etc/areaforge/updater.env` or creating a smoke password file. After that, rerun the OPS-001 read-only evidence export and validate:

```bash
pnpm smoke:prod-readonly:validate <prod-readonly-smoke-record.txt>
pnpm update-agent:status:validate <redacted-update-status.json>
pnpm ops:evidence:bundle:validate <operational-evidence-bundle.json>
AREAFORGE_OPS001_SMOKE_RECORD=<prod-readonly-smoke-record.txt> \
AREAFORGE_OPS001_UPDATE_STATUS_RECORD=<redacted-update-status.json> \
AREAFORGE_OPS001_EVIDENCE_BUNDLE=<operational-evidence-bundle.json> \
AREAFORGE_OPS001_CLOSURE_PACKET=<ops001-closure-packet.txt> \
pnpm ops:ops-001:preflight
pnpm ops:ops-001:closure:validate <ops001-closure-packet.txt>
```

## Safety Facts

```text
productionTouched: yes
productionWriteAttempted: no
serverCommandAttempted: yes
backupRestoreAttempted: no
migrationAttempted: no
updaterApplyAttempted: no
rollbackAttempted: no
dockerComposeChanged: no
uploadDirectoryTouched: no
secretValuePrinted: no
residualLedgerUpdatedByProductionAction: no
fallbackCurlSmokeAttempted: no
```
