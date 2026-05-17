# Plan 07: Media Session Integration

## Objective

Implement the Media Session API integration: automatically register track metadata, action handlers, and position state with `navigator.mediaSession` so that consumers get lock screen controls, notification players, and OS-level metadata for free.

## File to Create

### `packages/pwaudio/src/media-session.ts`

```ts
import type { Track } from "./types";
import { POSITION_STATE_THROTTLE_MS } from "./constants";

/**
 * Manages the Media Session API integration.
 * Called automatically when tracks change, playback state changes,
 * or time updates fire.
 */
export class MediaSessionManager {
	#audio: HTMLAudioElement;
	#enabled: boolean = true;
	#positionStateThrottle: number = 0;

	constructor(audio: HTMLAudioElement) {
		this.#audio = audio;
	}

	get enabled(): boolean {
		return this.#enabled;
	}

	set enabled(v: boolean) {
		this.#enabled = v;
		if (!v) {
			this.clear();
		}
	}

	/**
	 * Whether the Media Session API is available in this browser.
	 */
	get isAvailable(): boolean {
		return typeof navigator !== "undefined" && "mediaSession" in navigator;
	}

	/**
	 * Update Media Session metadata and action handlers for a track.
	 * Called on trackchange.
	 */
	updateMetadata(track: Track, getPlayerState: () => MediaSessionPlaybackState): void {
		if (!this.#enabled || !this.isAvailable) return;

		navigator.mediaSession.metadata = new MediaMetadata({
			title: track.title ?? "",
			artist: track.artist ?? "",
			album: track.album ?? "",
			artwork: track.artwork ?? [],
		});

		navigator.mediaSession.playbackState = getPlayerState();
	}

	/**
	 * Register action handlers. Called on trackchange to capture
	 * the latest player state via closures.
	 *
	 * The actions object maps Media Session action names to handler functions.
	 * These are provided by PWAudio since it needs access to its own methods.
	 */
	setActionHandlers(actions: {
		play: () => Promise<void>;
		pause: () => void;
		stop: () => void;
		seekto: (details: MediaSessionActionDetails) => void;
		seekbackward: (details: MediaSessionActionDetails) => void;
		seekforward: (details: MediaSessionActionDetails) => void;
		nexttrack: () => Promise<void>;
		previoustrack: () => Promise<void>;
	}): void {
		if (!this.#enabled || !this.isAvailable) return;

		navigator.mediaSession.setActionHandler("play", actions.play);
		navigator.mediaSession.setActionHandler("pause", actions.pause);
		navigator.mediaSession.setActionHandler("stop", actions.stop);
		navigator.mediaSession.setActionHandler("seekto", actions.seekto);
		navigator.mediaSession.setActionHandler("seekbackward", actions.seekbackward);
		navigator.mediaSession.setActionHandler("seekforward", actions.seekforward);
		navigator.mediaSession.setActionHandler("nexttrack", actions.nexttrack);
		navigator.mediaSession.setActionHandler("previoustrack", actions.previoustrack);
	}

	/**
	 * Set position state for OS media controls (progress bar, scrubber).
	 * Called on trackchange, ratechange, and throttled timeupdate.
	 */
	setPositionState(): void {
		if (!this.#enabled || !this.isAvailable) return;

		const duration = this.#audio.duration;
		if (duration && Number.isFinite(duration) && duration > 0) {
			try {
				navigator.mediaSession.setPositionState({
					duration,
					playbackRate: this.#audio.playbackRate,
					position: this.#audio.currentTime,
				});
			} catch {
				// Position state can fail if duration is negative or position
				// is out of range — silently ignore per spec.
			}
		}
	}

	/**
	 * Throttled position state update for timeupdate events.
	 * Limits updates to once per POSITION_STATE_THROTTLE_MS (1000ms)
	 * to reduce overhead on mobile devices.
	 */
	throttleSetPositionState(): void {
		const now = Date.now();
		if (now - this.#positionStateThrottle < POSITION_STATE_THROTTLE_MS) return;
		this.#positionStateThrottle = now;
		this.setPositionState();
	}

	/**
	 * Clear all Media Session metadata and action handlers.
	 * Called when mediaSession is disabled or player is destroyed.
	 */
	clear(): void {
		if (!this.isAvailable) return;

		navigator.mediaSession.metadata = null;
		navigator.mediaSession.playbackState = "none";

		// Remove all registered action handlers by setting them to null
		const actions: MediaSessionAction[] = [
			"play",
			"pause",
			"stop",
			"seekto",
			"seekbackward",
			"seekforward",
			"nexttrack",
			"previoustrack",
		];
		for (const action of actions) {
			try {
				navigator.mediaSession.setActionHandler(action, null);
			} catch {
				// Some browsers may throw for unsupported actions — ignore
			}
		}
	}
}
```

## Modifications to `packages/pwaudio/src/PWAudio.ts`

### Add the `#mediaSession` private field:

```ts
import { MediaSessionManager } from "./media-session";

// In the class body:
#mediaSession: MediaSessionManager;
```

### Initialize in constructor:

```ts
constructor(options?: PWAudioOptions) {
  // ... (existing constructor code)

  this.#mediaSession = new MediaSessionManager(this.#audio);
  this.#mediaSession.enabled = options?.mediaSessionEnabled ?? DEFAULTS.mediaSessionEnabled;

  // Set up Media Session action handlers
  this.#mediaSession.setActionHandlers({
    play: () => this.play(),
    pause: () => this.pause(),
    stop: () => this.stop(),
    seekto: (details) => {
      if (details.fastSeek && "fastSeek" in this.#audio) {
        (this.#audio as any).fastSeek(details.seekTime);
      } else {
        this.#audio.currentTime = details.seekTime;
      }
    },
    seekbackward: (details) => {
      this.#audio.currentTime -= details.seekOffset ?? 10;
    },
    seekforward: (details) => {
      this.#audio.currentTime += details.seekOffset ?? 10;
    },
    nexttrack: () => this.next(),
    previoustrack: () => this.previous(),
  });

  // Initial metadata update if we have a track
  if (this.#currentTrack()) {
    this.#updateMediaSession();
  }
}
```

### Add `#updateMediaSession()` method:

```ts
#updateMediaSession(): void {
  const track = this.#currentTrack();
  if (!track) return;

  this.#mediaSession.updateMetadata(track, () =>
    this.#audio.paused ? "paused" : "playing"
  );

  this.#mediaSession.setActionHandlers({
    play: () => this.play(),
    pause: () => this.pause(),
    stop: () => this.stop(),
    seekto: (details) => {
      if (details.fastSeek && "fastSeek" in this.#audio) {
        (this.#audio as any).fastSeek(details.seekTime);
      } else {
        this.#audio.currentTime = details.seekTime;
      }
    },
    seekbackward: (details) => {
      this.#audio.currentTime -= details.seekOffset ?? 10;
    },
    seekforward: (details) => {
      this.#audio.currentTime += details.seekOffset ?? 10;
    },
    nexttrack: () => this.next(),
    previoustrack: () => this.previous(),
  });

  // Full position state update on track change
  this.#mediaSession.setPositionState();
}
```

### Add throttled position state for `timeupdate`:

Register a native event listener on `timeupdate` that calls `#mediaSession.throttleSetPositionState()`. This goes in the constructor:

```ts
this.#audio.addEventListener("timeupdate", () => {
	this.#mediaSession.throttleSetPositionState();
});
```

Also update position state on `ratechange`:

```ts
this.#audio.addEventListener("ratechange", () => {
	this.#mediaSession.setPositionState();
});
```

### Call `#updateMediaSession()` from `#loadTrack()`:

```ts
#loadTrack(track: Track): void {
  this.#playGeneration++;
  this.#stopped = false;
  this.#endedState = false;
  this.#audio.src = track.src;
  this.#audio.preload = this.#preloadStrategy;
  this.#updateMediaSession();  // ← Add this
}
```

### Call `#updateMediaSession()` on play/pause state changes:

```ts
// In play():
this.#mediaSession.setPositionState(); // Update playbackState

// In pause():
this.#mediaSession.updateMetadata(
	this.#currentTrack() ?? { src: "" }, // should not normally be null
	() => "paused",
);
```

Actually, the `playbackState` should be updated on play and pause events. The simplest approach is to listen for native `play` and `pause` events:

```ts
this.#audio.addEventListener("play", () => {
	if (!this.#destroyed && this.#mediaSession.enabled) {
		if ("mediaSession" in navigator) {
			navigator.mediaSession.playbackState = "playing";
		}
	}
});

this.#audio.addEventListener("pause", () => {
	if (!this.#destroyed && this.#mediaSession.enabled) {
		if ("mediaSession" in navigator) {
			navigator.mediaSession.playbackState = "paused";
		}
	}
});
```

### Update `mediaSessionEnabled` setter:

```ts
set mediaSessionEnabled(v: boolean) {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }
  this.#mediaSession.enabled = v;
  if (v) {
    this.#updateMediaSession();
  } else {
    this.#mediaSession.clear();
  }
}

get mediaSessionEnabled(): boolean {
  return this.#mediaSession.enabled;
}
```

### Emit `mediacardchange` event when Media Session metadata is updated:

In `#updateMediaSession()`, after setting metadata:

```ts
const track = this.#currentTrack();
if (track) {
	this.#events.emit("mediacardchange", {
		title: track.title ?? "",
		artist: track.artist ?? "",
		album: track.album ?? "",
		artwork: track.artwork ?? [],
	});
}
```

## Browser Compatibility

- When `navigator.mediaSession` is unavailable, all methods silently no-op (the `isAvailable` check).
- Safari < 17 requires `webkitPreservesPitch` prefix (handled in Plan 09).
- Firefox for Android has partial support: metadata works, action handlers may be unreliable.
- `setPositionState()` can throw on some browsers if the duration is `NaN` or `Infinity` — caught with try/catch.
- iOS lock screen may not display large artwork (known bug fixed in iOS 18, mitigation is documented in DESIGN.md §6.9).

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. When a track with metadata is loaded, `navigator.mediaSession.metadata` is set with title, artist, album, artwork.
3. Action handlers (`play`, `pause`, `stop`, `seekto`, etc.) are registered and functional.
4. `setPositionState()` updates the OS progress bar with duration, position, and playbackRate.
5. Position state is throttled to once per second on `timeupdate`.
6. Position state is fully updated on `trackchange` and `ratechange`.
7. Setting `mediaSessionEnabled = false` clears all handlers and metadata.
8. Setting `mediaSessionEnabled = true` re-registers handlers and metadata for the current track.
9. `mediacardchange` event fires when Media Session metadata is updated.
10. All Media Session operations silently no-op when `navigator.mediaSession` is not available.
