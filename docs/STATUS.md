# Repository audit and validation

Audit date: 2026-11-13. This is a development preview, not a complete Jellyfin Web replacement.

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

Local commands: `npm run check`, `npm test`, `npm run test:browser`. Seven Node checks pass. Browser checks pass in headless Microsoft Edge using API mocks. CI uses Chromium. Docker is unavailable on the development machine; the workflow's container smoke test verifies health, assets, anonymous API denial, UID 1000, writable storage and settings surviving container recreation before pushing.

## Still incomplete

- Playback, direct play, transcoding, subtitles, audio selection and playback reporting.
- Full library browsing/pagination (currently capped at 60 items), series/episode navigation and general search (the current Search page searches movies).
- Prefetching, request deduplication, optimistic mutations and persistent media caching. There is only a short-lived in-memory response cache and lazy image loading.
- Jellystat analytics; its current connection test checks HTTP reachability only.
- Bazarr, Lidarr, Prowlarr and SABnzbd adapters; these services remain independent.
- Seerr request submission, integration mutations and an administrator permission editor. Current integration views are read-only.
- Native extensions and Jellyfin plugin compatibility.
- Automated session cleanup, distributed sessions, a production security audit, and robust offline/reconnect UX.
- Live Jellyfin 12.4.0.0, Maintainerr and other integration validation. No existing backend container was contacted or changed during local tests.

Do not expose this preview publicly. Changing the saved Jellyfin URL to an unreachable address can prevent login; correct `jellyfinUrl` in `/config/settings.json` while JellyHub is stopped, then restart JellyHub. Corrupt settings cause a visible startup failure instead of silently discarding credentials.
