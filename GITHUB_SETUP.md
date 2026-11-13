# Publish JellyHub

Upload all files, including `.github/workflows/build.yml`, to `Arnas1111/JellyHub` and commit to `main`.
GitHub Actions builds `ghcr.io/arnas1111/jellyhub:dev` on pushes. Make the package public if you want Unraid to pull without GHCR authentication.

Use the included `unraid/my-JellyHub.xml` template. It only needs the Docker network, port, and persistent appdata path. Configure integration endpoints and API keys in the JellyHub admin web interface.
