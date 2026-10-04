# Security Policy

AreaForge is a personal study operations system that handles authentication, study records, uploads, release automation, and optional AI provider calls. Please report security issues privately before opening public issues.

## Supported Versions

| Version | Supported |
|---|---|
| `0.1.x` | yes |

## Reporting A Vulnerability

Preferred path:

1. Use GitHub private vulnerability reporting when available on `AreaSong/AreaForge`.
2. If that is unavailable, open a minimal public issue asking for a private security contact. Do not include exploit details, secrets, user data, attachment contents, database URLs, API keys, or server paths.

Please include:

- affected version or commit
- affected surface: auth/session, upload/download, AI provider, updater/release, backup/restore, dependency, or other
- reproduction steps with redacted data
- expected impact
- whether data access, code execution, secret exposure, or supply-chain trust is involved

## Boundaries

- Do not test against systems you do not own or operate.
- Do not exfiltrate, delete, or modify user data.
- Do not attempt persistence, lateral movement, or destructive commands.
- Do not publish exploit details before a fix or mitigation is available.

## Security-Sensitive Areas

- Web runtime must not execute Docker, backup, restore, migration, or server commands.
- Attachments must stay outside `public/` and be served only through authenticated APIs.
- AI calls must use minimized context and must not send motivation vaults, full emotion records, full review text, attachment contents, file paths, secrets, or session tokens by default.
- GitHub Release updates require signed/hash-verified assets, immutable image digests, backups, smoke checks, and rollback evidence.

See `docs/security/threat-model.md` and `docs/security/file-ai-safety.md` for the current security model.
