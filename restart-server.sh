#!/usr/bin/env bash
# Restart the local wrangler dev server against the current dist/.
# The build guard deletes dist/ before every build, so a running server must be
# restarted afterwards or it 404s on everything.
set -u
cd "$(dirname "$0")"
pkill -f "wrangler dev" 2>/dev/null || true
sleep 2
setsid nohup npx wrangler dev --port 4321 --ip 127.0.0.1 >/tmp/opencode/wrangler.log 2>&1 </dev/null &
for _ in $(seq 1 40); do
  sleep 2
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4321/ || true)
  if [ "$code" = "200" ]; then echo "server up (200)"; exit 0; fi
done
echo "server did not come up" >&2
tail -20 /tmp/opencode/wrangler.log >&2
exit 1
