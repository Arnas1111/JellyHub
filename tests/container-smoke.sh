#!/usr/bin/env bash
set -euo pipefail
cleanup() {
  docker logs jellyhub-smoke || true
  docker rm -f jellyhub-smoke || true
  docker volume rm jellyhub-smoke-config || true
}
trap cleanup EXIT
docker volume create jellyhub-smoke-config
docker run -d --name jellyhub-smoke -p 127.0.0.1:3100:3000 -v jellyhub-smoke-config:/config jellyhub:smoke
for attempt in $(seq 1 30); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' jellyhub-smoke)" = healthy ]; then break; fi
  sleep 1
done
test "$(docker inspect --format '{{.State.Health.Status}}' jellyhub-smoke)" = healthy
curl --fail http://127.0.0.1:3100/healthz
curl --fail http://127.0.0.1:3100/ | grep 'id="app"'
curl --fail http://127.0.0.1:3100/app.js > /dev/null
curl --fail http://127.0.0.1:3100/styles.css > /dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/me)" = 401
test "$(docker exec jellyhub-smoke id -u)" = 1000
docker exec jellyhub-smoke node -e "require('fs').writeFileSync('/config/settings.json',JSON.stringify({seerrKey:'smoke-test'}),{mode:0o600})"
docker rm -f jellyhub-smoke
docker run -d --name jellyhub-smoke -p 127.0.0.1:3100:3000 -v jellyhub-smoke-config:/config jellyhub:smoke
for attempt in $(seq 1 30); do
  if curl --fail -s http://127.0.0.1:3100/healthz; then break; fi
  sleep 1
done
curl --fail http://127.0.0.1:3100/healthz
docker exec jellyhub-smoke node -e "if(JSON.parse(require('fs').readFileSync('/config/settings.json')).seerrKey!=='smoke-test')process.exit(1)"
