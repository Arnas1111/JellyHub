# JellyHub completion and compatibility work

Working requirements, updated 2026-11-14. Checkmarks require implementation plus relevant automated contract/browser tests, which may use simulated backends; they do not mean live compatibility. Live-server verification is a separate acceptance gate; this workspace has no supplied Jellyfin test-server connection.

## Preserve the accepted direction

- Independent Unraid XML container on `docker_external`, port 3100 → 3000, `/config` persistence. Never reconfigure existing backend containers.
- Home-only universal search; no separate Search or Music navigation.
- Cinematic presentation; eight-title carousel with dots, 20-second swipe/progress, hover pause, stable first-render layout and no preview captions/arrow buttons.
- Favicon/sidebar logo, configurable name/title/greeting/accent, web administration, service-specific horizontal tabs and readable diagnostics.
- User-scoped media and request permissions. Integration keys remain server-side.
- Maintainerr countdowns on cards/details, Seerr discovery/requests, existing integration status/queues.

## Playback acceptance

- [x] Full direct playback with range seeking and resume.
- [x] HLS remux/transcode through Jellyfin's negotiated playback URLs, with native HLS or lazy-loaded HLS.js.
- [x] Private, session-bound media/playlist/segment/subtitle proxy; no exposed Jellyfin tokens or arbitrary upstream URL proxy.
- [x] Start/progress/pause/stop reports, transcoder cleanup, watched/resume updates and disconnect cleanup.
- [x] Audio tracks, subtitles including text conversion and burn-in fallback, quality selection, playback rate and volume.
- [ ] Fullscreen, picture-in-picture, keyboard/remote controls, mobile controls and useful recovery errors.
- [x] Chapters, timeline information, episode drawer, next episode and end-of-episode countdown.
- [x] Intro/recap/outro/commercial segments and configurable automatic/manual skipping.
- [x] Per-user playback preferences, bookmarks, spoiler protection and pause presentation.

## Core web parity

- [ ] Pagination, sorting, filters, library views, collections, favorites, watched toggles and Next Up.
- [ ] Rich local/catalog details, versions/extras, cast/person navigation, trailers where available and related titles.
- [x] User profile/preferences and account security controls.
- [ ] Administrator users, library controls/status, scheduled jobs, sessions, plugin inventory/configuration and service integrations.
- [ ] Error/offline states, request cancellation/deduplication, bounded caches, prefetching and responsive/accessibility checks.
- [ ] Live TV, recordings, SyncPlay, casting and offline downloads require explicit verification before parity is claimed.

## Requested plugins

| Plugin / supplied version | Handling and verification |
| --- | --- |
| AudioDB 12.4.0.0 | Keep server-side metadata provider; consume resulting Jellyfin metadata. No Music section is reintroduced. |
| Custom Tabs 0.3.3.0 | Native configurable navigation/pages with role controls. |
| File Transformation 3.0.3.0 | Keep backend plugin; do not patch or depend on the original web bundle. |
| InPlayerEpisodePreview 2.5.0.3 | Native in-player episode drawer and navigation. |
| Intro Skipper 12.0.6.0 | Native Jellyfin MediaSegments read/skip controls; verify provider results live. |
| JavaScript Injector 4.1.0.0 | Native extension API and registration; arbitrary old DOM-injection scripts are not assumed compatible. |
| Jellyfin Enhanced 12.15.0.0 | Native feature inventory below, with optional backend adapters where appropriate. |
| ListenBrainz Similarity Provider 12.4.0.0 | Keep backend provider; consume available server metadata/recommendations. |
| MusicBrainz 12.4.0.0 | Keep backend metadata provider. |
| OMDb 12.4.0.0 | Keep backend metadata provider. |
| Plugin Pages 3.0.3.0 | Native page registry and compatibility inventory; original web-hosted pages need an explicit adapter. |
| SkipMe.db 0.2.6.0 | Uses native MediaSegments when the backend provider is enabled. |
| Studio Images 12.4.0.0 | Keep backend artwork provider; expose permitted studio art. |
| TMDb 12.4.0.0 | Keep backend metadata provider; use catalog metadata through Seerr. |

## Jellyfin Enhanced feature inventory to account for

- Request/discovery: movie/season and 4K requests; profile/server/folder options; quota; approvals; year-qualified search; recommendations; entity browsing; watchlist; issues; TVDB matching; optional request automation.
- Display: quality/HDR/audio/subtitle/media-status tags, configurable layouts, rating/award/logo tags, stream/version-aware details, audio languages, release dates, progress/file information and external links.
- Personal browsing: spoiler guards; hidden content/home-row controls; random selection; Catch Up; bookmarks; release calendar; remembered filters.
- Playback: skip segments; bookmarks; auto-pause/resume; subtitle appearance; hold-to-speed; playback metadata; episode browsing; keyboard shortcuts.
- Household: reviews/ratings, recent activity, active streams with permission checks, profile imagery and mobile behavior.
- Administration: defaults/policies, Seerr user matching, service links/tests, maintenance banner/countdown, branding/themes, CSS/extension hooks and localization.

Reference implementations were inspected to identify behavior, not copied as claims of compatibility. Source references: [Enhanced feature documentation](https://n00bcodr.github.io/Jellyfin-Enhanced/enhanced/enhanced-features/), [Jellyfin API controllers](https://github.com/jellyfin/jellyfin/tree/master/Jellyfin.Api/Controllers), [InPlayerEpisodePreview](https://github.com/Namo2/InPlayerEpisodePreview), [Intro Skipper](https://github.com/intro-skipper/intro-skipper), [SkipMe.db provider](https://github.com/intro-skipper/skipme.db-plugin).

## Release evidence

The carousel refinement is commit `8b19a07`; its CI application/browser/clock/XML/container/publish jobs passed. Subsequent work must keep that behavior covered. Do not label the overall product finished until the unresolved parity and live verification gates are closed.
