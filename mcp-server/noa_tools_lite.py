"""NOA server-side MCP tools (dependency-free version).

Same tool set as noa_tools.py minus web search:
  - self.telegram.send: queue a text message to the owner's Telegram chat

Web search lives in the NOA firmware now; a second web.search here makes the
server reject the tool list with "Duplicate tool names: web__search".

Only the Python standard library is used, so this runs on Termux / Android
without building pydantic or other native wheels.

Protocol: MCP over stdio (JSON-RPC 2.0, one message per line).
All logging goes to stderr; stdout is the protocol channel.
"""

import json
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_PATH = os.path.join(HERE, ".env")
STATE_PATH = os.path.join(HERE, "state.json")

TELEGRAM_URL = "https://api.telegram.org/bot{token}/{method}"

TELEGRAM_QUEUED = "Message queued for Telegram."
MUSIC_PACKAGE = "io.ymusic.android"
PCMONITOR_ACTIVITY = "com.lord.pcmonitor/.MainActivity"

PROTOCOL_VERSION = "2024-11-05"


# ---------------------------------------------------------------- env

def load_env(path=ENV_PATH):
    """Minimal .env loader (KEY=VALUE lines, # comments)."""
    try:
        with open(path, "r", encoding="utf-8-sig") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except FileNotFoundError:
        pass


load_env()

TOOLS = [
    {
        "name": "self.telegram.send",
        "description": (
            "Send a text message to the user's phone through Telegram. Use it "
            "when the user asks to send, forward or notify something to their "
            "phone or Telegram, for example a list, a note or a summary."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "self.music.play",
        "description": (
            "Play a song on the user's phone in the background with YMusic, "
            "which keeps playing while the PC-monitor panel stays in front. "
            "Pass the song and artist as plain text, for example 'Daft Punk "
            "Get Lucky': it starts playing right away. A full YouTube video "
            "URL also works. Do not ask for a video URL first, and never "
            "send a bare search page URL. The sound comes out of the phone, "
            "not out of this device's own speaker."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "self.music.stop",
        "description": (
            "Stop the music on the user's phone. It pauses the current "
            "playback and brings the PC-monitor panel back to the foreground, "
            "so an endless mix stops playing. Use it when the user says to "
            "stop, close or kill the music."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "self.music.resume",
        "description": (
            "Resume the paused music on the user's phone, in the background. "
            "Use it when the user says to continue, resume or unpause the "
            "song that is already loaded. To start something new use "
            "self.music.play instead."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "self.phone.volume",
        "description": (
            "Read the music volume of the USER'S PHONE, the Android phone that "
            "plays the music. It returns a level such as 15 out of 15. This is "
            "NOT the volume of this device's own built-in speaker: for that, "
            "use self.audio_speaker.set_volume instead. When the user asks "
            "about the music volume, the phone volume, or why a song sounds "
            "low, use this tool."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]

_send_queue = queue.Queue()
_worker_started = False
_worker_lock = threading.Lock()


def log(message):
    print(message, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- state

def _load_state():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_state(state):
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as fh:
            json.dump(state, fh, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ---------------------------------------------------------------- http

def _http_json(url, payload=None, headers=None, method=None, timeout=20):
    data = None
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(
        url, data=data, headers=hdrs, method=method or ("POST" if data else "GET")
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


# ---------------------------------------------------------------- Telegram

def _telegram_call(token, method, payload=None, timeout=20):
    return _http_json(
        TELEGRAM_URL.format(token=token, method=method), payload, timeout=timeout
    )


def _resolve_chat_id(token):
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
                _telegram_call(token, "sendMessage", {"chat_id": chat_id, "text": "Tu chat_id es %s" % chat_id})
            except Exception:
                pass
            return str(chat_id)
    return ""


def _telegram_send(text):
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
        return ("Telegram request failed: HTTP %s %s" % (exc.code, detail)).strip()
    except Exception as exc:
        return "Telegram request failed: %s" % exc
    return "Message sent to Telegram."


def _worker():
    while True:
        text = _send_queue.get()
        try:
            result = _telegram_send(text)
            log("[telegram] " + result)
        except Exception as exc:
            log("[telegram] worker error: %s" % exc)
        finally:
            _send_queue.task_done()


def _ensure_worker():
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        threading.Thread(target=_worker, name="telegram-worker", daemon=True).start()
        _worker_started = True


def _pcmonitor_front():
    try:
        subprocess.run(["am", "start", "-n", PCMONITOR_ACTIVITY], capture_output=True, text=True, timeout=20)
    except Exception:
        pass


def _music_play(query):
    query = (query or "").strip()
    if not query:
        return "Nothing to play: the song name is empty."
    lowered = query.lower()
    if lowered.startswith(("http://", "https://")):
        command = ["am", "start", "-a", "android.intent.action.VIEW", "-d", query,
                   "-p", MUSIC_PACKAGE]
    elif len(query) == 11 and all(c.isalnum() or c in "-_" for c in query):
        command = ["am", "start", "-a", "android.intent.action.VIEW",
                   "-d", "https://www.youtube.com/watch?v=" + query,
                   "-p", MUSIC_PACKAGE]
    else:
        command = ["am", "start", "-a", "android.media.action.MEDIA_PLAY_FROM_SEARCH",
                   "--es", "query", query, "-p", MUSIC_PACKAGE]
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        return "YMusic cannot be opened: the am command is not available here."
    except Exception as exc:
        return "YMusic cannot be opened: %s" % exc
    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    lowered_output = output.lower()
    # This Samsung build returns a non-zero code with an internal SyncNotedAppOp
    # exception even when the activity is launched, so the exit code is not a
    # reliable signal. Trust the launch output instead. Never fall back to a
    # launch without -p: that opens the system app chooser and steals focus.
    started = "starting:" in lowered_output or "activity not started" in lowered_output
    if started:
        return "Playing %s in the background. PC-monitor stays in front." % query
    return "The song did not start. YMusic could not open it: %s" % (output[:200] or "unknown error")


def _phone_volume():
    try:
        proc = subprocess.run(
            ["cmd", "media_session", "volume", "--stream", "3", "--get"],
            capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        return "The phone volume cannot be read: the cmd command is not available here."
    except Exception as exc:
        return "The phone volume cannot be read: %s" % exc
    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    match = re.search(r"volume is (\d+) in range \[0\.\.(\d+)\]", output)
    if not match:
        return "The phone volume cannot be read right now."
    level = int(match.group(1))
    top = max(int(match.group(2)), 1)
    percent = int(round(level * 100.0 / top))
    return "The phone's music volume is %d out of %d (%d%%)." % (level, top, percent)


def _music_resume():
    try:
        proc = subprocess.run(["cmd", "media_session", "dispatch", "play"],
                              capture_output=True, text=True, timeout=20)
    except FileNotFoundError:
        return "Playback cannot be resumed: the cmd command is not available here."
    except Exception as exc:
        return "Playback cannot be resumed: %s" % exc
    output = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if proc.returncode != 0 or "Error" in output:
        return "Playback cannot be resumed: %s" % (output[:200] or "unknown error")
    time.sleep(1)
    _pcmonitor_front()
    return "Playback resumed in the background. PC-monitor stays in front."


def _music_stop():
    ok = False
    errors = []
    for command in (
        ["cmd", "media_session", "dispatch", "pause"],
        ["am", "start", "-n", PCMONITOR_ACTIVITY],
    ):
        try:
            proc = subprocess.run(command, capture_output=True, text=True, timeout=20)
        except FileNotFoundError:
            errors.append("%s is not available here" % command[0])
            continue
        except Exception as exc:
            errors.append(str(exc))
            continue
        output = ((proc.stdout or "") + (proc.stderr or "")).strip()
        if proc.returncode == 0 and "Error" not in output:
            ok = True
        else:
            errors.append(output[:200] or command[0])
    if ok:
        return "Music stopped. PC-monitor is back in front."
    return "Could not stop the music: %s" % (errors[-1] if errors else "unknown error")


def call_tool(name, arguments):
    arguments = arguments or {}
    if name == "self.telegram.send":
        _ensure_worker()
        _send_queue.put(arguments.get("text", ""))
        return TELEGRAM_QUEUED
    if name == "self.music.play":
        return _music_play(arguments.get("query", ""))
    if name == "self.music.stop":
        return _music_stop()
    if name == "self.music.resume":
        return _music_resume()
    if name == "self.phone.volume":
        return _phone_volume()
    raise KeyError(name)


# ---------------------------------------------------------------- protocol

def reply(msg_id, result):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "result": result}) + "\n")
    sys.stdout.flush()


def reply_error(msg_id, code, message):
    payload = {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def handle(message):
    method = message.get("method")
    msg_id = message.get("id")
    params = message.get("params") or {}

    if method == "initialize":
        reply(msg_id, {
            "protocolVersion": params.get("protocolVersion") or PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "NOA tools", "version": "1.0.0"},
        })
        return
    if method == "tools/list":
        reply(msg_id, {"tools": TOOLS})
        return
    if method == "tools/call":
        name = params.get("name")
        try:
            text = call_tool(name, params.get("arguments"))
            reply(msg_id, {"content": [{"type": "text", "text": text}], "isError": False})
        except KeyError:
            reply_error(msg_id, -32602, "Unknown tool: %s" % name)
        except Exception as exc:
            reply(msg_id, {"content": [{"type": "text", "text": "Tool failed: %s" % exc}], "isError": True})
        return
    if method == "ping":
        reply(msg_id, {})
        return
    if method and method.startswith("notifications/"):
        return
    if msg_id is not None:
        reply_error(msg_id, -32601, "Method not found: %s" % method)


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except Exception:
            continue
        try:
            handle(message)
        except Exception as exc:
            log("[server] handler error: %s" % exc)


if __name__ == "__main__":
    main()
