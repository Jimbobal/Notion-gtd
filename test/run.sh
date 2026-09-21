#!/usr/bin/env bash
# Runs the relay tests and the browser end-to-end test against a mock Notion.
#   bash test/run.sh
# Needs Chromium via Playwright: NODE_PATH should point at a node_modules
# that has 'playwright' (e.g. NODE_PATH=$(npm root -g)).
set -u
cd "$(dirname "$0")/.."
MOCK_PORT=4999; APP_PORT=4180

stop() {
  for port in $MOCK_PORT $APP_PORT; do
    if command -v fuser >/dev/null; then fuser -k -n tcp "$port" >/dev/null 2>&1 || true
    else for pid in $(ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $NF}' | grep -o 'pid=[0-9]*' | cut -d= -f2); do kill "$pid" 2>/dev/null || true; done
    fi
  done
}
stop; sleep 0.5

node test/relay.test.js || exit 1
node test/ics.test.mjs || exit 1
node test/check-imports.js || exit 1

PORT=$MOCK_PORT node test/mock-notion.js > test/mock.log 2>&1 &
ICS_ALLOW_HTTP=1 NOTION_UPSTREAM="http://127.0.0.1:$MOCK_PORT/v1" PORT=$APP_PORT node dev-server.js > test/dev.log 2>&1 &
for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$APP_PORT/" && curl -s -o /dev/null "http://127.0.0.1:$MOCK_PORT/__state" && break; sleep 0.3; done

NODE_PATH="${NODE_PATH:-$(npm root -g)}" node test/e2e.js
status=$?
stop
exit $status
