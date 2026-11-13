# JellyHub (development preview)

A separate Jellyfin frontend and administration integration prototype. **Not a production-ready Jellyfin Web replacement**: playback, Jellystat analytics and full permission management are not implemented.

## Unraid install (no Compose)

- Image: `ghcr.io/arnas1111/jellyhub:dev` (requires a successful GitHub Actions build)
- Network: `docker_external`
- Host port `3100` → container TCP port `3000`
- Path: `/mnt/user/appdata/jellyhub` → `/config` (read/write)
- Local web UI: `http://YOUR-UNRAID-IP:3100`
- Internal runtime runs as UID 1000; ensure the appdata folder is writable by UID 1000.

Import `unraid/my-JellyHub.xml` into `/boot/config/plugins/dockerMan/templates-user/` to configure the values automatically.

Sign in with your existing **Jellyfin administrator account**, then open **Connections** in the sidebar. Enter API keys and change service URLs there; you don't need environment variables for individual integrations.

Default internal service URLs: `http://jellyfin:8096`, `http://Seerr:5055`, `http://sonarr:8989`, `http://radarr:7878`, `http://jellystat:3000`, `http://Maintainerr:6246`.

Click **Save settings** before using **Test connection**. Keys are stored at `/config/settings.json` on the container, without being returned to browsers. Backups of appdata contain these secrets; protect them. Modifying settings requires a Jellyfin administrator session, revalidated against Jellyfin. The integration UI is read-only currently.

### Security

Run only on a trusted LAN. Web authentication and integration security have **not** undergone a production security audit. Avoid exposing this preview on Traefik/public Internet. By default login cookies lack `Secure` for local HTTP; use `COOKIE_SECURE=1` for HTTPS access. Local settings persistence is plaintext with mode 0600; protect the host directory. Existing Docker containers are not modified.

### Development

```bash
npm run check
npm start
```

The `/config` directory must be writable to save settings. The frontend still lacks a Jellyfin-compatible player.
