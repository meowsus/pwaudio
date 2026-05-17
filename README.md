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

### Web App Manifest

Create a `manifest.webmanifest` and link it from your HTML (`<link rel="manifest" href="/manifest.webmanifest" />`). Every `pwaudio` app should start with this baseline:

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

### Service worker foundation

All strategies below share the same app shell precaching and activation logic. Register your service worker from your app:

```js
// app.js — register the service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
```

Each strategy section shows only the `fetch` handler you need. The install and activate handlers are the same for every use case — put these in every `sw.js`:

```js
// sw.js — shared by all strategies
const SHELL_CACHE = "app-shell-v1";
const SHELL_ASSETS = ["/", "/index.html", "/styles.css", "/app.js"];

// Precache the app shell on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
});

// Clean up old shell caches on version change
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("app-shell-") && key !== SHELL_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

// Helper: does this request belong to the app shell?
function isShellRequest(request) {
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    (request.mode === "navigate" || SHELL_ASSETS.includes(url.pathname))
  );
}
```

Change `SHELL_CACHE` to `app-shell-v2`, `v3`, etc. when you update precached assets — the activate handler removes old caches automatically.

### Choosing a caching strategy

The manifest makes your app installable. The service worker decides what happens when audio requests hit the network. The right strategy depends on **whether your users replay known tracks or stream new ones**.

#### Single-track player

Your app plays one track at a time (notification sounds, alarm tones, ambient noise). Tracks are known and fixed.

**Strategy:** Cache the app shell. Don't cache audio — the `HTMLAudioElement` handles its own buffering for the current track.

```js
// sw.js — fetch handler for a single-track player
self.addEventListener("fetch", (event) => {
  // App shell: cache-first
  if (isShellRequest(event.request)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // Audio and everything else: network only
  // Let the browser's built-in media buffering handle playback
});
```

If the track list is truly fixed and small, you can precache audio files by adding them to `SHELL_ASSETS`.

#### Curated playlists

Your app has playlists of known tracks — users pick what to listen to and may replay tracks across sessions.

**Strategy:** Stale-while-revalidate for audio. Serve cached tracks instantly on replay, then update the cache in the background so the next visit gets a fresh copy.

```js
// sw.js — fetch handler for a curated playlist app
const AUDIO_CACHE = "audio-playlist-v1";

self.addEventListener("fetch", (event) => {
  if (isShellRequest(event.request)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  if (isAudioRequest(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request, AUDIO_CACHE));
    return;
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Update cache in the background regardless of whether we had a cache hit
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
      evictIfNeeded(cacheName, {
        maxEntries: 15, // ~60–150 MB depending on bitrate; safe for most devices
        maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days — long enough for weekly replay
      });
    }
    return response;
  });

  // Return cached response immediately, or wait for network if not yet cached
  return cached || fetchPromise;
}
```

The two helper functions every runtime cache strategy needs:

```js
// Enforce size and age limits on a cache
async function evictIfNeeded(cacheName, { maxEntries, maxAgeSeconds }) {
  const cache = await caches.open(cacheName);
  const now = Date.now();

  // Remove expired entries
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    const dateHeader = response.headers.get("date");
    if (
      dateHeader &&
      now - new Date(dateHeader).getTime() > maxAgeSeconds * 1000
    ) {
      cache.delete(request);
    }
  }

  // Enforce max entries (cache.keys() returns insertion order — oldest first)
  const keys = await cache.keys();
  while (keys.length > maxEntries) {
    cache.delete(keys.shift());
  }
}

// Adapt this predicate to match your audio URLs
function isAudioRequest(request) {
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    /\.(mp3|m4a|ogg|wav|flac|aac)$/.test(url.pathname)
  );
}
```

#### Radio / randomly generated playlists

Each session generates a new set of tracks. Users don't choose or replay specific tracks — they hit play and listen.

**Strategy:** Do **not** cache audio. Cached tracks from a previous session are unlikely to be played again — the cache churns without benefit, wasting bandwidth and device storage.

```js
// sw.js — fetch handler for a radio app
self.addEventListener("fetch", (event) => {
  if (isShellRequest(event.request)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // Audio and everything else: network only
  // Let HTMLAudioElement manage its own buffering for the current track.
});
```

If you need offline support, make it an explicit feature — let users save specific tracks or sessions to a named cache they control, rather than blindly caching random radio content. See [Persistent storage](#persistent-storage) below.

#### Podcast / Audiobook

Long-form audio — episodes run 30 minutes to 10+ hours, and users progress through a file over multiple sessions. A single episode can be 50–200 MB.

**Strategy:** Cache-first for audio. Episodes rarely change once published, so avoid re-downloading. Use larger entry limits and longer TTL than curated playlists.

```js
// sw.js — fetch handler for podcast/audiobook apps
const AUDIO_CACHE = "audio-longform-v1";

self.addEventListener("fetch", (event) => {
  if (isShellRequest(event.request)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  if (isAudioRequest(event.request)) {
    event.respondWith(cacheFirst(event.request, AUDIO_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
    evictIfNeeded(cacheName, {
      maxEntries: 5, // 5 episodes × ~100 MB = ~500 MB; pushing limits
      maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days — episodes are stable once published
    });
  }
  return response;
}
```

Time-based eviction is a rough proxy for long-form content. For a better UX, your app should actively manage the cache — remove finished episodes and keep in-progress ones. Use the Cache API directly from your app code:

```js
// app.js — remove a finished episode from the cache
async function removeEpisode(audioUrl) {
  const cache = await caches.open("audio-longform-v1");
  await cache.delete(audioUrl);
}
```

> **Persistent storage is essential here.** A single audiobook chapter can exceed Chrome's default eviction threshold (~20 MB on Android for non-persistent storage). Request `navigator.storage.persist()` on app load.

#### Hybrid (curated library + radio)

Your app has both user-owned content (saved tracks, playlists) and generated content (radio, discover feeds). Most real-world audio apps work this way.

**Strategy:** Route audio requests to different strategies based on the source. Library audio is cached with stale-while-revalidate; radio content passes through uncached.

The trick is **routing**: different audio URLs need different strategies. Options:

- **By URL pattern:** cache `/library/` paths, ignore `/radio/` paths
- **By origin:** cache audio from `cdn.yourapp.com` (user library), pass through `radio-api.yourapp.com`
- **By request header:** have your client add a custom header (e.g., `X-Cache-Strategy: library`) and branch in the service worker's `fetch` handler

```js
// sw.js — fetch handler for a hybrid app
const LIBRARY_CACHE = "audio-library-v1";

self.addEventListener("fetch", (event) => {
  if (isShellRequest(event.request)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // Library audio: stale-while-revalidate (reuse the function from Curated playlists)
  if (isLibraryAudio(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request, LIBRARY_CACHE));
    return;
  }

  // Radio audio: network only (no caching)
  // Everything else: network only
});

function isLibraryAudio(request) {
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin && url.pathname.startsWith("/library/")
  );
}
```

> **Tip:** If your API doesn't distinguish library vs. radio URLs, consider adding a query parameter or custom header so the service worker can route intelligently. Routing by file extension alone (`.mp3`) isn't enough when both contexts serve the same file types.

### Persistent storage

Audio caches can exceed browser eviction thresholds quickly — Chrome on Android starts evicting at **~20 MB** for non-persistent storage, and most browsers cap at 50–100 MB. Request persistent storage on app load to protect your caches:

```js
// app.js — request persistent storage
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((persisted) => {
    if (persisted) {
      // Storage is safe — browser won't evict it under pressure
    }
  });
}
```

Chrome is more likely to grant persistence when the user has installed the PWA and the site has a high engagement score.

### HTML meta tags

Include these in your `<head>` for full PWA support across browsers:

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
