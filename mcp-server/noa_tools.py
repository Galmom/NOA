"""NOA server-side MCP tools.

Exposes one tool to the xiaozhi agent:
  - self.telegram.send: queue a text message to the user's Telegram chat

Web search lives in the NOA firmware now. Keeping a second web.search here
made the server reject the whole tool list with
"Duplicate tool names: web__search".

This module is a stdio MCP server. mcp_pipe.py bridges it to the xiaozhi
MCP endpoint over websocket.

Secrets come from the environment (see .env.example).
"""

import json
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from dotenv import load_dotenv
from fastmcp import FastMCP

load_dotenv()

mcp = FastMCP("NOA tools")

TELEGRAM_URL = "https://api.telegram.org/bot{token}/{method}"
STATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state.json")

TELEGRAM_QUEUED = "Message queued for Telegram."

_send_queue: "queue.Queue[str]" = queue.Queue()
_worker_lock = threading.Lock()
_worker_started = False


# ---------------------------------------------------------------- state file

def _load_state() -> dict:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_state(state: dict) -> None:
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as fh:
            json.dump(state, fh, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ---------------------------------------------------------------- http utils

def _http_json(url: str, payload=None, headers=None, method=None, timeout=20):
    data = None
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method or ("POST" if data else "GET"))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


# ---------------------------------------------------------------- Telegram

def _telegram_call(token: str, method: str, payload=None, timeout=20):
    return _http_json(TELEGRAM_URL.format(token=token, method=method), payload, timeout=timeout)


def _resolve_chat_id(token: str) -> str:
    """Return the owner chat id: env first, then the last chat seen by the bot."""
    configured = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if configured:
        return configured

    state = _load_state()
    stored = str(state.get("telegram_chat_id") or "").strip()
    if stored:
        return stored

    try:
        updates = _telegram_call(token, "getUpdates", timeout=10)
    except Exception:
        return ""

    for update in reversed(updates.get("result") or []):
        msg = update.get("message") or update.get("edited_message") or {}
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id:
            state["telegram_chat_id"] = str(chat_id)
            _save_state(state)
            try:
                _telegram_call(token, "sendMessage", {"chat_id": chat_id, "text": f"Tu chat_id es {chat_id}"})
            except Exception:
                pass
            return str(chat_id)
    return ""


def _telegram_send(text: str) -> str:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return "Telegram bot token is not configured. Set TELEGRAM_BOT_TOKEN in .env and restart."
    chat_id = _resolve_chat_id(token)
    if not chat_id:
        return "No Telegram chat yet. Write something to your bot first, then ask again."
    try:
        _telegram_call(token, "sendMessage", {"chat_id": chat_id, "text": text[:4000]})
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")[:200]
        except Exception:
            pass
        return f"Telegram request failed: HTTP {exc.code} {detail}".strip()
    except Exception as exc:
        return f"Telegram request failed: {exc}"
    return "Message sent to Telegram."


def _worker() -> None:
    while True:
        text = _send_queue.get()
        try:
            result = _telegram_send(text)
            # stderr only: stdout is the MCP channel when piped to the endpoint.
            print(f"[telegram] {result}", file=sys.stderr, flush=True)
        except Exception as exc:
            print(f"[telegram] worker error: {exc}", file=sys.stderr, flush=True)
        finally:
            _send_queue.task_done()


def _ensure_worker() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        threading.Thread(target=_worker, name="telegram-worker", daemon=True).start()
        _worker_started = True


@mcp.tool(name="self.telegram.send")
def telegram_send(text: str) -> str:
    """Send a text message to the user's phone through Telegram. Use it when the user asks to send, forward or notify something to their phone or Telegram, for example a list, a note or a summary."""
    _ensure_worker()
    _send_queue.put(text)
    return TELEGRAM_QUEUED


if __name__ == "__main__":
    mcp.run(transport="stdio")
