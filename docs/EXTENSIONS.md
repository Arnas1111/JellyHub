# Native extensions, API v1

JellyHub has its own DOM and player. Existing JavaScript Injector scripts, Enhanced web-bundle patches and Plugin Pages HTML are not automatically executable here. Backend metadata/artwork plugins stay installed in Jellyfin.

Reviewed native browser modules can be shipped under `public/extensions/` and listed by absolute `/extensions/name.js` path in `public/extensions/manifest.json`. Rebuild the image after adding them. No arbitrary remote script loader or runtime upload is enabled. Native modules run with the signed-in user's browser privileges; administrator endpoints still recheck the account on the server.

```js
export function register({registerPage}) {
  registerPage({
    id: 'extension-example', title: 'Example', role: 'all',
    mount({root, api, user, escapeHTML, navigate, onItem, onPlay}) {
      const heading = document.createElement('h1');
      heading.textContent = 'Hello ' + user.name;
      root.replaceChildren(heading);
      // Return cleanup for listeners, timers, media and pending requests.
      return () => root.replaceChildren();
    }
  });
}
```

`role` is `all` or `admin`. IDs begin with `extension-` and contain lowercase letters, digits and hyphens. Titles are at most 40 characters. `mount` is synchronous and returns an optional cleanup function; manage asynchronous work inside it and cancel it on cleanup. `api` accesses JellyHub's authenticated API, never Jellyfin tokens or integration keys. `onItem(id)` opens local details and `onPlay(id, ticks)` opens playback. Remote service APIs need explicit server adapters.

Administration → Navigation stores up to 20 HTTP(S) links in `/config/settings.json`, with user/admin visibility. These open a separate tab with `noopener,noreferrer`; each independent service enforces its own authentication. Navigation visibility does not grant service access.

Administration → Plugins reports installed versions and planned/native handling. Native MediaSegments support Intro Skipper and SkipMe.db data. The optional Enhanced review adapter resolves TMDb identity from a permitted Jellyfin item and uses the caller's Jellyfin token, preserving the plugin's review privacy checks. Full compatibility with the supplied plugin versions requires live verification.
