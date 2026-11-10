"""MCP stdio <-> WebSocket pipe for the xiaozhi MCP endpoint.

Derived from 78/mcp-calculator (MIT). Connects to the agent's MCP endpoint,
spawns the tool server as a child process and pipes JSON-RPC between them.

Usage:
    python mcp_pipe.py noa_tools.py

Environment (.env is loaded automatically):
    MCP_ENDPOINT=wss://api.xiaozhi.me/mcp/?token=...
"""

import asyncio
import logging
import os
import signal
import subprocess
import sys

import websockets
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("MCP_PIPE")

INITIAL_BACKOFF = 1
MAX_BACKOFF = 600


def build_command(target):
    if not os.path.exists(target):
        raise RuntimeError(f"'{target}' is not an existing script")
    return [sys.executable, target], os.environ.copy()


async def connect_once(uri, target):
    logger.info(f"[{target}] connecting to MCP endpoint...")
    async with websockets.connect(uri, ping_interval=20, ping_timeout=20) as websocket:
        logger.info(f"[{target}] CONNECTED")
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
        logger.info(f"[{target}] started tool server: {' '.join(cmd)}")
        try:
            await asyncio.gather(
                ws_to_process(websocket, process, target),
                process_to_ws(process, websocket, target),
                process_stderr(process, target),
            )
        finally:
            logger.info(f"[{target}] terminating tool server")
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
            logger.info(f"[{target}] <- {message[:160]}")
            process.stdin.write(message + "\n")
            process.stdin.flush()
    finally:
        if not process.stdin.closed:
            process.stdin.close()


async def process_to_ws(process, websocket, target):
    while True:
        data = await asyncio.to_thread(process.stdout.readline)
        if not data:
            logger.info(f"[{target}] tool server ended output")
            break
        logger.info(f"[{target}] -> {data[:160]}")
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
                logger.info(f"[{target}] reconnecting in {backoff}s (attempt {attempt})...")
                await asyncio.sleep(backoff)
            await connect_once(uri, target)
        except Exception as exc:
            attempt += 1
            logger.warning(f"[{target}] connection closed: {exc}")
            backoff = min(backoff * 2, MAX_BACKOFF)


def main():
    endpoint = os.environ.get("MCP_ENDPOINT", "").strip()
    if not endpoint:
        logger.error("MCP_ENDPOINT is not set (put it in .env)")
        sys.exit(1)
    target = sys.argv[1] if len(sys.argv) >= 2 else "noa_tools.py"
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    try:
        asyncio.run(run_forever(endpoint, target))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
