#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/printvendo/Downloads/10-13-26 | 08:39 | Printing-Vendo_V4-main/Printing-Vendo_V4-main"
FRONTEND_DIR="$PROJECT_DIR"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$LOG_DIR"

cd "$PROJECT_DIR"
"$PROJECT_DIR/.venv/bin/python" "$PROJECT_DIR/main.py" >> "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

cd "$FRONTEND_DIR"
npm run preview -- --host 0.0.0.0 --port 4173 >> "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  kill "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 10
chromium-browser --kiosk --incognito --disable-infobars --noerrdialogs http://localhost:4173
