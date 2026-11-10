# NOA MCP server

Server-side tools for the NOA xiaozhi agent. They reach the agent through its
MCP endpoint (`wss://api.xiaozhi.me/mcp/?token=...`), so the device firmware is
not touched.

Tools:

- `self.telegram.send` — queue a text message to the owner's Telegram chat.
  Properties: `text`.

Web search (`web.search`) lives in the NOA firmware now. Do not expose it here
too: the server merges both MCP endpoints and rejects the tool list with
`Duplicate tool names: web__search`.

## Setup

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
notepad .env
```

Fill `.env`:

| Variable | Where to get it |
| --- | --- |
| `MCP_ENDPOINT` | xiaozhi.me console -> agent -> 配置角色 -> MCP 接入点 |
| `TELEGRAM_BOT_TOKEN` | @BotFather -> `/newbot` (`123456789:AA...`) |
| `TELEGRAM_CHAT_ID` | leave empty; it is filled after you message the bot |

## Run

```powershell
.venv\Scripts\python mcp_pipe.py noa_tools.py
```

Keep it running. The console shows the endpoint as connected while the pipe is
alive, and the tools disappear from the agent when it stops.

## Notes

- `TELEGRAM_CHAT_ID` empty: the first message you send to the bot is captured,
  stored in `state.json`, and answered with `Tu chat_id es ...`. After that only
  that chat receives messages.
- `state.json`, `.env` and `.venv/` are ignored by git.

`mcp_pipe.py` is derived from [78/mcp-calculator](https://github.com/78/mcp-calculator) (MIT).
