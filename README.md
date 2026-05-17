# pwaudio

A headless audio player library for Progressive Web Applications.

## Workspace Structure

```
pwaudio/
├── packages/
│   └── pwaudio/          # The library
│       ├── src/
│       │   ├── index.ts       # Library source
│       │   └── index.test.ts  # Tests
│       ├── tsup.config.ts     # Build config (ESM + CJS)
│       └── vitest.config.ts   # Test config (happy-dom)
├── apps/
│   └── demo/             # Vite + Vanilla TS demo app
│       ├── src/
│       │   └── main.ts        # Demo entry
│       ├── index.html
│       └── vite.config.ts
├── pnpm-workspace.yaml
├── tsconfig.json             # Base TypeScript config
└── package.json              # Workspace root
```

## Recommended PWA Setup

`pwaudio` is built for Progressive Web Apps, but making your audio app **installable** and **offline-capable** requires more than just the library. Here's how to configure your Web App Manifest and service worker based on how your app delivers audio.

### Installability checklist

For browsers to show the install prompt, your app must provide:

- A **Web App Manifest** with `name` (or `short_name`), `icons` (192px + 512px PNG), `start_url`, and `display: standalone`
- A **service worker** with a fetch handler
- **HTTPS** (required for service workers)

### Manifest foundation

Every `pwaudio` app should start with this manifest baseline:

```json
{
  "name": "My Audio App",
  "short_name": "MyAudio",
  "description": "A Progressive Web Audio application",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#632CC7",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

> **Tip:** Include a `maskable` icon — Android uses it for the app shortcut icon. Without one, your icon may be cropped unpredictably.

### Service worker strategy by use case

The manifest makes your app installable. The service worker decides what happens when audio requests hit the network. The right strategy depends entirely on **whether your users replay known tracks or stream new ones**.

#### Single-track player

Your app plays one track at a time (notification sounds, alarm tones, ambient noise). Tracks are known and fixed.

**Service worker:** Cache the app shell. Don't cache audio in the service worker — the `HTMLAudioElement` handles its own buffering for the current track.

```json
{
  "name": "My Tone Player",
  "short_name": "Tones",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#632CC7",
  "background_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

If the track list is truly fixed and small, you can precache audio files alongside the app shell. Otherwise, let the browser handle it.

#### Curated playlists

Your app has playlists of known tracks — users pick what to listen to and may replay tracks across sessions.

**Service worker:** Use a runtime cache for audio with `StaleWhileRevalidate`. This serves cached tracks instantly on replay while checking for updates in the background.

```json
{
  "name": "My Playlist App",
  "short_name": "Playlist",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#632CC7",
  "background_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Runtime cache configuration (Workbox-style, adapt to your tooling):

| Option                       | Recommended            | Why                                                                |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Handler                      | `StaleWhileRevalidate` | Instant playback from cache, fresh copy ready for next visit       |
| `maxEntries`                 | 15                     | ~60–150 MB depending on bitrate; safe for most devices             |
| `maxAgeSeconds`              | `604800` (7 days)      | Long enough for weekly replay, short enough to avoid stale content |
| `cacheableResponse.statuses` | `[0, 200]`             | Only cache successful responses                                    |

> **Persistent storage:** Request `navigator.storage.persist()` to protect the cache from browser eviction, especially on mobile where storage pressure is aggressive. Chrome is more likely to grant this if the user has installed your PWA.

#### Radio / randomly generated playlists

Each session generates a new set of tracks. Users don't choose or replay specific tracks — they hit play and listen.

**Service worker:** Do **not** cache audio in the service worker. Cached tracks from a previous session are unlikely to be played again — the cache churns without benefit, wasting bandwidth and device storage.

```json
{
  "name": "My Radio App",
  "short_name": "Radio",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#632CC7",
  "background_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Let the `HTMLAudioElement` manage its own buffering for the current track. If you need offline support, implement it as an **explicit feature** — let users save specific tracks or sessions to a named cache they control, rather than blindly caching random radio content.

#### Podcast / Audiobook

Long-form audio — episodes run 30 minutes to 10+ hours, and users progress through a file over multiple sessions. A single episode can be 50–200 MB.

**Service worker:** Use a runtime cache, but with different constraints than curated playlists. Users expect an episode to stay cached until they _finish_ it, not until an arbitrary TTL expires.

```json
{
  "name": "My Podcast App",
  "short_name": "Podcast",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#632CC7",
  "background_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Runtime cache configuration (Workbox-style, adapt to your tooling):

| Option                       | Recommended         | Why                                                         |
| ---------------------------- | ------------------- | ----------------------------------------------------------- |
| Handler                      | `CacheFirst`        | Episodes rarely change once published; avoid re-downloading |
| `maxEntries`                 | 5                   | 5 episodes × ~100 MB = ~500 MB; already pushing limits      |
| `maxAgeSeconds`              | `2592000` (30 days) | Episodes are stable; long TTL avoids unnecessary re-fetches |
| `cacheableResponse.statuses` | `[0, 200]`          | Only cache successful responses                             |

> **Key difference from curated playlists:** Time-based eviction (`maxAgeSeconds`) is a rough proxy here. For a better UX, your app should actively manage the cache — remove finished episodes and keep in-progress ones, rather than relying solely on LRU or TTL. Use the Cache API directly (`caches.open('audiobook-cache')`) for this.
>
> **Persistent storage is essential.** A single audiobook chapter can exceed Chrome's default eviction threshold. Request `navigator.storage.persist()` on app load.

#### Hybrid (curated library + radio)

Your app has both user-owned content (saved tracks, playlists) and generated content (radio, discover feeds). Most real-world audio apps work this way.

**Service worker:** Route audio requests to different strategies based on the source. Audio from the user's library is cached; radio content is not.

```json
{
  "name": "My Music App",
  "short_name": "Music",
  "display": "standalone",
  "start_url": "/",
  "theme_color": "#632CC7",
  "background_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

The trick is **routing**: different audio URLs need different strategies. Options:

- **By origin:** cache audio from `cdn.yourapp.com` (user library), pass through `radio-api.yourapp.com`
- **By URL pattern:** cache `/library/` paths, ignore `/radio/` paths
- **By request header:** have your client add a custom header (e.g., `X-Cache-Strategy: library`) and branch in the service worker's `fetch` handler

Example service worker routing (conceptual):

```js
// Library tracks — cache for replay
registerRoute(
  ({ url }) => url.pathname.startsWith('/library/'),
  new StaleWhileRevalidate({ cacheName: 'library-cache', ... })
);

// Radio streams — don't cache
registerRoute(
  ({ url }) => url.pathname.startsWith('/radio/'),
  new NetworkOnly()
);
```

> **Tip:** If your API doesn't distinguish library vs. radio URLs, consider adding a query parameter or custom header so the service worker can route intelligently. Routing by file extension alone (`.mp3`) isn't enough when both contexts serve the same file types.

### HTML meta tags

Regardless of pattern, include these in your `<head>` for full PWA support across browsers:

```html
<meta name="theme-color" content="#632CC7" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="pwaudio" />
```

### Caching cost reference

Audio files are large. Know your storage budget before choosing a strategy:

**Music / radio** (per 4-minute track):

| Quality | Bitrate  | ~Size per track | 5 tracks | 15 tracks | 50 tracks |
| ------- | -------- | --------------- | -------- | --------- | --------- |
| Low     | 128 kbps | ~4 MB           | ~20 MB   | ~60 MB    | ~200 MB   |
| Medium  | 256 kbps | ~8 MB           | ~40 MB   | ~120 MB   | ~400 MB   |
| High    | 320 kbps | ~10 MB          | ~50 MB   | ~150 MB   | ~500 MB   |

**Podcast / audiobook** (per episode):

| Length  | ~Size per episode | 5 episodes |
| ------- | ----------------- | ---------- |
| 30 min  | ~30 MB            | ~150 MB    |
| 1 hour  | ~60 MB            | ~300 MB    |
| 2 hours | ~120 MB           | ~600 MB    |
| 5 hours | ~300 MB           | ~1.5 GB    |

Browsers typically allow **50–100 MB** of storage before risking eviction. Chrome on Android starts as low as **~20 MB** for non-persistent storage. Request persistent storage (`navigator.storage.persist()`) when caching more than a handful of tracks.

## Commands

| Command          | Description                   |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Start the Vite demo app       |
| `pnpm build`     | Build all workspace packages  |
| `pnpm test`      | Run tests across all packages |
| `pnpm typecheck` | Type-check all packages       |

## Development

```sh
# Install dependencies
pnpm install

# Start the demo app with hot reload
pnpm dev

# Run tests in watch mode
pnpm -C packages/pwaudio test:watch
```
