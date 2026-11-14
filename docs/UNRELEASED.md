# Profiles and server browsing — dev release batch

Prepared on `work/next-release`; the user authorized pushing and publishing this batch on 2026-11-14. It includes the playback GUID compatibility repair whose previous publishing run was cancelled during the release hold. GitHub Actions validates the complete batch before publishing the dev image.

## HTTP LAN compatibility hotfix

The filter controls and custom navigation no longer require `crypto.randomUUID`, which is unavailable on ordinary HTTP LAN origins. UI IDs use `crypto.getRandomValues`, which works there. The browser regression suite now uses a non-loopback HTTP hostname and explicitly checks that the secure-context-only API is absent before exercising Movies, TV Shows, My List, filters and collections. The original failure was reproduced in that environment before applying the repair.

## Seeking and manual previews

- The player keeps a drag's selected position steady until release, instead of allowing playback time updates to overwrite it. Keyboard seeking also commits the chosen position. Resume positioning runs once per stream, and progress is reported after a seek finishes.
- “Watch preview” uses the authenticated playback pipeline for direct play or Jellyfin HLS remuxing/transcoding, at up to 6 Mbps. It plays a 20-second excerpt from the server's media, with sound and native video controls; it is not an externally sourced trailer. Closing, ending or leaving the preview cleans up the stream and any encoding. Preview tickets cannot send watched/resume updates to Jellyfin. Background carousel previews retain their lightweight direct-play path.
- Regression validation uses actual MP4/HLS decoding against simulated Jellyfin. The drag regression fails against the old player (8.4 seconds overwritten with 3 seconds) and passes with the repair. Checks cover forward/backward dragging in direct/HLS playback, keyboard seeking, repeated metadata, preview decoding, cleanup and watch-state isolation. Live server playback still requires a user retry.

## Home and visual polish

- Cards use a green circled check for **On server**, an indigo circled plus for **Discover**, an amber clock for **Requested**, and a blue service mark for **Managed by Seerr**. Text and icons distinguish states independently of color. Managed-by-Seerr does not imply that the viewer has access to the item in Jellyfin.
- Native horizontal/vertical scrollbars use a dark track, rounded accent-colored thumb, hover treatment and no arrow buttons in Chromium/WebKit. Firefox uses the standard scrollbar-color/width styling. Keyboard, wheel and touch scrolling remain native. Forced-color mode uses system colors.
- Home restores the last featured selection and a compressed artwork snapshot from per-user session storage, before the featured refresh finishes. The cache keeps at most eight sanitized titles and one JPEG, expires after an hour and is cleared on sign-out/authentication failure. Stream URLs, credentials and user playback data are never serialized into it. First visits, expired caches and blocked storage use the existing stable loading stage.
- Cached slides remain static until a successful server refresh. A temporary service failure keeps the last frame and retries after 30 seconds. A fresh empty selection or authentication denial removes the snapshot. Hourly refresh retains the selected title when still present.
- Snapshot encoding is bounded to 1280 × 720 and avoids repeatedly recompressing cached JPEGs. Storage errors fall back to metadata-only snapshots or ordinary loading.

## Local validation

`npm run check`, `npm test` and all six browser suites pass in local Playwright Chromium with simulated backends and synthetic media. The Node suite has 31 checks: 30 pass on Windows, with the POSIX filesystem-permission check skipped for Linux CI. The new browser checks hold the featured response open across reload, verify cached title/artwork, refresh/error/empty-result behavior, logout clearing, user isolation, distinct badges, scrollbar styles and mobile width. A screenshot was visually inspected using synthetic artwork.

The container smoke-test asset list includes the new browser modules. Docker/CI validation runs as part of the authorized publication workflow; the local checks below do not establish live service compatibility.

## Server language, browsing, profiles and personal lists

- User-facing media labels now say **On server**, **On this server** and **Server media**, without implying that the viewer owns the host's media. Internal Jellyfin API names retain their original identifiers.
- **Collections** is a horizontal subsection of **Movies**, alongside **All movies**. It is removed from the main sidebar and does not appear under TV Shows. Existing collection deep links remain usable, with Movies highlighted in navigation.
- Search occupies most of the browse toolbar. Small themed sort and direction controls sit beside it; watch/genre/year/server-section filters are in a styled dialog with keyboard-accessible custom option lists and removable active-filter chips. Native select dropdowns are no longer used in that toolbar.
- The upper-right name/photo button opens Profile. The current identity header stays visible while settings load and profile data is prefetched on hover. There is no intermediate “Your account” heading.
- Display names are stored per JellyHub user and shown in the header/profile and native community-review author names. They do not rename the Jellyfin login or overwrite another user's identity. Other Jellyfin clients continue to use Jellyfin's account name.
- Profile photos are read from and written to Jellyfin's own user-image API using the caller's token. Users can upload an image, choose a shared portrait, generate a colored initials avatar, or remove their picture. Existing password controls remain in Profile. JPEG/PNG/WebP uploads are validated and bounded; client uploads are center-cropped to 512 × 512. Existing GIF profile pictures can be read.
- JellyHub creates `/config/profile-pictures` and a short README when the updated app starts. With the default template this maps to `/mnt/user/appdata/jellyhub/profile-pictures`. The host can add PNG/JPEG/WebP choices there (maximum 2 MiB and 4096 × 4096); ordinary users choose from them in Profile. Symlinks, subfolders and unrelated files are ignored. This folder has only been created in isolated local test appdata so far; no Unraid container was changed.
- Maintainerr's collection `mediaServerId` values identify management collections, including inactive collections. Those IDs are saved in appdata, excluded from normal Collections for everyone, and blocked on direct media/image/detail routes for non-admins. Admins have a management-only list under Administration → Maintainerr. The last known IDs remain effective if Maintainerr or config persistence is temporarily unavailable. This changes JellyHub visibility only; it does not delete collections or change Jellyfin's own permissions or other clients.
- My list now includes **Saved favorites** from Jellyfin and **Requested by you** from Seerr, with independent pages, source tabs and a request-status filter. Seerr identity is verified by immutable Jellyfin user ID; both the upstream owner filter and each returned request owner are checked. A response containing another account's requests is withheld. Integration failures retain the other source's results.
- Request cards distinguish approval, requested/queued, processing, active downloading (with percentage when supplied), paused, importing, download issues, available/partial, declined and removed states. Current availability is verified against permitted Jellyfin items; “available in Seerr” does not grant Jellyfin access. An available standard-quality copy does not fulfill a 4K request. Watched/Watching/Unwatched labels and resume progress use that viewer's Jellyfin data; absent/deleted items show unknown watch status instead of inventing history.

### Additional local validation and limits

All seven browser suites pass locally in Playwright Chromium. The Node suite now has 35 checks: 34 pass on Windows, and one POSIX permissions check is reserved for Linux. Tests cover real synthetic PNG/JPEG/WebP photo transfers through the app, shared portraits, unchanged login identity, profile persistence, password API calls, stable loading headings, compact keyboard/mobile filters, Movies-only Collections, management collection exclusion/direct-route denial, review display names, request ownership, download percentages and personal watched/resume states.

Backends are simulated. Live Jellyfin/Seerr/Maintainerr compatibility still requires deployment validation. My list reflects request records retained by Seerr; it cannot reconstruct records deleted from Seerr or watched history already removed from Jellyfin. Download progress depends on Seerr receiving queue information from its configured services.
