#!/bin/bash
cd "$(dirname "$0")"

PORT=8765
PIDS=$(lsof -nP -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null
  sleep 0.3
fi

open "http://127.0.0.1:${PORT}/"
exec python3 tools/serve.py
