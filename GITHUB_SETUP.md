# Publishing JellyHub to GitHub and Unraid

## Publish to your repository
1. Open https://github.com/Arnas1111/JellyHub and select **uploading an existing file**.
2. Extract the archive and upload its **contents** (including `.github/workflows/container.yml`), preserving the directory structure. If the browser does not preserve directories, use Git locally.
3. Commit to `main`.
4. The GitHub Actions `Build container` workflow builds and pushes a development image `ghcr.io/<OWNER>/jellyhub:dev` on each push to `main`.
5. Make the GHCR package accessible to your Unraid host (public package or configure a GitHub package read token in Docker). GitHub repository visibility and package visibility are separate settings.

## Use Unraid template
1. Copy `unraid/my-JellyHub.xml` to `/boot/config/plugins/dockerMan/templates-user/my-JellyHub.xml` on Unraid.
2. The template is preconfigured with `ghcr.io/arnas1111/jellyhub:dev`.
3. In Unraid > Docker > Add Container select JellyHub and apply. Use `docker_external` network, with Jellyfin at `http://jellyfin:8096`.
4. Default host UI port 3100. Keep this preview restricted to your trusted network; do not expose via Traefik until security review.

## Current limitations
This is a preliminary prototype. It lacks video playback and the completed Jellystat and administrative integrations. No official Jellyfin Web/plugin compatibility guarantee. Do not publish secrets or `.env` files in GitHub.
