#!/bin/bash
cd "$(dirname "$0")" || {
  echo "Could not find the project folder."
  read -r -p "Press Return to close."
  exit 1
}

export PATH="/opt/anaconda3/bin:/Library/Frameworks/Python.framework/Versions/3.10/bin:/opt/homebrew/bin:${PATH}"

PY=""
for candidate in python3 /opt/anaconda3/bin/python3 "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3"; do
  if "$candidate" -c "import cv2, numpy, PIL" >/dev/null 2>&1; then
    PY="$candidate"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "Could not start: no Python with opencv, numpy, and pillow was found."
  read -r -p "Press Return to close."
  exit 1
fi

PORT=8765
pids=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)
if [ -n "$pids" ]; then
  kill $pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    pids=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)
    [ -z "$pids" ] && break
    sleep 0.2
  done
  if [ -n "$pids" ]; then
    kill -9 $pids 2>/dev/null
    sleep 0.2
  fi
fi

"$PY" tools/serve.py &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' INT TERM HUP

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  if curl -sf -o /dev/null --max-time 0.4 "http://127.0.0.1:${PORT}/"; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "$ready" != 1 ]; then
  echo "The exhibit server did not start."
  kill "$SERVER_PID" 2>/dev/null
  read -r -p "Press Return to close."
  exit 1
fi

open "http://127.0.0.1:${PORT}/"
wait "$SERVER_PID"
