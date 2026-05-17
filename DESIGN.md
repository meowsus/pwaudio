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
- Concurrency guards for async `play()` / `next()` / `goto()` calls

### Out of scope

- Web Audio API integration (EQ, visualization, effects)
- Service worker logic, caching, or offline strategies
- UI components or styling
- Framework-specific bindings (React hooks, Vue composables, etc.)
- SSR / server-side rendering support
- Audio streaming protocols (HLS, DASH) — the browser handles this via `HTMLAudioElement`
- Gapless playback, crossfading, or preloading of upcoming tracks

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

**Singleton constraint:** `navigator.mediaSession` is a per-page singleton. If multiple `PWAudio` instances exist, the last instance to call `#updateMediaSession()` wins — its metadata and action handlers overwrite all others. This library does not attempt to coordinate multiple instances. Consumers who need more than one player must manage the active instance themselves (e.g., pausing all others when one starts). This limitation is documented and is an accepted trade-off of the underlying platform API.

### 3.3 Immutable playlist model

The playlist is an immutable array. To change it, you replace the entire array:

```ts
player.tracks = [...player.tracks, newTrack]; // append
player.tracks = player.tracks.filter((t) => t !== removed); // remove
player.tracks = shuffled; // replace
```

This eliminates a class of bugs around incremental mutation, makes event emission straightforward (the array reference changes, so `playlistchange` fires), and gives consumers a single source of truth.

**Shuffle state on mutation:** When `tracks` is replaced while shuffle is on, the shuffle order and history are regenerated from scratch. The current track is placed at position 0 in the new shuffle order (if it still exists in the new playlist). If the current track is no longer in the new playlist, `currentIndex` resets to 0 and a new shuffle order is generated.

**Duplicate `src` in the playlist:** The library does not deduplicate entries. If `tracks` contains multiple items with the same `src` URL, they are treated as distinct tracks. When the playlist is replaced and the library searches for the current track's `src` in the new list, the **first** occurrence wins.

### 3.4 Event system

Events are re-emitted as `CustomEvent` objects on the `PWAudio` instance. Native `HTMLAudioElement` events are wrapped in a `CustomEvent` with the original event carried in `detail.nativeEvent`. Synthetic events use `CustomEvent` with a typed `detail` payload specific to the event. This ensures `event.target` is always the `PWAudio` instance and consumers never need to interact with the underlying `HTMLAudioElement`.

| Event             | Source    | Fired when                                              | Detail type              |
| ----------------- | --------- | ------------------------------------------------------- | ------------------------ |
| `play`            | Native    | Playback resumes after pause or initial start           | `{ nativeEvent: Event }` |
| `pause`           | Native    | Playback is paused                                      | `{ nativeEvent: Event }` |
| `ended`           | Native    | Current track finishes naturally (not stopped manually) | `{ nativeEvent: Event }` |
| `timeupdate`      | Native    | `currentTime` changes during playback                   | `{ nativeEvent: Event }` |
| `durationchange`  | Native    | `duration` becomes known or changes                     | `{ nativeEvent: Event }` |
| `volumechange`    | Native    | Volume or muted state changes                           | `{ nativeEvent: Event }` |
| `ratechange`      | Native    | Playback rate changes                                   | `{ nativeEvent: Event }` |
| `seeking`         | Native    | Seek operation starts                                   | `{ nativeEvent: Event }` |
| `seeked`          | Native    | Seek operation completes                                | `{ nativeEvent: Event }` |
| `waiting`         | Native    | Playback stalled, waiting for data                      | `{ nativeEvent: Event }` |
| `canplay`         | Native    | Enough data buffered to begin playback                  | `{ nativeEvent: Event }` |
| `error`           | Native    | Media loading or playback error                         | `{ nativeEvent: Event }` |
| `progress`        | Native    | Buffering progress (TimeRanges updated)                 | `{ nativeEvent: Event }` |
| `loadedmetadata`  | Native    | Metadata (duration, dimensions) has been loaded         | `{ nativeEvent: Event }` |
| `trackchange`     | Synthetic | `currentIndex` changes (next, prev, goto, shuffle)      | `TrackChangeDetail`      |
| `playlistchange`  | Synthetic | `tracks` array is replaced                              | `PlaylistChangeDetail`   |
| `mediacardchange` | Synthetic | Media Session metadata is updated                       | `MediaCardChangeDetail`  |
| `trackerror`      | Synthetic | A track fails to load or play                           | `TrackErrorDetail`       |
| `stop`            | Synthetic | `stop()` is called (not a native event)                 | —                        |

**Event cascade on `stop()`:** Calling `stop()` (which pauses and seeks to 0) fires the following events in order: `pause` (native), `seeking` (native), `seeked` (native), then `stop` (synthetic). Consumers should be aware that `stop()` is not a single atomic event — it triggers native side effects.

**`stop` event semantics:** The `stop` synthetic event fires **only** when `stop()` is called. It does **not** fire when a track ends naturally (that is the `ended` native event). Consumers who want to know "playback has ceased regardless of cause" should listen to both `stop` and `ended`.

**The `trackerror` event** fires on any `error` from the `HTMLAudioElement` (network failure, decode failure, unsupported format, etc.). It carries a `TrackErrorDetail` with the error, the track, and the index. The library does **not** auto-skip to the next track on error — this decision is left to the consumer, who can call `next()` in the handler if desired. Auto-skip is intentionally omitted because it can produce infinite loops when all tracks in a playlist are broken.

**Proxying behavior:** All listed native events are proxied. Other `HTMLAudioElement` events (e.g., `loadstart`, `emptied`, `stalled`, `suspend`, `canplaythrough`, `loadeddata`) are not proxied. Consumers who need them must listen on the underlying `HTMLAudioElement` directly (accessed via the library's internal audio element — not part of the public API, but `audio.addEventListener` still works if needed for advanced use cases).

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
	// Native HTMLAudioElement events (proxied as CustomEvent<NativeEventDetail>)
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
	| "progress"
	| "loadedmetadata"
	// Synthetic pwaudio events
	| "trackchange"
	| "playlistchange"
	| "mediacardchange"
	| "trackerror";

/** Detail payload for native-proxied events */
interface NativeEventDetail {
	nativeEvent: Event;
}

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

interface TrackErrorDetail {
	error: MediaError | null;
	track: Track | null;
	index: number;
}

// ─── Typed event handler map ───

/**
 * Maps event names to their handler signatures.
 * All events are received as CustomEvent objects on the PWAudio instance.
 * Native-proxied events carry the original HTMLAudioElement event in
 * `detail.nativeEvent`. Synthetic events carry their specific
 * detail type in `detail`.
 *
 * Usage:
 *   player.on("trackchange", (e) => {
 *     const { previousIndex, currentIndex, track } = e.detail;
 *   });
 *
 *   player.on("play", (e) => {
 *     const nativeEvent = e.detail.nativeEvent;
 *   });
 */
interface PlayerEventHandlerMap {
	play: (e: CustomEvent<NativeEventDetail>) => void;
	pause: (e: CustomEvent<NativeEventDetail>) => void;
	stop: (e: CustomEvent) => void;
	ended: (e: CustomEvent<NativeEventDetail>) => void;
	timeupdate: (e: CustomEvent<NativeEventDetail>) => void;
	durationchange: (e: CustomEvent<NativeEventDetail>) => void;
	volumechange: (e: CustomEvent<NativeEventDetail>) => void;
	ratechange: (e: CustomEvent<NativeEventDetail>) => void;
	seeking: (e: CustomEvent<NativeEventDetail>) => void;
	seeked: (e: CustomEvent<NativeEventDetail>) => void;
	waiting: (e: CustomEvent<NativeEventDetail>) => void;
	canplay: (e: CustomEvent<NativeEventDetail>) => void;
	error: (e: CustomEvent<NativeEventDetail>) => void;
	progress: (e: CustomEvent<NativeEventDetail>) => void;
	loadedmetadata: (e: CustomEvent<NativeEventDetail>) => void;
	trackchange: (e: CustomEvent<TrackChangeDetail>) => void;
	playlistchange: (e: CustomEvent<PlaylistChangeDetail>) => void;
	mediacardchange: (e: CustomEvent<MediaCardChangeDetail>) => void;
	trackerror: (e: CustomEvent<TrackErrorDetail>) => void;
}

// ─── Options ───

interface PWAudioOptions {
	/** Initial single-track source (shorthand for tracks=[{src}]) */
	src?: string;
	/** Initial playlist. If both src and tracks are provided, tracks wins and src is ignored. */
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
	/** Threshold in seconds for the previous() restart behavior.
	 *  If currentTime exceeds this value, previous() restarts the current
	 *  track instead of going back. Default: 3 */
	previousRestartThreshold?: number;
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
	 *
	 * If called on an empty playlist (no tracks, no src), returns a
	 * Promise that rejects with an Error indicating no track is available.
	 *
	 * If called after a track has ended naturally (repeat=off, last track),
	 * restarts the current track from the beginning. This matches the
	 * native HTMLAudioElement behavior.
	 *
	 * Internally guarded by a play-generation counter: if another call
	 * to play(), next(), or goto() supersedes this call before the
	 * Promise settles, this Promise resolves silently without effect.
	 */
	play(): Promise<void>;

	/** Pause playback. Current position is retained. */
	pause(): void;

	/**
	 * Stop playback: pause and seek to 0. Emits 'stop'.
	 *
	 * Event cascade: pause → seeking → seeked → stop.
	 * Consumers should treat 'stop' as the definitive signal;
	 * the native side effects (pause, seeking, seeked) are unavoidable.
	 */
	stop(): void;

	/**
	 * Whether audio is actively playing.
	 * True when the HTMLAudioElement is not paused (including during
	 * buffering/waiting states). Equivalent to !audio.paused.
	 * Consumers should note that this is true during buffering — use
	 * a combination of `playing`, `paused`, and `stopped` to determine
	 * the precise player state.
	 */
	get playing(): boolean;

	/**
	 * Whether audio is paused (manually paused, not stopped or ended).
	 * True only when audio.paused is true AND the player has not been
	 * stopped AND the track has not ended. Distinguishes from the
	 * stopped and ended states so consumers can render different UI
	 * for "paused mid-track" vs. "stopped at position 0" vs.
	 * "track finished naturally".
	 *
	 * State matrix:
	 *   - Initial (no playback):    playing=false, paused=false, stopped=true,  endedState=false
	 *   - Actively playing:         playing=true,  paused=false, stopped=false, endedState=false
	 *   - User paused:              playing=false, paused=true,  stopped=false, endedState=false
	 *   - After stop():             playing=false, paused=false, stopped=true,  endedState=false
	 *   - After ended (natural end): playing=false, paused=false, stopped=false, endedState=true
	 */
	get paused(): boolean;

	/**
	 * Whether the player is in the stopped state (after stop() or
	 * initial state before any playback). A stopped player is also
	 * paused from the HTMLAudioElement's perspective, but this getter
	 * returns false for paused to differentiate the two states.
	 */
	get stopped(): boolean;

	/**
	 * Whether the current track has ended naturally (repeat=off,
	 * last track). Cleared by play(), next(), previous(), goto(),
	 * and stop(). Useful for consumers who need to distinguish
	 * "track finished" from "user paused" or "user stopped".
	 */
	get endedState(): boolean;

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

	/**
	 * Volume level, clamped to 0–1. Values outside this range are
	 * clamped rather than thrown. Matches HTMLAudioElement behavior.
	 * Default: 1
	 */
	get volume(): number;
	set volume(v: number);

	/** Whether audio is muted. Default: false */
	get muted(): boolean;
	set muted(m: boolean);

	// ─── Playback Rate ───

	/**
	 * Playback rate multiplier, clamped to 0.25–4.0.
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

	/** Current audio source URL. Returns the src of the current track
	 *  in the playlist, or '' if no track is loaded. */
	get src(): string;

	/**
	 * Set audio source directly (single-track mode).
	 * ⚠ Destructive: this clears the entire playlist and replaces it
	 * with a single entry [{src: url}]. Any existing playlist state
	 * (currentIndex, shuffle order, shuffle history) is lost.
	 * Emits 'playlistchange' and 'trackchange'.
	 *
	 * If you need to change the playlist without losing it, use
	 * player.tracks instead.
	 */
	set src(url: string);

	// ─── Playlist ───

	/** The current playlist (immutable — replace to modify). */
	get tracks(): readonly Track[];

	/**
	 * Replace the playlist entirely.
	 * Resets currentIndex to 0 unless the current track's src
	 * is found in the new list (first occurrence wins on duplicates).
	 * If shuffle is on, regenerates shuffle order and resets history.
	 * Emits 'playlistchange' and 'trackchange' (if index changes).
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
	 * If the playlist is empty, resolves immediately without changing state.
	 * Emits 'trackchange' and begins playback.
	 * Internally increments the play-generation counter, invalidating
	 * any in-flight play() Promise from the previous track.
	 */
	next(): Promise<void>;

	/**
	 * Return to the previous track.
	 * If currentTime > previousRestartThreshold (default 3s), restarts
	 * current track instead of going back.
	 * In shuffle mode, returns to the actual previous track (not random).
	 * If shuffle history is empty, restarts the current track.
	 * If the playlist is empty, resolves immediately without changing state.
	 * Emits 'trackchange' and begins playback.
	 * Internally increments the play-generation counter.
	 */
	previous(): Promise<void>;

	/**
	 * Jump to a specific track by index.
	 * Out-of-range indices are clamped.
	 * If the playlist is empty, resolves immediately without changing state.
	 * Emits 'trackchange' and begins playback.
	 * Internally increments the play-generation counter.
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

	// ─── Previous restart threshold ───

	/**
	 * Threshold in seconds controlling previous() behavior.
	 * If currentTime exceeds this value, previous() restarts the
	 * current track rather than going back.
	 * Default: 3
	 */
	get previousRestartThreshold(): number;
	set previousRestartThreshold(seconds: number);

	// ─── Media Session ───

	/** Whether Media Session API integration is active. Default: true */
	get mediaSessionEnabled(): boolean;
	set mediaSessionEnabled(v: boolean);

	// ─── Events ───

	/**
	 * Subscribe to a player event. Handler signature is typed
	 * per event via PlayerEventHandlerMap.
	 */
	on<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void;

	/**
	 * Subscribe to a player event, automatically removed
	 * after the first invocation.
	 */
	once<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void;

	/** Unsubscribe from a player event. */
	off<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void;

	// ─── Lifecycle ───

	/**
	 * Tear down the player:
	 *   1. Pause playback
	 *   2. Remove all event listeners (native + synthetic)
	 *   3. Clear Media Session metadata and action handlers
	 *   4. Set audio.src = '' and call audio.load() to abort any
	 *      in-flight network request
	 *   5. Remove the src attribute
	 *   6. Set the #destroyed flag
	 *
	 * After destroy(), any method call throws a DOMException with
	 * name "InvalidStateError" and message "PWAudio has been destroyed".
	 * This matches the pattern used by native APIs (e.g., AudioContext.close()).
	 *
	 * If a play() Promise is in-flight at the time of destroy(), it
	 * resolves silently (consistent with stale-generation behavior).
	 * It does not reject — the play-generation guard discards the result.
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
├── #stopped: boolean               // true after stop() or before first play()
├── #endedState: boolean            // true after ended event, cleared on play()/next()/previous()/goto()/stop()
├── #playGeneration: number          // incremented on every loadTrack(), guards async play()
├── #listeners: Map<string, Set<EventListener>>  // synthetic event registry
├── #nativeListeners: Map<string, EventListener>    // native event proxy registry
├── #positionStateThrottle: number   // last timestamp for setPositionState throttle
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
├── #handleError()                  // emits trackerror, does not auto-skip
├── #advanceTrack(direction)        // next/prev logic with repeat + shuffle
├── #loadTrack(track)               // set audio.src, update Media Session, increment #playGeneration
├── #updateMediaSession()           // sync metadata + action handlers
├── #generateShuffleOrder()         // Fisher-Yates on current tracks
├── #emit(event, detail?)           // fire synthetic events
├── #proxyNativeEvent(event)        // wrap native event as CustomEvent<NativeEventDetail>
├── #throttledSetPositionState()    // setPositionState throttled to ~1/sec during timeupdate
```

### 6.2 Play-generation guard (concurrency)

Because `play()` is asynchronous and `next()` / `goto()` / `stop()` can be called in rapid succession, the library uses an internal `#playGeneration` counter to invalidate stale operations:

1. Every call to `#loadTrack()` increments `#playGeneration`.
2. `play()` captures the current generation before awaiting the native `audio.play()`.
3. When the Promise resolves or rejects, it checks whether the generation still matches. If not, the result is discarded (the Promise resolves silently).
4. `#handleEnded()` checks the generation before advancing — if another track has already been loaded, the stale `ended` event is ignored.
5. `#handleError()` similarly checks the generation before emitting `trackerror`.

This prevents ghost events from dead tracks and eliminates the race condition where rapid `next()` calls cause multiple overlapping play requests.

### 6.3 Shuffle algorithm

```
When shuffle is enabled:
  1. Generate a Fisher-Yates permutation of track indices
  2. The current track is placed at position 0 to avoid skipping
  3. Every next() advances through shuffleOrder
  4. Every previous() retreats through shuffleHistory
  5. When shuffleOrder is exhausted with repeat='all', regenerate
  6. When shuffle is toggled off, currentIndex stays on current track

When the playlist is replaced while shuffle is on:
  1. If the current track's src appears in the new list, preserve its
     position (currentIndex stays the same numeric value if possible,
     or re-resolves to the first matching src).
  2. Regenerate shuffleOrder and reset shuffleHistory from scratch.
  3. The current track is placed at position 0 in the new shuffleOrder.
```

### 6.4 Track advancement on `ended`

```
When 'ended' fires:
  Check #playGeneration — if stale, ignore.
  Set #endedState = true.

  if repeat === 'one':
    → clear #endedState, reload current track, play
  else if repeat === 'all':
    if currentIndex === tracks.length - 1:
      → clear #endedState, goto(0), play
    else:
      → clear #endedState, next()
  else (repeat === 'off'):
    if currentIndex === tracks.length - 1:
      → Do nothing further. The 'ended' native event has already fired.
        The player is now in #endedState=true (playing=false, paused=false,
        stopped=false, endedState=true). Calling play() will restart the
        current track.
    else:
      → clear #endedState, next()

Edge case — single-track playlist with repeat='all':
  → Equivalent to repeat='one': the one track loops indefinitely.

Edge case — empty playlist:
  → 'ended' should not fire (no track loaded), but if it does,
    it is ignored.
```

### 6.5 `previous()` behavior

```
If currentTime > previousRestartThreshold (default 3 seconds):
  → seek to 0, play current track (restart)
Else:
  If shuffle is on:
    if shuffleHistory has a previous entry:
      → retreat in shuffleHistory
    else:
      → restart current track (no history to retreat to)
  Else:
    → decrement currentIndex (clamp to 0)
  → load and play that track
```

The `previousRestartThreshold` is configurable via the eponymous option and getter/setter, defaulting to 3 seconds. This matches the universal behavior of virtually all native audio players (Spotify, Apple Music, Pocket Casts, etc.).

### 6.6 Error handling

When the `HTMLAudioElement` fires an `error` event:

1. The native `error` event is proxied to consumers as-is.
2. The library additionally emits a synthetic `trackerror` event with a `TrackErrorDetail` payload containing `{ error, track, index }`.
3. Playback stops. The library does **not** auto-advance to the next track.

**Why no auto-skip?** Auto-skip on error can produce infinite loops when all tracks in a playlist are broken (network down, corrupted files), which is worse than stopping. Consumers who want skip-on-error behavior can implement it trivially:

```ts
player.on("trackerror", (e) => {
	console.error(`Track ${e.detail.index} failed:`, e.detail.error);
	void player.next();
});
```

The library increments `#playGeneration` before advancing so that any stale `play()` Promises from the failed track are discarded.

### 6.7 `src` setter interaction with playlist

**Setting `src` directly** is a shorthand for:

```ts
player.tracks = [{ src: url }];
// currentIndex becomes 0, playback does not auto-start
```

Setting `tracks` when `src` was previously set replaces the entire playlist context. If the current track's `src` appears in the new tracks array, `currentIndex` is preserved at that position (first occurrence wins on duplicates); otherwise it resets to 0.

**Constructor precedence:** When both `src` and `tracks` are provided in `PWAudioOptions`, `tracks` wins. The `src` option is a convenience shorthand for a single-track playlist; if `tracks` is also present, `src` is ignored.

**Calling `play()` with no track loaded** (empty playlist, no `src`) returns a Promise that rejects with an Error: `"No track loaded"`. This avoids the silent no-op that `HTMLAudioElement.play()` would produce.

### 6.8 Media Session detail

```ts
// Called automatically on trackchange
// setPositionState is also called on timeupdate (throttled) and ratechange
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

  // Action handlers are re-registered on every trackchange to capture
  // the latest player state via closure. This is intentional and
  // has no memory concern — closures are GC'd when replaced.
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
  // Full update on trackchange and ratechange
  this.#setPositionState();
}

// Throttled position state update for timeupdate
// Calls setPositionState at most once per second to reduce overhead
// on mobile devices while keeping OS progress bars reasonably in sync.
#onTimeUpdatePositionState(): void {
  const now = Date.now();
  if (now - this.#positionStateThrottle < 1000) return;
  this.#positionStateThrottle = now;
  this.#setPositionState();
}

#setPositionState(): void {
  if (this.#audio.duration && isFinite(this.#audio.duration)) {
    navigator.mediaSession.setPositionState({
      duration: this.#audio.duration,
      playbackRate: this.#audio.playbackRate,
      position: this.#audio.currentTime,
    });
  }
}
```

**`setPositionState` is called on three events:** `trackchange` (full metadata + position refresh), `ratechange` (updates position calculation when speed changes), and `timeupdate` (keeps OS progress bar in sync, throttled to once per second).

Without calling `setPositionState` on `timeupdate`, the OS lock-screen scrubber and progress bar freeze between track changes. The 1-second throttle reduces overhead by ~75% on mobile compared to calling on every `timeupdate` (~4×/sec) while keeping the progress bar smooth enough.

Action handlers are re-registered on every `trackchange` to ensure they capture the latest player state via closure.

### 6.9 iOS artwork quirk

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

### 7.4 Volume setter on mobile

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

### 7.7 Multiple instances and Media Session

`navigator.mediaSession` is a per-page singleton. If multiple `PWAudio` instances exist, the last instance to call `#updateMediaSession()` will overwrite the previous instance's metadata and action handlers. The library does not attempt to coordinate between instances. Consumers who need multiple players must manage the active instance themselves (e.g., pausing all others before starting one).

### 7.8 Inter-track gaps (no gapless playback)

Because `HTMLAudioElement` supports only one `src` at a time, advancing to the next track involves setting a new `src`, calling `load()`, then `play()`. This produces a brief gap (typically 200–500ms depending on network conditions and codec). Gapless playback and crossfading require either the Web Audio API with pre-decoded buffers or a pre-buffering strategy with multiple audio elements — both are explicitly out of scope for this library.

Consumers who need gapless playback should use a specialized library like [howler.js](https://howlerjs.com/) (which uses Web Audio API for multi-track preloading) or build a custom solution with the Web Audio API and pre-decoded buffers.

### 7.9 Preload strategy timing

The `preload` attribute on `HTMLAudioElement` must be set **before** `load()` is called for it to take effect. The library applies the preload strategy:

1. On construction — set on the initial `HTMLAudioElement`.
2. On every `loadTrack()` call — re-applied to the element before `load()`.
3. When the consumer changes `preload` via the setter — applied immediately, but only takes full effect on the next `loadTrack()`.

### 7.10 Volume and playbackRate clamping

Both `volume` and `playbackRate` are clamped to their valid ranges on write:

- `volume`: clamped to `[0, 1]` (matching `HTMLAudioElement` behavior, which silently clamps)
- `playbackRate`: clamped to `[0.25, 4.0]`

Reading back returns the actual value applied. Out-of-range values do not throw — they are silently clamped.

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
│   ├── concurrency.test.ts   # Play-generation guard, rapid next/goto
│   ├── error-recovery.test.ts# Track error events
│   └── edge-cases.test.ts    # Autoplay, destroy, iOS quirks, empty playlist
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
	PlayerEventHandlerMap,
	RepeatMode,
	ShuffleMode,
	PreloadStrategy,
	TrackChangeDetail,
	PlaylistChangeDetail,
	MediaCardChangeDetail,
	TrackErrorDetail,
	NativeEventDetail,
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
| 7     | Concurrency guard (play-generation counter)                                   | Phase 3    |
| 8     | Error handling (`trackerror` event, empty-playlist rejection)                 | Phase 6    |
| 9     | Edge cases & platform quirks (autoplay policy, `preservesPitch` prefix, etc.) | Phase 8    |
| 10    | Test suite                                                                    | Phase 9    |
| 11    | README overhaul + `docs/pwa-guide.md`                                         | Phase 10   |
| 12    | Demo app update                                                               | Phase 11   |
| 13    | Build & typecheck verification                                                | Phase 12   |

---

## 11. Decisions Log

| #   | Decision                            | Choice                                                                | Rationale                                                                                                        |
| --- | ----------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Playback engine                     | HTMLAudioElement                                                      | Universal support, streaming, correct iOS routing, no silent-switch bug                                          |
| 2   | Web Audio API                       | Excluded from core                                                    | iOS ringer channel issue, memory overhead, complexity — not needed for playback                                  |
| 3   | Playlist model                      | Immutable (replace array)                                             | Simpler state, easier testing, single source of truth                                                            |
| 4   | Repeat modes                        | `off` / `one` / `all`                                                 | Industry standard, covers all cases                                                                              |
| 5   | Shuffle algorithm                   | Fisher-Yates with history                                             | Unbiased randomization, `previous()` goes to actual prior track                                                  |
| 6   | Media Session                       | On by default, opt-out                                                | Zero-config for the common case, disableable for edge cases                                                      |
| 7   | Runtime target                      | Browser only (DOM assumed)                                            | Audio playback requires DOM — no need for SSR complexity                                                         |
| 8   | Offline / caching                   | Out of scope                                                          | Consumer concern; documented in PWA guide, not in library                                                        |
| 9   | Event system                        | Methods on class (`on`/`off`/`once`)                                  | Matches HTMLAudioElement convention, no EventEmitter dependency                                                  |
| 10  | Error handling                      | `play()` rejects; `trackerror` fires                                  | Consumers catch `NotAllowedError` for autoplay; `trackerror` for load errors                                     |
| 11  | `previous()` threshold              | 3s default, configurable                                              | Universal convention; configurable for podcast/audiobook use cases                                               |
| 12  | Module format                       | ESM + CJS (tsup)                                                      | Maximize compatibility via dual export map                                                                       |
| 13  | Class name                          | `PWAudio`                                                             | Matches package name, distinctive, easy to search for                                                            |
| 14  | Concurrency guard                   | Play-generation counter                                               | Prevents stale callbacks from superseded play() calls, ghost ended events                                        |
| 15  | Error auto-skip                     | No — stop on error, consumer decides                                  | Auto-skip can infinite-loop on all-broken playlists; consumer can trivially add it                               |
| 16  | Multiple instances                  | Supported but singleton Media Session                                 | Documented limitation; last-instance-wins for OS controls                                                        |
| 17  | Inter-track gap                     | Accepted (out of scope)                                               | Requires Web Audio API or dual-audio-element pre-buffering; not suitable for this lib                            |
| 18  | `stop()` event cascade              | Accept native side effects                                            | stop() unavoidably fires pause+seeking+seeked; `stop` event is the definitive signal                             |
| 19  | Typed event handlers                | `PlayerEventHandlerMap`                                               | All events proxied as CustomEvent; native events carry `NativeEventDetail` with original event; full type safety |
| 20  | Empty playlist play                 | Reject with descriptive Error                                         | Better than silent no-op; tells the consumer exactly what went wrong                                             |
| 21  | `playing` getter                    | `!audio.paused`                                                       | True during buffering/waiting (user hasn't paused); false when paused/stopped/ended                              |
| 22  | `paused` / `stopped` / `endedState` | Three separate getters for three distinct states                      | `paused` = user-paused; `stopped` = after stop() or initial; `endedState` = track finished naturally             |
| 23  | Constructor `src` + `tracks`        | `tracks` wins, `src` ignored                                          | `src` is a shorthand for single-track; explicit `tracks` takes precedence                                        |
| 24  | Duplicate `src` in playlist         | Allowed, first occurrence wins                                        | No deduplication; index search uses indexOf (finds first match)                                                  |
| 25  | Volume/rate clamping                | Silent clamp, no throw                                                | Consistent with HTMLAudioElement behavior; `playbackRate` clamped to [0.25, 4.0]                                 |
| 26  | `setPositionState`                  | Called on trackchange + ratechange + throttled timeupdate (1/sec)     | OS scrubber needs updates; throttle reduces mobile overhead by ~75%                                              |
| 27  | `destroy()`                         | Pause, remove listeners, clear src, load(), removeAttribute, set flag | Full resource release, aborts network requests; throws DOMException InvalidStateError on post-destroy calls      |
| 28  | Event proxying                      | Re-emit as `CustomEvent` on PWAudio instance                          | `event.target` is always PWAudio; original event in `detail.nativeEvent`                                         |
| 29  | `stop` event semantics              | Only fires on `stop()` call, NOT on natural end                       | `ended` is the signal for natural end; `stop` means user-initiated stop                                          |
| 30  | `play()` after `ended`              | Restart current track (match native HTMLAudioElement)                 | Simple, predictable behavior; clears `#endedState` and seeks to 0                                                |
| 31  | Empty playlist navigation           | `next()`/`previous()`/`goto()` resolve as no-ops; `play()` rejects    | Navigation methods resolve silently; `play()` needs a track to play                                              |
| 32  | `src` setter                        | Destructive but documented                                            | Replaces entire playlist; clear warning in JSDoc recommends `tracks` for playlists                               |
| 33  | `progress` / `loadedmetadata`       | Added to proxied event allowlist                                      | Commonly needed for buffering UI and duration availability                                                       |
| 34  | Shuffle empty history fallback      | Restart current track                                                 | If `previous()` in shuffle mode with no history, restart current track                                           |
| 35  | Native events scope                 | Explicit allowlist (14 native events)                                 | Only listed events are proxied; others require direct HTMLAudioElement access                                    |
