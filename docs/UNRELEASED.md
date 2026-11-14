# Next release — held for the user's next change list

These changes are local on `work/next-release`. Do not push main/dev or trigger image publication until the user authorizes the next release. The previously pushed playback GUID compatibility repair is also awaiting release; its publishing run was cancelled before the image build.

## Home and visual polish

- Cards use a green circled check for **In your library**, an indigo circled plus for **Discover**, an amber clock for **Requested**, and a blue service mark for **Managed by Seerr**. Text and icons distinguish states independently of color. Managed-by-Seerr does not imply that the viewer has access to the item in Jellyfin.
- Native horizontal/vertical scrollbars use a dark track, rounded accent-colored thumb, hover treatment and no arrow buttons in Chromium/WebKit. Firefox uses the standard scrollbar-color/width styling. Keyboard, wheel and touch scrolling remain native. Forced-color mode uses system colors.
- Home restores the last featured selection and a compressed artwork snapshot from per-user session storage, before the featured refresh finishes. The cache keeps at most eight sanitized titles and one JPEG, expires after an hour and is cleared on sign-out/authentication failure. Stream URLs, credentials and user playback data are never serialized into it. First visits, expired caches and blocked storage use the existing stable loading stage.
- Cached slides remain static until a successful server refresh. A temporary service failure keeps the last frame and retries after 30 seconds. A fresh empty selection or authentication denial removes the snapshot. Hourly refresh retains the selected title when still present.
- Snapshot encoding is bounded to 1280 × 720 and avoids repeatedly recompressing cached JPEGs. Storage errors fall back to metadata-only snapshots or ordinary loading.

## Local validation

`npm run check`, `npm test` and all six browser suites pass in local Playwright Chromium with simulated backends and synthetic media. The Node suite has 31 checks: 30 pass on Windows, with the POSIX filesystem-permission check skipped for Linux CI. The new browser checks hold the featured response open across reload, verify cached title/artwork, refresh/error/empty-result behavior, logout clearing, user isolation, distinct badges, scrollbar styles and mobile width. A screenshot was visually inspected using synthetic artwork.

The container smoke-test asset list includes the new browser modules, but Docker/CI has not been run for these held changes. No image or release was published.
