# Repository audit and validation

Audit date: 2026-11-13; Connections and permission fixes updated 2026-11-14. This is a development preview, not a complete Jellyfin Web replacement.

## Findings and repairs

The initial checkout contained only the Node server and deployment documentation. The frontend, GitHub Actions workflow and Unraid template existed inside an uploaded ZIP but were absent from the source tree. Docker's `COPY public` therefore failed, `/` returned 404, and there was no publishing workflow to run. The ZIP's frontend also lacked the newer server's settings interface, and its template lacked persistent storage.

Restored the frontend as source, added Connections settings, replaced the outdated deployment template and workflow, and removed the duplicate ZIP and Compose example. Docker now copies actual frontend files, runs as UID 1000, provides a health check and uses `/config`. CI tests the application and browser, validates XML, builds and smoke-tests an isolated image, then publishes `dev` and a commit tag to GHCR on main/dev pushes. Pull requests test without publishing.

Other fixes: static assets resolve relative to the server file instead of the shell directory; malformed JSON returns 400; oversized bodies return 413; every admin endpoint rechecks Jellyfin authorization; image requests check user item access; image caching varies by session and requires revalidation; late navigation responses cannot overwrite the current page; logout clears media/countdown caches; late requests cannot populate another user's cache.

## Implemented and tested with mocks

| Area | Evidence | Limits |
| --- | --- | --- |
| Startup, health and static assets | Node integration tests; launch from another working directory | Local Node 22 on Windows; Linux container verification runs in CI |
| Jellyfin login/logout and user-scoped media API | HTTP tests with a fake Jellyfin server | No live Jellyfin version compatibility claim |
| Home, media details, user navigation and mobile width | Headless browser tests with intercepted API responses | Real libraries, artwork and devices not tested |
| Admin authorization, including revoked admin sessions | HTTP tests | Inherits actual Jellyfin policy enforcement |
| Connections settings and API-key handling | Browser save/test flow; HTTP redaction, validation, clear/preserve key and restart tests | Keys are plaintext in protected appdata; UI test uses mock responses |
| Seerr requests and Sonarr/Radarr queues | HTTP adapter tests and header assertions | Not tested against live services |
| Maintainerr card/detail countdowns | Browser detail test; HTTP date arithmetic, cache, inactive collection and user item filtering tests | Existing overlay API/action assumptions require live validation |
| Unraid XML | XML contract check in CI; local PowerShell parsing | No install on the user's Unraid server |

Local commands: `npm run check`, `npm test`, `npm run test:browser`. The expanded suite has 20 Node checks; 19 pass on Windows and the POSIX permissions test runs on Linux CI. Browser checks pass in headless Microsoft Edge using API mocks and a generated WebM video. A separate browser-clock suite verifies carousel timing. CI uses Chromium. Docker is unavailable on the development machine; the workflow's container smoke test verifies health, assets, anonymous API denial, UID 1000, writable storage and settings surviving container recreation before pushing.

The Connections update tests current form fields without saving, distinguishes missing keys from rejected keys, normalizes key whitespace, supports service URL bases, aligns clear-key controls and colors results. Structured, configurable logging includes safe endpoint/status/timing diagnostics and request IDs while excluding credentials and response bodies. Tests cover 401s, missing keys, non-JSON login pages, redirects, network failures, log filtering, persistence, and failed-save input preservation. Corrupt JSON startup errors omit file contents.

The Docker entrypoint now starts briefly as root, initializes ownership of only the config directory and settings file, then drops to the runtime UID/GID. Container tests reproduce root-owned appdata, verify permission repair without recursively changing a nested directory, verify custom UID/GID and mode 0600 settings, and reject read-only mounts. No live Unraid permission repair or Sonarr/Radarr connection is claimed from mock tests.

## Administration, branding and discovery update

Administration now has horizontal General, Users, Branding and individual service tabs; the separate Connections sidebar entry and top “Your Media Universe” label are removed. Each service saves only its own settings, and queue/request views fetch only the selected service. Branding includes browser title, sidebar text, Home greeting, accent color and PNG/ICO favicon upload/reset, all persisted in settings. HTTP tests verify branding/favicon survive restart and concurrent settings saves preserve unrelated fields.

Existing Jellyfin accounts can be renamed and have common policy flags and library access changed. Policy updates preserve fields not exposed by the editor; renaming preserves the user's configuration. Self-disable/self-demotion and last-administrator removal are blocked. Role checks cover the new endpoints and revoked administrator sessions. These mutations were tested against mocks, not real user accounts.

Home now includes universal search and popular movie/show discovery from Seerr. Search combines user-scoped Jellyfin results with Seerr catalog results, deduplicates matching accessible titles by TMDB IDs, and retains partial results on backend failure. Movie and selected-season requests use the matching Seerr account via verified `X-Api-User` impersonation, with server-side permission checks and Seerr enforcing quotas/approval. No automatic account import or administrator fallback occurs. These are popularity-based recommendations, not personalized recommendations.

Mock-based tests cover identity mismatch, missing Seerr accounts, permission denial, quota failures, season validation, malicious request-owner fields, response redaction, branding validation, unsupported favicon types, policy/configuration preservation, horizontal/mobile layout, detail poster clipping and end-to-end movie/TV request UI. Live Jellyfin/Seerr compatibility remains unverified.

## Cinematic browsing and direct previews

Search is now part of Home only. The sidebar/sign-in brand displays its favicon or an optional separate PNG logo. Logo persistence and image serving are covered by HTTP tests, and the browser verifies the default image actually decodes. Default/custom favicon URLs use matching image extensions.

Home has an hourly-shuffled carousel from accessible popular library matches, with a top-rated-library fallback. It rotates titles every 20 seconds and supports muted direct-play previews, manual controls, reduced-motion/data-saver behavior and pause/cleanup on visibility/navigation changes. Continue Watching rows are filtered to movies or TV episodes. Local details now include ratings, genres, technical information, cast/crew, similar titles and seasons/episodes. Seerr detail artwork/metadata use the same cinematic presentation.

Server tests verify hourly selection, library filtering, details/episode queries, forbidden items, playback-policy checks, range forwarding, short-lived session-bound preview tickets and token/file-path redaction. Browser tests generate a small WebM with MediaRecorder and verify actual decoding/current-time advance, carousel controls, detail previews, season changes and logo upload. These are contract/UI tests, not live media-server validation.

Preview support is deliberately limited to compatible direct-play MP4/M4V (H.264/AAC or MP3) and WebM (VP8/VP9 with Opus/Vorbis), SDR up to 8-bit and 20 Mbps. Other files use artwork. Preview requests disable transcoding/remuxing/live-stream opening and do not send watch-progress reports. No claim is made that arbitrary Jellyfin files will preview successfully.

## Carousel interaction refinement

The featured pool now contains up to eight unique titles, retaining accessible popular matches and filling spare places from the user's top-rated library. Music navigation is removed. Movies and TV Shows have gold and blue hover colors respectively.

The carousel uses a fixed-height stage in its initial markup, with stable loading/empty/error states. Frameless artwork fades into the surrounding page. The previous arrow/pause buttons, numerical counter and preview captions are removed. Custom dot controls show the active title. A bottom progress line tracks a 20-second interval, pausing alongside the video on mouse hover and resuming from the same point. The image, video and title content move together in a horizontal transition. Reduced-motion uses instant changes and disables automatic video.

Browser tests hold the featured API response to check that loading causes no layout shift, exercise all eight dots and an animated transition, verify actual video hover-pause, navigation removal/colors and generated-video decoding. The controlled-clock test advances time through 20 seconds, a 40-second hover pause and the remaining interval, and checks progress reset and stable failure geometry. Detail-view behavior is unchanged in this refinement.

## Still incomplete

- Full-length playback, remux/transcoding preview support, subtitle/audio selection and playback reporting. Short compatible direct-play previews are implemented.
- Full library browsing/pagination (currently capped at 60 items), discovery/search pagination and episode pagination beyond the first 100 episodes in a season. Universal search covers movies and shows on the first results page.
- Prefetching, request deduplication, optimistic mutations and persistent media caching. There is only a short-lived in-memory response cache and lazy image loading.
- Jellystat analytics; its current connection test checks HTTP reachability only.
- Bazarr, Lidarr, Prowlarr and SABnzbd adapters; these services remain independent.
- Advanced Seerr request options (4K, server/profile selection and request management), account creation/deletion/password resets and advanced parental controls. Sonarr/Radarr queue views remain read-only.
- Native extensions and Jellyfin plugin compatibility.
- Automated session cleanup, distributed sessions, a production security audit, and robust offline/reconnect UX.
- Live Jellyfin 12.4.0.0, Maintainerr and other integration validation. No existing backend container was contacted or changed during local tests.

Do not expose this preview publicly. Changing the saved Jellyfin URL to an unreachable address can prevent login; correct `jellyfinUrl` in `/config/settings.json` while JellyHub is stopped, then restart JellyHub. Corrupt settings cause a visible startup failure instead of silently discarding credentials.
