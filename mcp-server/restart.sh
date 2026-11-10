#!/data/data/com.termux/files/usr/bin/sh
# Start exactly one NOA pipe: kill any previous supervisor and pipe first, so
# instances never pile up and fight over the access-point token.
cd "$HOME/noa" || exit 1

pkill -f start-noa-mcp.sh 2>/dev/null
pkill -f mcp_pipe_lite.py 2>/dev/null
sleep 1
pkill -9 -f start-noa-mcp.sh 2>/dev/null
pkill -9 -f mcp_pipe_lite.py 2>/dev/null
sleep 1

nohup sh "$HOME/.termux/boot/start-noa-mcp.sh" >> "$HOME/noa/pipe.log" 2>&1 &
sleep 5

echo "PIPE STARTED"
echo "supervisors: $(pgrep -f start-noa-mcp.sh | wc -l)"
echo "pipes: $(pgrep -f mcp_pipe_lite.py | wc -l)"
