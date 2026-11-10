"""MCP stdio <-> WebSocket pipe (dependency-free version).

Same as mcp_pipe.py, but without python-dotenv: the few variables are read
from .env directly. Only 'websockets' is required.

Usage:
    python mcp_pipe_lite.py noa_tools_lite.py
"""

import asyncio
import logging
import os
import signal
import subprocess
import sys

import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
INITIAL_BACKOFF = 1
MAX_BACKOFF = 600

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("MCP_PIPE")


def load_env(path=os.path.join(HERE, ".env")):
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


def build_command(target):
    if not os.path.exists(target):
        raise RuntimeError("'%s' is not an existing script" % target)
    return [sys.executable, target], os.environ.copy()


async def connect_once(uri, target):
    logger.info("[%s] connecting to MCP endpoint...", target)
    async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as websocket:
        logger.info("[%s] CONNECTED", target)
        cmd, env = build_command(target)
        process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding="utf-8",
            text=True,
            env=env,
        )
        logger.info("[%s] started tool server: %s", target, " ".join(cmd))
        try:
            await asyncio.gather(
                ws_to_process(websocket, process, target),
                process_to_ws(process, websocket, target),
                process_stderr(process, target),
            )
        finally:
            logger.info("[%s] terminating tool server", target)
            try:
                process.terminate()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


async def ws_to_process(websocket, process, target):
    try:
        while True:
            message = await websocket.recv()
            if isinstance(message, bytes):
                message = message.decode("utf-8")
            logger.info("[%s] <- %s", target, message[:160])
            process.stdin.write(message + "\n")
            process.stdin.flush()
    finally:
        if not process.stdin.closed:
            process.stdin.close()


async def process_to_ws(process, websocket, target):
    while True:
        data = await asyncio.to_thread(process.stdout.readline)
        if not data:
            logger.info("[%s] tool server ended output", target)
            break
        logger.info("[%s] -> %s", target, data[:160])
        await websocket.send(data)


async def process_stderr(process, target):
    while True:
        data = await asyncio.to_thread(process.stderr.readline)
        if not data:
            break
        sys.stderr.write(data)
        sys.stderr.flush()


async def run_forever(uri, target):
    attempt = 0
    backoff = INITIAL_BACKOFF
    while True:
        try:
            if attempt:
                logger.info("[%s] reconnecting in %ss (attempt %s)...", target, backoff, attempt)
                await asyncio.sleep(backoff)
            await connect_once(uri, target)
        except Exception as exc:
            attempt += 1
            logger.warning("[%s] connection closed: %s", target, exc)
            backoff = min(backoff * 2, MAX_BACKOFF)


def main():
    endpoint = os.environ.get("MCP_ENDPOINT", "").strip()
    if not endpoint:
        logger.error("MCP_ENDPOINT is not set (put it in .env)")
        sys.exit(1)
    target = sys.argv[1] if len(sys.argv) >= 2 else "noa_tools_lite.py"
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    try:
        asyncio.run(run_forever(endpoint, target))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
