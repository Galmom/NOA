#!/data/data/com.termux/files/usr/bin/sh
LOG=/sdcard/Download/noa_restart.log
: > "$LOG"
echo "START $(date)" >> "$LOG"
echo "BEFORE_PIDS: $(pgrep -f mcp_pipe_lite.py | tr '\n' ' ')" >> "$LOG"

cp /sdcard/Download/noa_tools_lite.py "$HOME/noa/noa_tools_lite.py" >> "$LOG" 2>&1 \
  && echo "COPY OK" >> "$LOG" || echo "COPY FAILED" >> "$LOG"

echo "JSON_DEFS: $(grep -c '\"name\": \"web.search\"' "$HOME/noa/noa_tools_lite.py" 2>/dev/null)" >> "$LOG"
echo "TAVILY_DEFS: $(grep -c 'def _tavily_search' "$HOME/noa/noa_tools_lite.py" 2>/dev/null)" >> "$LOG"

if [ -f "$HOME/noa/restart.sh" ]; then
  cd "$HOME/noa" && sh restart.sh >> "$LOG" 2>&1
else
  pkill -f mcp_pipe_lite.py
  pkill -f start-noa-mcp.sh
  sleep 1
  nohup sh "$HOME/.termux/boot/start-noa-mcp.sh" >> "$HOME/noa/pipe.log" 2>&1 &
fi

sleep 3
echo "AFTER_PIDS: $(pgrep -f mcp_pipe_lite.py | tr '\n' ' ')" >> "$LOG"
echo "DONE $(date)" >> "$LOG"
