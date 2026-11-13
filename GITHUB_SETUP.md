# Publishing JellyHub

The workflow is `.github/workflows/container.yml`. Push to `main` or `dev` to run tests, build the image, smoke-test it and publish `ghcr.io/arnas1111/jellyhub:dev` plus a commit tag. Pull requests validate without publishing. The workflow also supports manual dispatch.

Publishing uses the repository's built-in `GITHUB_TOKEN` with job-scoped `packages: write`; no registry password or personal token belongs in the Unraid template. GitHub Actions must be enabled. If a package already exists, its Actions access settings must grant this repository write access.

For anonymous Unraid pulls, the GHCR package must be public. A public repository does not automatically make a newly created package public. Check the package's visibility after first publication, then verify an anonymous pull. If visibility is private, change it in the package settings or supply registry credentials in Unraid.

The workflow smoke test creates only temporary JellyHub containers and a temporary volume on the GitHub-hosted runner. It checks startup health, frontend assets, anonymous API denial, the non-root runtime user, writable `/config`, and persistence across container recreation. It does not access any existing backend containers.

Use `unraid/my-JellyHub.xml`, with network `docker_external`, host port `3100`, container port `3000` and `/mnt/user/appdata/jellyhub:/config`. The WebUI placeholder uses the container port so Unraid resolves the selected host port correctly.

Runtime image target: Linux amd64 (standard x86-64 Unraid). ARM publishing is not configured.
