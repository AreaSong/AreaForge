# AI Boundaries

## Allowed Current AI Paths

- Discipline text.
- Daily review advice.
- Tomorrow minimum task advice.
- Long-term stage adjustment draft through explicit authenticated POST route.

## Forbidden By Default

- Motivation vault.
- Full emotion records.
- Full daily review body.
- Attachments or OCR content.
- File paths.
- Full task titles in long-term context.
- Full prompt/raw response persistence.
- Automatic stage plan/task/mastery overwrite.
- Passive SSR/GET/background provider calls.

## Required Checks

- `AI_ENABLED=false` fallback.
- Missing config fallback.
- Provider success with schema validation.
- Timeout, 401, 429, 5xx, invalid JSON, invalid schema fallback.
- Rate limiting.
- Log redaction.
- Client key scan.
- No `AiCall`, `AiUsage`, prompt/raw response, or token history schema unless explicitly confirmed.
