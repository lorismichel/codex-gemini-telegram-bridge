# gemini-telegram-integration_v2

Single-project bridge for controlling a local Gemini CLI session from Telegram.

## How It Works

- `npm run start` launches the `manager`.
- The `manager` polls the Telegram Bot API.
- When a message arrives, the `worker` runs `gemini` on demand.
- The `worker` is forked internally by the manager, so `npm run worker` is usually not needed.

Gemini does not need to be running in advance.

## Files

- `local.env.example`: local environment template
- `local.env`: local configuration
- `project.json`: project-specific configuration
- `state.json`: allowed chat and session state storage
- `logs/events-YYYY-MM-DD.jsonl`: structured event logs

## Setup

```bash
cd gemini-telegram-integration_v2
cp local.env.example local.env
npm run start
```

Edit `project.json` if needed.

## Configuration

`local.env`

```env
TELEGRAM_BOT_TOKEN=xxxxxxxxxxxxxxxx
```

- `TELEGRAM_ALLOWED_CHAT_ID` is optional.
- If it is not set, the first chat that sends a message is automatically registered and stored in `state.json`.

`project.json`

```json
{
  "allowAnyCommand": true,
  "allowFirstChatRegistration": true,
  "geminiArgs": ["--yolo"]
}
```

Default values:

- `repoPath`: parent of the integration directory
- `geminiCmd`: `gemini`
- `geminiArgs`: `["--yolo"]`
- `allowedCommands`: `status`, `diff`, `log`, `sessions`
- `allowAnyCommand`: `true`
- `allowFirstChatRegistration`: `true`

Set `repoPath` only if you want to target a different repository. Relative paths are resolved from the integration directory.

Example override:

```json
{
  "allowAnyCommand": false,
  "geminiArgs": ["--yolo"]
}
```

Use an override like this only if you want to disable unrestricted `/run` execution.

## Telegram Commands

- Plain text message: treated the same as `/ask`
- `/help`
- `/where`
- `/ask <prompt>`
- `/status`
- `/diff`
- `/log`
- `/sessions`
- `/resume <latest|index|session-id>`
- `/reset-session`
- `/commit <message>`
- `/push`
- `/run <command-name>`
- `/shutdown`

## Sessions

- The current session is stored in `state.json` per `chat_id`.
- `/ask` continues the current session when one exists.
- `/sessions` shows recent sessions tracked by the bridge.
- `/resume` switches the current session.
- `/reset-session` clears the current session.

## Logging

- Runtime events are stored in `logs/events-YYYY-MM-DD.jsonl`.
- Events include `message_received`, `command_started`, `command_finished`, `command_failed`, and `shutdown_requested`.
- By default, logs record message and prompt lengths instead of raw text. Set `LOG_MESSAGE_TEXT=true` only if you explicitly want full message contents in logs.

## Security Notes

- If `TELEGRAM_ALLOWED_CHAT_ID` is unset, the first chat to contact the bot becomes the allowed chat.
- `/commit`, `/push`, and `/run` can change the local repository or execute local commands.
- `allowAnyCommand` is enabled by default, so `/run` can execute arbitrary local commands unless you explicitly disable it.
- `geminiArgs` defaults to `["--yolo"]`, which auto-approves Gemini CLI tool calls. Change that if you want a stricter runtime.

## Wrapper Script

`scripts/start-gemini-with-telegram.sh` is not a replacement for `npm run start`.

It is a helper script that:

1. Starts the manager in the background if it is not already running.
2. Then launches the `gemini` CLI itself.
