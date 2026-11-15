# JellyHub

An independent, modern Jellyfin frontend development preview. Existing Jellyfin and media-management containers stay independent. Full video playback now uses Jellyfin’s playback negotiation, direct streams and HLS. This remains a development release until live-server and remaining feature-parity checks are complete.

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

The favicon is also displayed next to the sidebar name. An optional separate PNG logo (up to 2048 × 2048 pixels and 2 MiB) can be uploaded under Branding; resetting it restores the favicon. A 512-pixel image already has ample resolution for the small sidebar mark. Favicon URLs use the correct SVG/PNG/ICO extension and the sidebar uses its own image endpoint.

The sign-in card centers that logo and name, keeps account help behind the corner information icon, and offers a gray Register link. **Administration → Registration** configures registration and rotating login artwork. Select the server sections for new accounts and public artwork, enable the desired options, and save. This creates a dedicated Jellyfin service API key stored only in `/config/settings.json`; no additional environment variables are needed. Registration starts disabled until this setup is complete. Selected artwork becomes visible before sign-in, so choose its source sections accordingly. Login artwork uses up to eight bounded images, a shared one-hour server cache, and 20-second crossfades; reduced-motion mode uses a static image.

Visitors register with a new username, password and the current **20-character registration key**, containing random letters and symbols. Administrators can view/copy the key and regenerate it immediately. It expires after 24 hours, persists across restarts, and rotates automatically; old keys stop validating at expiry. Registration is rate-limited and uses constant-time key comparison. New accounts are created with an unknown temporary password, assigned the configured default permissions and chosen password, and then finalized. Administration → Registration lets the administrator choose default Jellyfin permissions, server-section access, Requests and Active Streams access, and whether activation is required. These defaults affect future registrations only. JellyHub imposes no username pattern or password-length/complexity requirement; short and blank passwords are forwarded unchanged. Existing usernames are rejected without creating an account. Jellyfin may still reject values its own account store cannot accept. Failed setup attempts remove the newly created account when possible. Existing accounts are not altered. Seerr accounts are not created automatically; requesting requires the usual Seerr account mapping and an administrator granting Requests access.

**Users** lists existing Jellyfin accounts. Select an account to rename it, adjust administrator/disabled/hidden flags, playback/download/transcoding permissions, remote access and allowed libraries. Rename and permission changes are separate actions. Existing unexposed policy and configuration fields are preserved. The editor blocks disabling or demoting the current account and rejects removal of the last enabled administrator. Account deletion, administrator password resets and advanced parental controls are not included in this editor. Key-protected account creation is configured separately under Registration.

The selected user's **JellyHub features** form separately toggles **Requests** and **Active Streams**, persisted in `/config/settings.json`. Requests is enabled by default for existing users; Active Streams is disabled until granted. Administrators inherit both. Disabling Requests blocks its page, request submission and catalog/discovery APIs, while local Jellyfin search and favorites remain available. Active Streams is read-only and respects the caller's Jellyfin session and media visibility; it does not grant administration or remote control. Refresh the browser after a permission change to update navigation; API enforcement takes effect immediately.

**Active Streams** is always visible in navigation, with a dark number inside a small orange notification badge that refreshes every 15 seconds. Users without stream permission can see the count but cannot open the details. The count response contains no media/user/session details; its scope follows sessions visible to the caller in Jellyfin. The badge is hidden when there are no active streams or the count is unavailable.

The sidebar also shows **Online** users with profile pictures or initials, status dots and watching/paused activity. Multiple devices are grouped into one person, and JellyHub display names are used. Playback titles and links require Active Streams permission and access to the item; otherwise the row only says Watching or Paused. The list refreshes every 15 seconds while visible. Connections with no observed activity for two minutes become Away and disappear after five minutes, rather than treating every unexpired login cookie as online. These are observed activity states, not exact websocket presence. Mobile uses a horizontally scrollable member list.

Presence combines recent JellyHub sessions with Jellyfin sessions. The dedicated service connection created by Registration setup, when available, allows read-only server-wide session discovery. Without it, administrators can see the native sessions Jellyfin returns, while ordinary users see recent JellyHub members plus their permitted native sessions; a scope hint is shown for partial results. Session data is cached briefly, and only sanitized names/status/avatar links and permitted playback titles are sent to the browser. No session tokens, network addresses, emails or playback paths are exposed. This feature does not grant remote-control or administrator privileges.

Enabled accounts without recent activity also appear in a grayed-out **Offline** group, with muted names and grayscale avatars. The account directory is cached for 30 seconds, and disabled accounts are excluded. When Jellyfin restricts session visibility or session status cannot be checked, other known accounts appear under **Other users** with unavailable status instead of being falsely marked offline.

**Chat** is a shared plain-text room for signed-in users. Messages update every three seconds while the page is visible. Press Enter to send or Shift+Enter for a new line. The latest 200 messages persist in `/config/chat.json`; each message can contain up to 1,000 characters. Users can delete their own messages, and administrators can delete any message. This is shared history visible to everyone signed in. Failed sends retain the draft and retry identifier, and chat drafts survive in-app navigation and are cleared on logout. Posting is rate-limited and retries do not duplicate a retained message. A corrupt or unwritable history file produces a visible error rather than silently discarding messages. No additional container, service or environment variable is required.

**Requests** has **All Requests** and **My Requests** tabs, active downloads with progress/ETA/size, requester names, status filters, coming-soon dates and playable links to accessible media. My List contains saved Jellyfin favorites and personal watch progress. All Requests requires Seerr's administrator, manage-requests or view-requests permission; other users receive only their own history. Downloads depend on queue information supplied by Seerr, and unknown ETA/size remain unknown. Coming-soon scans are bounded and use continuation pages; downloads cover the latest 100 processing requests. Both Requests and Active Streams refresh every 15 seconds while the page is visible. No plugin installation or additional environment variables are required.

## Home, universal search and requests

Home has a central movie/show search and Seerr-powered popular movie and TV rows above your Jellyfin library. These are popularity-based recommendations, not personalized recommendations. Search queries both the current user's Jellyfin library and Seerr's catalog, with separate **In your library** and **Discover & request** results. Where TMDB provider IDs match, catalog tiles open the accessible library item. A failed backend is reported without discarding results from the other backend.

Search stays on Home; there are no separate Search or Music sidebar entries. Movies highlights gold on hover and TV Shows highlights blue. Home's featured carousel selects up to eight distinct accessible library titles, prioritizing matches to Seerr's popular movies/shows and filling remaining places from top-rated library titles. Its order is stable within each hourly window and is refreshed near the next hour.

The carousel occupies its full space from the first Home render, including during loading and failures. Artwork blends into the page without a rounded card edge. Titles swipe horizontally after approximately 20 seconds of unpaused time. Eight dot controls (or fewer when fewer titles are available) identify the active title and allow direct selection; a bottom progress bar shows the remaining interval. Hover pauses both rotation and video and resumes the remaining time on leave. There are no arrow/pause buttons or preview captions. Hidden/offscreen previews pause and navigation releases their streams. Reduced-motion disables the swipe animation and automatic video; data saver disables video previews.

Movies and TV Shows each have their own **Continue watching** row, using movie and episode resume data respectively. Cards display watch-progress bars. Local detail pages include backdrop artwork, ratings, genres, runtime, synopsis, cast/crew, studios, stream information, similar titles, Maintainerr countdowns and season/episode browsing. Only the current user's accessible items are requested; file paths are not included in the new detail response.

### Full player

**Play**, **Resume** and **Play from beginning** open the native player. Jellyfin decides the available media versions, direct-play support and HLS remux/transcoding URLs. HLS.js is bundled locally and loaded only when needed; no CDN dependency is required. The player includes seeking, audio/subtitle/version/quality selection, playback speed, fullscreen, picture-in-picture, chapter navigation, bookmarks, native MediaSegments skip buttons, a season-aware episode drawer and an optional next-episode countdown. Natural completion, navigation and stream changes report stop and clean up the owned transcoder. Stale tickets expire after missed heartbeats.

Jellyfin access tokens and stream URLs stay server-side. Browser media URLs are session-bound. The proxy validates every playlist resource, supports byte ranges, rejects external URLs and rechecks user/item playback access. VOD seeking uses an absolute timeline; the player seeks after negotiation instead of applying a second timestamp offset to HLS segments.

Click your account name for durable per-user playback preferences, subtitle size/color/position, spoiler protection, auto-pause/resume, intro/outro skip preferences, bookmarks, hidden titles, Jellyfin audio/subtitle languages and password changes. Preferences/bookmarks are stored in the dedicated appdata configuration; playback progress/favorites/watched state belong to Jellyfin.

Movies and TV Shows support permitted library selection and 48-title pages, title/date/rating/year/random sorting, genre/year/watch-state filters and Continue Watching. **My list** uses Jellyfin favorites; **Collections** opens permitted box sets. The card menu exposes favorite, watched and hide actions. Native Next Up is shown on Home. Hidden titles are omitted from browsing/home recommendation rows, while direct search still finds accessible hidden titles. Season details and the episode drawer page long seasons. Detail My list/watched buttons update optimistically and roll back failed saves. Local details link cast members to their permitted library titles. Deep links and browser Back/Forward preserve navigation. Response caches are bounded and deduplicate requests; pointer hover prefetches details after a short delay with bounded concurrency. Static assets negotiate Brotli/gzip and use ETags to reuse unchanged files; HLS.js remains lazy-loaded.

**Administration → Navigation** configures service links with role visibility. **Plugins** lists actual installed versions and the handling of every requested plugin. Native extension registration is documented in [EXTENSIONS.md](docs/EXTENSIONS.md). The optional Jellyfin Enhanced review adapter uses the caller's permissions and local TMDb identity. Original DOM-injection scripts need porting; full Enhanced feature parity is not claimed.

The automated player tests decode synthetic H.264/AAC MP4 and HLS fixtures through the real JellyHub proxy against a simulated Jellyfin API. They cover resume, segment skip, subtitles, audio/quality changes, progress/stop, natural completion, episode navigation and mobile controls. They do not establish real-server transcoding, HDR, browser/device codec support or compatibility with the supplied plugin versions. Live TV/open-required sources, SyncPlay, casting and offline downloads remain unsupported.

### Preview compatibility

Previews currently use direct play for H.264 MP4/M4V with AAC/MP3 audio, and VP8/VP9 WebM with Opus/Vorbis audio. HDR, 10-bit, remote/live/open-required sources, unsupported codecs/containers and sources above 20 Mbps fall back to artwork. Browser support and autoplay policy also affect availability. Series previews use an accessible episode. The detail page offers an explicit **Watch preview** button.

Background carousel previews use a lightweight direct-play path. Manual **Watch preview** uses the authenticated playback pipeline, including Jellyfin HLS remuxing/transcoding when needed, and plays a 20-second excerpt. Preview tickets cannot send watched/resume updates; ending, closing or navigating away cleans up any encoding. Full playback reports watch progress separately. Access tokens remain server-side. Compatibility with the user's real files still requires deployment validation; browser tests decode synthetic MP4/HLS media against simulated Jellyfin APIs.

Open a discovery title to request a movie or select TV seasons. Requests use standard quality and Seerr's default server/profile settings. Seerr enforces quotas, approval rules and request permissions. JellyHub resolves the signed-in account by immutable Jellyfin ID, verifies impersonation through `/auth/me`, and sends `X-Api-User` on discovery and request calls. It never accepts a browser-supplied request owner or falls back to the API key's administrator identity. Users need an existing matching Seerr account: sign into Seerr once with Jellyfin, or have an administrator import the account there. Discovery/request failures explain missing configuration or mapping. Live service compatibility has not been verified.

Universal search pages both backends; Home discovery rows currently show the first popular-results page. Movies/shows already accessible to the user are identified through Jellyfin provider IDs; incomplete metadata can prevent automatic matching. Discovery artwork is proxied from TMDB through a fixed, validated image endpoint.

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
