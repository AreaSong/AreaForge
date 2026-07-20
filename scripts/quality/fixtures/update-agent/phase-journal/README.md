# Updater Phase Journal Fixture

This directory is fixture-only. It models redacted updater lifecycle events and interruption reconciliation without invoking updater, Docker, systemd, timers, queues, or production state.

The validator requires immutable release identity, monotonic event order, explicit reconciliation state, and `doesNotProve` boundaries.

`ops008-preconfirmation.json` is the checked-in strict phase chain. Its event hash chain proves fixture integrity only; it does not prove append-only production durability.
