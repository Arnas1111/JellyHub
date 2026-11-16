#!/usr/bin/env bash
set -euo pipefail
cleanup() {
  docker logs jellyhub-smoke || true
  docker rm -f jellyhub-smoke || true
  docker volume rm jellyhub-smoke-config || true
}
trap cleanup EXIT
docker volume create jellyhub-smoke-config
# Reproduce an Unraid bind-mount root and saved settings owned by root.
docker run --rm --entrypoint sh -v jellyhub-smoke-config:/config jellyhub:smoke -c 'echo "{\"seerrKey\":\"smoke-test\"}" > /config/settings.json; mkdir -p /config/untouched; chown 0:0 /config /config/settings.json /config/untouched; chmod 500 /config; chmod 600 /config/settings.json'
docker run -d --name jellyhub-smoke -p 127.0.0.1:3100:3000 -v jellyhub-smoke-config:/config jellyhub:smoke
for attempt in $(seq 1 60); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' jellyhub-smoke)" = healthy ]; then break; fi
  sleep 1
done
test "$(docker inspect --format '{{.State.Health.Status}}' jellyhub-smoke)" = healthy
curl --fail http://127.0.0.1:3100/healthz
curl --fail http://127.0.0.1:3100/ | grep 'id="app"'
curl --fail http://127.0.0.1:3100/app.js > /dev/null
curl --fail http://127.0.0.1:3100/admin.js > /dev/null
curl --fail http://127.0.0.1:3100/cinema.js > /dev/null
curl --fail http://127.0.0.1:3100/carousel.js > /dev/null
for asset in playback-policy.js watch.js avatars.js choices.js roles-admin.js member-profile.js chat.js presence.js login.js registration-admin.js streams.js profile.js my-list.js watch-state.js availability.js featured-cache.js player.js library.js account.js extensions.js reviews.js vendor/hls.min.mjs vendor/hls.worker.js extensions/manifest.json; do
  curl --fail "http://127.0.0.1:3100/$asset" > /dev/null
done
curl --fail http://127.0.0.1:3100/styles.css > /dev/null
curl --fail http://127.0.0.1:3100/api/branding
curl --fail http://127.0.0.1:3100/favicon.ico > /dev/null
curl --fail http://127.0.0.1:3100/branding-logo > /dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/me)" = 401
docker exec jellyhub-smoke node -e "const fs=require('fs');if(!/^Uid:\\s+1000\\s+1000\\s+1000\\s+1000$/m.test(fs.readFileSync('/proc/1/status','utf8')))process.exit(1);if(fs.statSync('/config').uid!==1000||fs.statSync('/config/settings.json').uid!==1000||fs.statSync('/config/untouched').uid!==0)process.exit(1)"
docker exec --user 1000:1000 jellyhub-smoke node -e "const fs=require('fs');if(JSON.parse(fs.readFileSync('/config/settings.json')).seerrKey!=='smoke-test')process.exit(1);fs.writeFileSync('/config/.settings-test.tmp',JSON.stringify({seerrKey:'smoke-test'}),{mode:0o600});fs.renameSync('/config/.settings-test.tmp','/config/settings.json')"
docker rm -f jellyhub-smoke
docker run -d --name jellyhub-smoke -p 127.0.0.1:3100:3000 -e PUID=99 -e PGID=100 -v jellyhub-smoke-config:/config jellyhub:smoke
for attempt in $(seq 1 30); do
  if curl --fail -s http://127.0.0.1:3100/healthz; then break; fi
  sleep 1
done
curl --fail http://127.0.0.1:3100/healthz
docker exec jellyhub-smoke node -e "if(JSON.parse(require('fs').readFileSync('/config/settings.json')).seerrKey!=='smoke-test')process.exit(1)"
docker exec --user 99:100 jellyhub-smoke node -e "const fs=require('fs');if(!/^Uid:\\s+99\\s+99\\s+99\\s+99$/m.test(fs.readFileSync('/proc/1/status','utf8')))process.exit(1);fs.writeFileSync('/config/custom-uid-test','ok');if((fs.statSync('/config/settings.json').mode&511)!==384)process.exit(1)"
docker rm -f jellyhub-smoke
# A read-only appdata mount must fail clearly instead of pretending saves work.
if docker run --name jellyhub-smoke -v jellyhub-smoke-config:/config:ro jellyhub:smoke; then
  echo 'Expected a read-only config mount to fail initialization' >&2
  exit 1
fi
docker logs jellyhub-smoke 2>&1 | grep 'Mount JellyHub appdata read/write'
