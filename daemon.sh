#!/data/data/com.termux/files/usr/bin/bash
# Starts the whole on-device stack detached from the terminal session.
#
# Three hard lessons are encoded here:
#
#  1. Nothing may be a child of the terminal. Termux kills the session's
#     foreground process when the app is closed, so both the model server and
#     the brain run under nohup and hold their own wake lock. Without the wake
#     lock Android freezes the CPU with the screen off and the robot goes dumb.
#
#  2. Ollama must never keep two models resident. This phone has 3.6 GB of RAM.
#     Loading a second model spawned a third llama-server runner, which pushed
#     the device into swap thrashing (lmkd logged "thrashing (207%)") and Android
#     killed every Termux process at once, taking the brain down with it.
#     OLLAMA_MAX_LOADED_MODELS=1 makes a model switch unload the old one first.
#
#  3. The brain needs a supervisor. When that kill happened, nothing brought the
#     server back: the robot stayed mute until someone opened Termux by hand.
#     The loop below restarts node when it exits, and only `stop.sh` can end it.
set -u

cd "$(dirname "$0")"

termux-wake-lock

# Token for the loopback admin endpoint. Deploys restart the brain through it so
# nobody has to type into a phone with a broken screen.
export BRAIN_ADMIN_TOKEN="20be38469d7a1fc5"

if command -v ollama >/dev/null 2>&1 && ! pgrep -f "ollama serve" >/dev/null 2>&1; then
  OLLAMA_HOST=127.0.0.1:8080 \
  OLLAMA_MAX_LOADED_MODELS=1 \
  OLLAMA_KEEP_ALIVE=24h \
  OLLAMA_CONTEXT_LENGTH=2048 \
  OLLAMA_NUM_PARALLEL=1 \
    nohup ollama serve >> ollama.log 2>&1 &
  echo "started ollama pid $!"
fi

if [ -f brain.pid ] && kill -0 "$(cat brain.pid)" 2>/dev/null; then
  echo "supervisor already running (pid $(cat brain.pid))"
  exit 0
fi

# A previous stop.sh may have left its flag behind if the loop was killed mid-sleep.
rm -f .stop

nohup bash -c '
  while true; do
    node src/server.js >> brain.log 2>&1
    status=$?
    if [ -f .stop ]; then
      rm -f .stop
      echo "[supervisor] stopped by request" >> brain.log
      break
    fi
    echo "[supervisor] node exited with $status, restarting in 2s" >> brain.log
    sleep 2
  done
' >> brain.log 2>&1 &

echo $! > brain.pid
echo "started supervisor pid $(cat brain.pid), logging to brain.log"
