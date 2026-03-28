# codex-gemini-telegram-bridge

Telegram bridges for running local coding CLIs from a single authorized chat.

## Why this exists

I got used to Claude Code Channels and then hit usage limits.

The real problem was not losing a model. It was losing the workflow: sending a coding task
from my phone, waiting for the result, and continuing the same thread later without
sitting in front of the terminal.

This is not a hosted service and not a generic agent platform. It is a small bridge for
people who already work locally and want the async Telegram workflow back.

## What it does

Each integration runs a local manager process that:

1. polls Telegram Bot API
2. accepts commands from one authorized chat
3. runs the target CLI inside a configured repository
4. sends output back to Telegram

## Security model

This project is intentionally high-trust by default.

- `/run` can execute arbitrary commands when `allowAnyCommand` is enabled
- the sample Codex config uses `--dangerously-bypass-approvals-and-sandbox`
- the first Telegram chat may auto-register if `TELEGRAM_ALLOWED_CHAT_ID` is not set

Do not expose this to untrusted chats. Review each integration's config before real use.

This is meant for personal use on a machine you control, not for multi-user or internet-exposed deployment.

## Projects

- `codex-telegram-integration`: controls a local Codex CLI session from Telegram
- `gemini-telegram-integration_v2`: controls a local Gemini CLI session from Telegram

## Quick start

```bash
cd codex-telegram-integration
cp local.env.example local.env
# edit local.env and project.json
npm install
npm run start
```

Or:

```bash
cd gemini-telegram-integration_v2
cp local.env.example local.env
# edit local.env and project.json
npm install
npm run start
```

## Example flow

Telegram:

- `fix the failing test in worker/auth.ts`
- `show git diff`
- `commit with message: fix auth test`

Bridge:

- receives the message
- resumes or starts a local CLI session
- runs inside the configured repo
- sends the result back to Telegram

## Example session

**Telegram**

```text
fix the failing import in src/index.ts
show me the diff after
```

**Bridge reply**

```text
Updated src/index.ts

- fixed import path for config loader
- ran tests: 12 passed

Diff summary:
- 1 file changed
- 3 insertions
- 1 deletion
```

## Repository layout

```text
.
├── codex-telegram-integration/
└── gemini-telegram-integration_v2/
```

Each integration contains its own:

- `src/`: manager, worker, config, logging, and state helpers
- `local.env.example`: bot token template
- `project.json`: per-project command and runtime configuration
- `scripts/`: convenience launch wrapper

## Notes

- `local.env`, `state.json`, `.manager.pid`, `manager.log`, and `logs/` are gitignored
- runtime logs store prompt and message lengths by default instead of raw text
- read each integration's README before publishing or deploying
