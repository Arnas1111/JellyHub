# JellyHub

An independent, modern Jellyfin frontend development preview. Existing Jellyfin and media-management containers stay independent. Playback is not implemented yet.

## Unraid installation

Import [unraid/my-JellyHub.xml](unraid/my-JellyHub.xml) into `/boot/config/plugins/dockerMan/templates-user/` and add the container using Docker's template menu.

| Setting | Value |
| --- | --- |
| Image | `ghcr.io/arnas1111/jellyhub:dev` |
| Network | `docker_external` (must already exist) |
| Port | Host `3100` to container TCP `3000` |
| Persistent storage | `/mnt/user/appdata/jellyhub` to `/config`, read/write |
| Web UI | `http://YOUR-UNRAID-IP:3100/` |
| Container user | UID/GID `1000:1000` |

Use a dedicated JellyHub appdata directory mounted read/write. Startup briefly runs as root to set ownership of that directory and its `settings.json`, then drops to UID/GID `1000:1000` before running Node. It does not recursively change other files. Optional `PUID`/`PGID` override the runtime IDs (for example `99`/`100` for Unraid nobody/users). Custom Docker `--user` deployments skip ownership initialization and must prepare appdata permissions themselves. The template needs no integration API keys or per-service environment variables.

JellyHub defaults to `http://jellyfin:8096` for login. If your existing Jellyfin container has a different reachable address, set the advanced **Jellyfin URL** template field before first login. Saved settings take precedence over environment defaults. JellyHub does not attach, restart or reconfigure existing containers; service addresses must already be reachable from `docker_external`.

Sign in with your Jellyfin administrator account and open **Administration**. A horizontal tab row separates **General**, **Users**, **Branding** and each integration. Configure service URLs and API keys in the relevant tab, test the current fields, then save that integration. Tests work without saving, even if appdata is unwritable. Empty key inputs use the saved key; the inline clear checkbox removes a saved key when saved. Keys are stored in `/config/settings.json` and are never returned by the settings API. Normal users do not see admin navigation and admin APIs revalidate administrator access with Jellyfin.

**Branding** changes the sidebar text, browser title, Home greeting, accent color and favicon for all users and the sign-in page. Upload a PNG (up to 512 × 512 pixels) or ICO up to 64 KiB, or reset the favicon. Branding and image data persist in `/config/settings.json` alongside the other settings. Concurrent settings updates are serialized and merged to avoid overwriting unrelated configuration.

**Users** lists existing Jellyfin accounts. Select an account to rename it, adjust administrator/disabled/hidden flags, playback/download/transcoding permissions, remote access and allowed libraries. Rename and permission changes are separate actions. Existing unexposed policy and configuration fields are preserved. The editor blocks disabling or demoting the current account and rejects removal of the last enabled administrator. Account creation, deletion, password resets and advanced parental controls are not included.

## Home, universal search and requests

Home has a central movie/show search and Seerr-powered popular movie and TV rows above your Jellyfin library. These are popularity-based recommendations, not personalized recommendations. Search queries both the current user's Jellyfin library and Seerr's catalog, with separate **In your library** and **Discover & request** results. Where TMDB provider IDs match, catalog tiles open the accessible library item. A failed backend is reported without discarding results from the other backend.

Open a discovery title to request a movie or select TV seasons. Requests use standard quality and Seerr's default server/profile settings. Seerr enforces quotas, approval rules and request permissions. JellyHub resolves the signed-in account by immutable Jellyfin ID, verifies impersonation through `/auth/me`, and sends `X-Api-User` on discovery and request calls. It never accepts a browser-supplied request owner or falls back to the API key's administrator identity. Users need an existing matching Seerr account: sign into Seerr once with Jellyfin, or have an administrator import the account there. Discovery/request failures explain missing configuration or mapping. Live service compatibility has not been verified.

Search and discovery currently return the first page only. Movies/shows already accessible to the user are identified through Jellyfin provider IDs; incomplete metadata can prevent automatic matching. Discovery posters are proxied from TMDB through a fixed, validated image endpoint. Playback remains unimplemented.

Sonarr/Radarr connections send `X-Api-Key` to `/api/v3/system/status`. Get the key from that service's **Settings → General → Security**; it is different from the web login password. Missing keys are detected before making a request. An HTTP 401 with a configured key means authentication was rejected; check the key, service address and any proxy authentication. A failed settings save means newly entered keys have not been persisted. URLs may include a service URL base such as `http://sonarr:8989/sonarr`.

**Logging** in **Administration → General** offers `silent`, `error`, `warn`, `info` and `debug`. Applying the level persists it in settings; if storage is unwritable, it applies only until restart and displays that limitation. `LOG_LEVEL=debug` is an optional bootstrap environment default. Docker logs are structured JSON with request IDs. Failures include HTTP status or DNS/connection/timeout codes, timing and troubleshooting hints. Debug also logs successful requests. Headers, passwords, API keys, cookies, request bodies and upstream response bodies are excluded. Connection results show green/red status and expandable diagnostics.

If saving reports `CONFIG_NOT_WRITABLE`, update/recreate **only JellyHub** using the latest image so its startup initializer can repair ownership. Read-only mounts, ACLs or filesystems that disallow ownership changes still require correction on the dedicated JellyHub appdata path; the UI reports runtime UID/GID and a specific error code. Do not apply broad recursive permission changes to other appdata.

Default addresses: `http://jellyfin:8096`, `http://Seerr:5055`, `http://sonarr:8989`, `http://radarr:7878`, `http://jellystat:3000`, `http://Maintainerr:6246`. Connection tests report reachability, not full adapter compatibility. Jellystat analytics remain unimplemented.

Use only on a trusted LAN. This preview has not had a production security audit. Protect appdata backups because settings contain plaintext keys (written with mode 0600). Enable the advanced `COOKIE_SECURE=1` option when using HTTPS. In-memory sessions expire after a day and are cleared by restart. `/healthz` reports JellyHub process health without requiring backend services.

## Development and validation

Node.js 22 or newer:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

For local development, set `CONFIG_DIR` to a writable folder and `JELLYFIN_URL` to a reachable server, then run `npm start`. Node does not automatically read `.env`; `.env.example` only documents optional process environment variables. To test with an installed Chromium browser, set `BROWSER_EXECUTABLE` to its executable path.

[Audit and feature status](docs/STATUS.md) separates implemented behavior, mock-based tests and incomplete features. Live compatibility with Jellyfin 12.4.0.0 and the user's integrations has not been verified.

## Container publishing

[GitHub Actions](.github/workflows/container.yml) tests main/dev pushes and pull requests. Publishing runs only after application tests, browser tests, XML validation, Docker build and container smoke tests pass. Main/dev pushes publish `ghcr.io/arnas1111/jellyhub:dev` and a commit tag. See [publishing setup](GITHUB_SETUP.md) for GHCR permissions and visibility.
