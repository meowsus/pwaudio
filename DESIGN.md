# pwaudio — Design Document

**Status:** Approved  
**Date:** 2025-07-09

---

## 1. Overview

`pwaudio` is a headless audio player library for the browser. It provides a clean, typed TypeScript API for playing single tracks and managing playlists, with automatic integration into the operating system's media controls via the Media Session API. It is designed to be framework-agnostic, dependency-free, and maximally compatible across browsers, devices, and connection conditions.

It is **not** a UI component library, a service worker toolkit, or a Web Audio effects processor.

---

## 2. Scope

### In scope

- Single-track and playlist playback
- Play, pause, stop, seek, volume, mute, playback rate
- Playlist management (immutable replace model)
- Repeat modes: `off`, `one`, `all`
- Shuffle (Fisher-Yates with history)
- Media Session API integration (lock screen, notification, OS-level controls)
- Typed event system (native HTMLAudioElement events + synthetic events)
- Autoplay policy handling
- Browser platform quirk mitigation

### Out of scope

- Web Audio API integration (EQ, visualization, effects)
- Service worker logic, caching, or offline strategies
- UI components or styling
- Framework-specific bindings (React hooks, Vue composables, etc.)
- SSR / server-side rendering support
- Audio streaming protocols (HLS, DASH) — the browser handles this via `HTMLAudioElement`

---

## 3. Architecture

### 3.1 Single engine: HTMLAudioElement

The entire player is built on top of a single `HTMLAudioElement` instance. This is the only audio playback primitive the library uses.

**Why not Web Audio API?**

| Concern              | HTMLAudioElement                                 | Web Audio API                                                                 |
| -------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Browser support      | Universal (all browsers, ever)                   | Baseline since 2023, but edge cases remain                                    |
| Streaming            | Built-in (byte-range requests)                   | Must decode entire file into memory                                           |
| Memory               | Bounded (browser manages buffering)              | Unbounded (entire `AudioBuffer` in RAM)                                       |
| iOS routing          | Media channel (respects silent switch correctly) | Ringer channel (muted by silent switch)                                       |
| Background playback  | Works in PWA since iOS 15.4                      | Requires `AudioSession.type = "playback"` (Safari 18.2+ only)                 |
| Media Session        | Works natively                                   | Works via `MediaElementSource`, but breaks on some iOS versions               |
| Lock screen controls | Automatic with `play()`                          | Requires `AudioSession` API hack for metadata                                 |
| Complexity           | Minimal                                          | Significant (context management, source node lifecycle, cross-browser quirks) |

The iOS silent-switch routing issue alone is disqualifying for a general-purpose library. An audio player that goes silent when a user's phone is on vibrate is broken by definition. The Web Audio API remains an excellent tool for effects, visualization, and synthesis — but it is the wrong foundation for a playback-focused library that must work everywhere.

### 3.2 Media Session API as automatic enhancement

When a track provides metadata (`title`, `artist`, `album`, `artwork`), the library automatically registers it with `navigator.mediaSession`. This gives consumers lock screen controls, notification players, and OS-level metadata for free — zero configuration required. It can be disabled via `mediaSessionEnabled: false`.

### 3.3 Immutable playlist model

The playlist is an immutable array. To change it, you replace the entire array:

```ts
player.tracks = [...player.tracks, newTrack]; // append
player.tracks = player.tracks.filter((t) => t !== removed); // remove
player.tracks = shuffled; // replace
```

This eliminates a class of bugs around incremental mutation, makes event emission straightforward (the array reference changes, so `playlistchange` fires), and gives consumers a single source of truth.

### 3.4 Event system

Events are a thin proxy over the native `HTMLAudioElement` events, plus synthetic events for state changes that have no native equivalent:

| Event             | Source    | Fired when                                              |
| ----------------- | --------- | ------------------------------------------------------- |
| `play`            | Native    | Playback resumes after pause or initial start           |
| `pause`           | Native    | Playback is paused                                      |
| `ended`           | Native    | Current track finishes naturally (not stopped manually) |
| `timeupdate`      | Native    | `currentTime` changes during playback                   |
| `durationchange`  | Native    | `duration` becomes known or changes                     |
| `volumechange`    | Native    | Volume or muted state changes                           |
| `ratechange`      | Native    | Playback rate changes                                   |
| `seeking`         | Native    | Seek operation starts                                   |
| `seeked`          | Native    | Seek operation completes                                |
| `waiting`         | Native    | Playback stalled, waiting for data                      |
| `canplay`         | Native    | Enough data buffered to begin playback                  |
| `error`           | Native    | Media loading or playback error                         |
| `trackchange`     | Synthetic | `currentIndex` changes (next, prev, goto, shuffle)      |
| `playlistchange`  | Synthetic | `tracks` array is replaced                              |
| `mediacardchange` | Synthetic | Media Session metadata is updated                       |
| `stop`            | Synthetic | `stop()` is called (not a native event)                 |

Synthetic events carry a `detail` property with relevant data (e.g., `{ previousIndex, currentIndex, track }` for `trackchange`).

---

## 4. Types

```ts
// ─── Track ───

interface Track {
	/** URL to the audio file */
	src: string;
	/** Track title — used for Media Session metadata */
	title?: string;
	/** Artist name — used for Media Session metadata */
	artist?: string;
	/** Album name — used for Media Session metadata */
	album?: string;
	/** Artwork images — used for lock screen / notification display */
	artwork?: MediaImage[];
	/** Pre-known duration in seconds (avoids waiting for metadata load) */
	duration?: number;
	/** Consumer-defined passthrough — never inspected by the library */
	metadata?: unknown;
}

// ─── Enums / Unions ───

type RepeatMode = "off" | "one" | "all";
type ShuffleMode = "off" | "on";
type PreloadStrategy = "none" | "metadata" | "auto";

// ─── Events ───

type PlayerEvent =
	// Native HTMLAudioElement events
	| "play"
	| "pause"
	| "stop"
	| "ended"
	| "timeupdate"
	| "durationchange"
	| "volumechange"
	| "ratechange"
	| "seeking"
	| "seeked"
	| "waiting"
	| "canplay"
	| "error"
	// Synthetic pwaudio events
	| "trackchange"
	| "playlistchange"
	| "mediacardchange";

/** Detail payload for synthetic events */
interface TrackChangeDetail {
	previousIndex: number;
	currentIndex: number;
	track: Track | null;
}

interface PlaylistChangeDetail {
	tracks: readonly Track[];
}

interface MediaCardChangeDetail {
	title: string;
	artist: string;
	album: string;
	artwork: MediaImage[];
}

// ─── Options ───

interface PWAudioOptions {
	/** Initial single-track source (shorthand for tracks=[{src}]) */
	src?: string;
	/** Initial playlist */
	tracks?: Track[];
	/** Initial volume (0–1). Default: 1 */
	volume?: number;
	/** Initial playback rate. Default: 1 */
	playbackRate?: number;
	/** Initial repeat mode. Default: 'off' */
	repeat?: RepeatMode;
	/** Initial shuffle mode. Default: 'off' */
	shuffle?: ShuffleMode;
	/** Preload strategy. Default: 'metadata' */
	preload?: PreloadStrategy;
	/** Enable Media Session API integration. Default: true */
	mediaSessionEnabled?: boolean;
}
```

---

## 5. API Reference

```ts
class PWAudio {
	constructor(options?: PWAudioOptions);

	// ─── Playback ───

	/**
	 * Start or resume playback.
	 * Returns a Promise that resolves on success or rejects with
	 * NotAllowedError if autoplay is blocked by browser policy.
	 */
	play(): Promise<void>;

	/** Pause playback. Current position is retained. */
	pause(): void;

	/** Stop playback: pause and seek to 0. Emits 'stop'. */
	stop(): void;

	/** Whether audio is currently playing. */
	get playing(): boolean;

	/** Whether audio is paused (not playing, but not stopped). */
	get paused(): boolean;

	// ─── Seek & Time ───

	/** Current playback position in seconds. */
	get currentTime(): number;
	set currentTime(seconds: number);

	/** Duration of current track in seconds. NaN if unknown. */
	get duration(): number;

	/** Buffered time ranges from HTMLAudioElement. */
	get buffered(): TimeRanges;

	/** Whether a seek operation is in progress. */
	get seeking(): boolean;

	// ─── Volume ───

	/** Volume level (0–1). Default: 1 */
	get volume(): number;
	set volume(v: number);

	/** Whether audio is muted. Default: false */
	get muted(): boolean;
	set muted(m: boolean);

	// ─── Playback Rate ───

	/**
	 * Playback rate multiplier (0.25–4.0, clamped).
	 * Default: 1
	 */
	get playbackRate(): number;
	set playbackRate(rate: number);

	/**
	 * Whether pitch is preserved when playbackRate ≠ 1.
	 * Default: true (maps to HTMLAudioElement.preservesPitch)
	 */
	get preservesPitch(): boolean;
	set preservesPitch(v: boolean);

	// ─── Source (single-track mode) ───

	/** Current audio source URL. */
	get src(): string;

	/**
	 * Set audio source directly (single-track mode).
	 * If a playlist is active, this clears the playlist
	 * and replaces it with a single entry.
	 */
	set src(url: string);

	// ─── Playlist ───

	/** The current playlist (immutable — replace to modify). */
	get tracks(): readonly Track[];

	/**
	 * Replace the playlist entirely.
	 * Resets currentIndex to 0 unless the current track's src
	 * is found in the new list.
	 * Emits 'playlistchange'.
	 */
	set tracks(tracks: Track[]);

	/** Index of the currently active track in the playlist. -1 if empty. */
	get currentIndex(): number;

	/** The currently active Track object, or null if empty. */
	get currentTrack(): Track | null;

	/**
	 * Advance to the next track in the playlist.
	 * Respects repeat mode and shuffle.
	 * If at end of playlist with repeat='off', does nothing.
	 * Emits 'trackchange' and begins playback.
	 */
	next(): Promise<void>;

	/**
	 * Return to the previous track.
	 * If >3 seconds into current track, restarts current track instead.
	 * In shuffle mode, returns to the actual previous track (not random).
	 * Emits 'trackchange' and begins playback.
	 */
	previous(): Promise<void>;

	/**
	 * Jump to a specific track by index.
	 * Out-of-range indices are clamped.
	 * Emits 'trackchange' and begins playback.
	 */
	goto(index: number): Promise<void>;

	// ─── Repeat ───

	/** Current repeat mode. Default: 'off' */
	get repeat(): RepeatMode;
	set repeat(mode: RepeatMode);

	// ─── Shuffle ───

	/** Current shuffle mode. Default: 'off' */
	get shuffle(): ShuffleMode;
	set shuffle(mode: ShuffleMode);

	// ─── Preload ───

	/** Preload strategy. Default: 'metadata' */
	get preload(): PreloadStrategy;
	set preload(strategy: PreloadStrategy);

	// ─── Media Session ───

	/** Whether Media Session API integration is active. Default: true */
	get mediaSessionEnabled(): boolean;
	set mediaSessionEnabled(v: boolean);

	// ─── Events ───

	/** Subscribe to a player event. */
	on(event: PlayerEvent, handler: EventListener): void;

	/**
	 * Subscribe to a player event, automatically removed
	 * after the first invocation.
	 */
	once(event: PlayerEvent, handler: EventListener): void;

	/** Unsubscribe from a player event. */
	off(event: PlayerEvent, handler: EventListener): void;

	// ─── Lifecycle ───

	/**
	 * Tear down the player: pause playback, remove all event
	 * listeners, clear Media Session, release the HTMLAudioElement.
	 * The player should not be used after destroy().
	 */
	destroy(): void;
}
```

---

## 6. Internal Design

### 6.1 Class anatomy

```
PWAudio
├── #audio: HTMLAudioElement        // single source of truth
├── #tracks: Track[]                // current playlist
├── #currentIndex: number           // active track index (-1 if empty)
├── #repeat: RepeatMode
├── #shuffle: ShuffleMode
├── #shuffleOrder: number[]         // Fisher-Yates permutation
├── #shuffleHistory: number[]       // actual playback order for previous()
├── #shufflePosition: number        // position in shuffle history
├── #mediaSessionEnabled: boolean
├── #destroyed: boolean
├── #listeners: Map<string, Set<EventListener>>  // synthetic event registry
│
├── play()
├── pause()
├── stop()
├── next()
├── previous()
├── goto(index)
├── destroy()
│
├── #handleEnded()                  // decides: repeat one? advance? stop?
├── #advanceTrack(direction)        // next/prev logic with repeat + shuffle
├── #loadTrack(track)               // set audio.src, update Media Session
├── #updateMediaSession()           // sync metadata + action handlers
├── #generateShuffleOrder()         // Fisher-Yates on current tracks
├── #proxyNativeEvents()            // bind native → synthetic event bridge
└── #emit(event, detail?)           // fire synthetic events
```

### 6.2 Shuffle algorithm

```
When shuffle is enabled:
  1. Generate a Fisher-Yates permutation of track indices
  2. The current track is placed at position 0 to avoid skipping
  3. Every next() advances through shuffleOrder
  4. Every previous() retreats through shuffleHistory
  5. When shuffleOrder is exhausted with repeat='all', regenerate
  6. When shuffle is toggled off, currentIndex stays on current track
```

### 6.3 Track advancement on `ended`

```
When 'ended' fires:
  if repeat === 'one':
    → reload current track, play
  else if repeat === 'all':
    if currentIndex === tracks.length - 1:
      → goto(0), play
    else:
      → next()
  else (repeat === 'off'):
    if currentIndex === tracks.length - 1:
      → stop, emit 'stopped'
    else:
      → next()
```

### 6.4 `previous()` behavior

```
If currentTime > 3 seconds:
  → seek to 0, play current track (restart)
Else:
  If shuffle is on:
    → retreat in shuffleHistory
  Else:
    → decrement currentIndex (clamp to 0)
  → load and play that track
```

This matches the universal behavior of virtually all native audio players (Spotify, Apple Music, Pocket Casts, etc.).

### 6.5 `src` setter interaction with playlist

Setting `src` directly is a shorthand for:

```ts
player.tracks = [{ src: url }];
// currentIndex becomes 0, playback does not auto-start
```

Setting `tracks` when `src` was previously set replaces the entire playlist context. If the current track's `src` appears in the new tracks array, `currentIndex` is preserved at that position; otherwise it resets to 0.

### 6.6 Media Session detail

```ts
// Called automatically on trackchange
#updateMediaSession(): void {
  if (!this.#mediaSessionEnabled) return;
  if (!('mediaSession' in navigator)) return;

  const track = this.currentTrack;
  if (!track) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title ?? '',
    artist: track.artist ?? '',
    album: track.album ?? '',
    artwork: track.artwork ?? [],
  });

  navigator.mediaSession.playbackState = this.#audio.paused ? 'paused' : 'playing';

  navigator.mediaSession.setActionHandler('play', () => this.play());
  navigator.mediaSession.setActionHandler('pause', () => this.pause());
  navigator.mediaSession.setActionHandler('stop', () => this.stop());
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (details.fastSeek && 'fastSeek' in this.#audio) {
      this.#audio.fastSeek(details.seekTime);
    } else {
      this.#audio.currentTime = details.seekTime;
    }
  });
  navigator.mediaSession.setActionHandler('seekbackward', (details) => {
    this.#audio.currentTime -= details.seekOffset ?? 10;
  });
  navigator.mediaSession.setActionHandler('seekforward', (details) => {
    this.#audio.currentTime += details.seekOffset ?? 10;
  });
  navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
  navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());

  // Position state for progress bar in OS media controls
  if (this.#audio.duration && isFinite(this.#audio.duration)) {
    navigator.mediaSession.setPositionState({
      duration: this.#audio.duration,
      playbackRate: this.#audio.playbackRate,
      position: this.#audio.currentTime,
    });
  }
}
```

Action handlers are re-registered on every `trackchange` to ensure they capture the latest player state via closure.

### 6.7 iOS artwork quirk

Safari on iOS has a documented bug (fixed in iOS 18) where large artwork images do not render in the lock screen media controls. Only a small image (96×96) appears in the compact notification view.

**Mitigation**: The library will not attempt to transform artwork images (that is a consumer concern). The API documentation will advise consumers to provide artwork at multiple sizes:

```ts
artwork: [
	{ src: "icon-96.png", sizes: "96x96", type: "image/png" },
	{ src: "icon-512.png", sizes: "512x512", type: "image/png" },
];
```

The `MediaMetadata` constructor already accepts an array of `MediaImage` objects with different sizes, and Safari selects the best fit.

---

## 7. Platform Quirks

### 7.1 Autoplay policy

All modern browsers block programmatic audio playback until the user has interacted with the page. The library handles this transparently:

- `play()` returns a `Promise<void>` that rejects with `NotAllowedError` if autoplay is blocked
- Consumers should call `play()` from a user gesture handler (click, keypress, touch)
- The library does **not** auto-retry or auto-unmute — that is a consumer concern

### 7.2 iOS background playback

- In a PWA with `display: standalone`, audio continues playing when the app is minimized or the screen is locked (since iOS 15.4 / Safari 16.4)
- The `playsinline` attribute is not required for `<audio>` elements (only for `<video>`)
- The consumer's web app manifest must include `"display": "standalone"` for this to work

### 7.3 iOS silent switch

- `HTMLAudioElement` routes through the **media channel** and is **not affected** by the physical silent switch. Audio plays regardless.
- This is a key reason we chose `HTMLAudioElement` over `Web Audio API` — `AudioContext` routes through the **ringer channel** and is silenced by the switch.
- The `AudioSession` API (`navigator.audioSession.type = "playback"`) can fix Web Audio's routing on iOS 17+, but its browser support is too narrow to rely on.

### 7.4 volume setter on mobile

- Programmatic `volume` control is disabled on many mobile browsers (iOS Safari, Android Chrome). The setter will not throw, but the value may be ignored. This is an OS-level constraint, not a library bug.
- `muted` works on all platforms.

### 7.5 Media Session availability

| Browser             | Minimum version | Notes                                               |
| ------------------- | --------------- | --------------------------------------------------- |
| Chrome / Edge       | 73              | Full support                                        |
| Firefox             | 82              | Full support                                        |
| Safari (macOS)      | 15.0            | Full support                                        |
| Safari (iOS)        | 15.0            | Full support (background playback since 15.4)       |
| Samsung Internet    | 7.2             | Full support                                        |
| Firefox for Android | —               | Partial: metadata works, action handlers unreliable |

When `navigator.mediaSession` is unavailable, the library silently skips all Media Session calls. No errors, no warnings — graceful degradation.

### 7.6 `preservesPitch` / `webkitPreservesPitch`

- The standard property is `preservesPitch` (default: `true`)
- Safari < 17 requires the prefixed `webkitPreservesPitch`
- The library will set both for maximum compatibility

---

## 8. File Structure

```
packages/pwaudio/
├── src/
│   ├── index.ts              # Public API, re-exports
│   ├── PWAudio.ts            # Main class
│   ├── types.ts              # Track, PWAudioOptions, PlayerEvent, etc.
│   ├── events.ts             # Event proxy & synthetic event system
│   ├── shuffle.ts            # Fisher-Yates shuffle + history manager
│   ├── media-session.ts      # Media Session API integration
│   ├── constants.ts          # Defaults, limits
│   └── utils.ts              # clamp, isFiniteDuration, etc.
├── src/__tests__/
│   ├── PWAudio.test.ts       # Core playback tests
│   ├── playlist.test.ts      # Playlist, next, prev, goto
│   ├── shuffle.test.ts       # Shuffle algorithm
│   ├── repeat.test.ts        # Repeat modes
│   ├── events.test.ts        # Event system
│   ├── media-session.test.ts # Media Session (mocked)
│   └── edge-cases.test.ts    # Autoplay, destroy, iOS quirks
├── tsup.config.ts
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

---

## 9. Export Map

```json
{
	"exports": {
		".": {
			"import": {
				"types": "./dist/index.d.ts",
				"default": "./dist/index.js"
			},
			"require": {
				"types": "./dist/index.d.cts",
				"default": "./dist/index.cjs"
			}
		}
	}
}
```

The public API surface is:

```ts
export { PWAudio } from "./PWAudio";
export type {
	Track,
	PWAudioOptions,
	PlayerEvent,
	RepeatMode,
	ShuffleMode,
	PreloadStrategy,
	TrackChangeDetail,
	PlaylistChangeDetail,
	MediaCardChangeDetail,
} from "./types";
```

No private or internal symbols are exported.

---

## 10. Implementation Phases

| Phase | Task                                                                          | Depends on |
| ----- | ----------------------------------------------------------------------------- | ---------- |
| 1     | Design types and interfaces (`types.ts`, `constants.ts`)                      | —          |
| 2     | Core playback engine (`PWAudio.ts` — play/pause/stop/volume/seek/src)         | Phase 1    |
| 3     | Playlist engine (`tracks`, `currentIndex`, `next`, `previous`, `goto`)        | Phase 2    |
| 4     | Shuffle & repeat modes                                                        | Phase 3    |
| 5     | Media Session API integration                                                 | Phase 4    |
| 6     | Event system (`on`/`off`/`once`, native proxy, synthetic events, `destroy`)   | Phases 2–5 |
| 7     | Edge cases & platform quirks (autoplay policy, `preservesPitch` prefix, etc.) | Phase 5    |
| 8     | Test suite                                                                    | Phase 7    |
| 9     | README overhaul + `docs/pwa-guide.md`                                         | Phase 8    |
| 10    | Demo app update                                                               | Phase 9    |
| 11    | Build & typecheck verification                                                | Phase 10   |

---

## 11. Decisions Log

| Decision            | Choice                               | Rationale                                                                               |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| Playback engine     | HTMLAudioElement                     | Universal support, streaming, correct iOS routing, no silent-switch bug                 |
| Web Audio API       | Excluded from core                   | iOS ringer channel issue, memory overhead, complexity — not needed for playback         |
| Playlist model      | Immutable (replace array)            | Simpler state, easier testing, single source of truth                                   |
| Repeat modes        | `off` / `one` / `all`                | Industry standard, covers all cases                                                     |
| Shuffle algorithm   | Fisher-Yates with history            | Unbiased randomization, `previous()` goes to actual prior track                         |
| Media Session       | On by default, opt-out               | Zero-config for the common case, disableable for edge cases                             |
| Runtime target      | Browser only (DOM assumed)           | Audio playback requires DOM — no need for SSR complexity                                |
| Offline / caching   | Out of scope                         | Consumer concern; documented in PWA guide, not in library                               |
| Event system        | Methods on class (`on`/`off`/`once`) | Matches HTMLAudioElement convention, no EventEmitter dependency                         |
| Error handling      | `play()` rejects with native errors  | Consumers catch `NotAllowedError` for autoplay policy; other errors propagate naturally |
| `previous()` at >3s | Restart current track                | Universal convention (Spotify, Apple Music, all podcast apps)                           |
| Module format       | ESM + CJS (tsup)                     | Maximize compatibility via dual export map                                              |
| Class name          | `PWAudio`                            | Matches package name, distinctive, easy to search for                                   |
