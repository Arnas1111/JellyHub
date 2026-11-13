# JellyHub v0.1 — standalone Jellyfin frontend prototype

**Status:** Development prototype, not a replacement for Jellyfin Web yet. Do not publish on the public internet without a security review. No changes to your existing containers or data.

## Included
- New responsive dark web UI; normal Jellyfin username/password login.
- Jellyfin library browsing, recent items, continue-watching listing, details and thumbnail proxy.
- In-memory client API response caching, immediate navigation shell, lazy thumbnail images.
- Server-side, administrator-gated Seerr request list and Sonarr/Radarr queue summaries (read only).
- Credentials for Arr/Seerr remain server-side; browser never receives those API keys.
- Example Docker Compose and environment template.

## Not yet included
- Video/audio playback, transcoding, subtitles, player reporting, resume updates.
- Jellystat statistics adapter, Seerr request creation/approval, Arr management actions.
- Permissions editor, plugin API compatibility, plugin management, full Jellyfin administration.
- Production-grade sessions (in-memory only), multi-instance scaling, audit log, external reverse proxy setup.
- Compatibility testing against your Jellyfin/server/service versions.

## GitHub + Unraid installation
See [GITHUB_SETUP.md](GITHUB_SETUP.md). The GitHub Actions workflow publishes a `dev` image to GHCR on pushes to `main`.

## Install
1. Extract zip and enter folder.
2. `cp .env.example .env` and edit internal URLs and keys. On Windows, copy the file manually.
3. `docker network ls` and choose the network shared by the other containers. Adjust `compose.yaml` external network name (`media`). Add JellyHub to a network able to resolve the others; do not need to add them to an untrusted network.
4. `docker compose up -d --build`.
5. From the Docker host, visit `http://localhost:3100`. It binds to loopback by default. For remote access use a controlled reverse proxy / VPN.

## Security and permissions
The server derives `admin` from Jellyfin's `Users/Me` response and checks it server-side before all integration endpoints. Normal users cannot call them. Jellyfin controls library access. Seerr/Arr credentials are environment variables in the integration container only; never submit .env or other secrets to assistants. Do not assume Jellyfin admin permissions map exactly to future granular integration roles. For production, add persistent encrypted sessions, CSRF protection appropriate to your proxy, rate limiting across processes, hardened deployment, monitoring and automated tests.

## Local testing
`node --check server.js && node --check public/app.js && PORT=3000 JELLYFIN_URL=http://... node server.js`

## Version notes
The current Sonarr/Radarr API base path defaults to `/api/v3` and can be overridden. Verify against your container version. The Jellystat Docker project provides statistics endpoints, but authentication and version must be confirmed before implementing its adapter; this release intentionally reports it as pending.

## Documentation / API references
- Jellyfin: https://api.jellyfin.org / https://github.com/jellyfin/jellyfin-sdk-typescript
- Seerr: https://docs.seerr.dev / local `/api-docs`
- Jellystat Docker statistics: https://jellystat.unbrained.dev/swagger/


## Maintainerr integration (read-only)

Set `MAINTAINERR_URL=http://Maintainerr:6246` in `.env` on the shared `docker_external` network. JellyHub fetches `/api/collections/overlay-data` server-side every 60 seconds, matches `mediaServerId` to Jellyfin item IDs and shows deletion countdown badges on library cards and detail pages. The countdown is advisory: Maintainerr cleanup jobs execute on their own schedule; rules may later change membership. Only active collections whose configured action deletes media (0/1/2/5) are displayed. Collections with missing `deleteAfterDays` are omitted rather than claiming a date. JellyHub never calls Maintainerr's destructive endpoints.

**Security:** Maintainerr's API has no built-in authentication. Do not publish the Maintainerr service publicly. The `/api/removals?ids=...` endpoint only returns matching items after confirming the requesting user's Jellyfin item access. The full membership index is restricted to administrators.
