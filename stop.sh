#!/data/data/com.termux/files/usr/bin/bash
# Stops the supervised brain started by daemon.sh.
#
# The supervisor loop will relaunch node as soon as it exits, so the stop is a
# two-step handshake: leave a .stop flag the loop checks, then kill it.
set -u

cd "$(dirname "$0")"

if [ ! -f brain.pid ]; then
  echo "not running (no brain.pid)"
  exit 0
fi

supervisor=$(cat brain.pid)

touch .stop
pkill -f "node src/server.js" 2>/dev/null

if kill "$supervisor" 2>/dev/null; then
  echo "stopped supervisor $supervisor"
else
  echo "supervisor $supervisor was not alive"
fi

rm -f brain.pid
