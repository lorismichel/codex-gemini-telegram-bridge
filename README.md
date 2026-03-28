# codex-gemini-telegram-bridge

Telegram bridges for running local coding CLIs from a single authorized chat.

## Projects

- `codex-telegram-integration`: controls a local Codex CLI session from Telegram
- `gemini-telegram-integration_v2`: controls a local Gemini CLI session from Telegram

Each integration runs a local manager process that polls Telegram, forwards commands to a worker, and executes the target CLI inside a configured repository.

## Repository Layout

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

## Quick Start

```bash
cd codex-telegram-integration
cp local.env.example local.env
npm run start
```

Or:

```bash
cd gemini-telegram-integration_v2
cp local.env.example local.env
npm run start
```

## Publish Readiness Notes

- `local.env`, `state.json`, `.manager.pid`, `manager.log`, and `logs/` are gitignored in both integrations.
- The first Telegram chat is auto-registered when `TELEGRAM_ALLOWED_CHAT_ID` is not set.
- Arbitrary `/run` execution is enabled by default through `allowAnyCommand: true`.
- The Codex sample config enables `--dangerously-bypass-approvals-and-sandbox` by default.
- Runtime logs now store prompt and message lengths by default instead of raw text.

## Default High-Trust Behavior

These features are intentionally enabled by default:

- Arbitrary `/run` execution:

```json
{
  "allowAnyCommand": true
}
```

- Codex sandbox and approval bypass:

```json
{
  "codexArgs": [
    "--search",
    "--dangerously-bypass-approvals-and-sandbox"
  ]
}
```

Read each integration's README before publishing or deploying. The exact CLI flags and trust model differ between Codex and Gemini.
