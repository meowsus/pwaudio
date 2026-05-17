# Plan 03: Core Playback Engine

## Objective

Create the `PWAudio` class with the constructor, basic playback controls, and property accessors. This is the skeleton that all subsequent features plug into. After this plan, the class supports: constructor with options, `play()`, `pause()`, `stop()`, and read/write properties for `src`, `currentTime`, `duration`, `volume`, `muted`, `playbackRate`, `preservesPitch`, `playing`, `paused`, `stopped`, `endedState`, `buffered`, and `seeking`.

**This plan does NOT include:** playlist navigation (`next`/`previous`/`goto`), shuffle, repeat, Media Session, the concurrency guard, or error handling. Those are in later plans.

## File to Create / Modify

### `packages/pwaudio/src/PWAudio.ts`

This replaces the current stub in `index.ts` (which will be updated in Plan 11 to re-export from `PWAudio.ts`).

```ts
import type {
	Track,
	PWAudioOptions,
	RepeatMode,
	ShuffleMode,
	PreloadStrategy,
	PlayerEvent,
	PlayerEventHandlerMap,
} from "./types";
import { DEFAULTS } from "./constants";
import { clampVolume, clampPlaybackRate } from "./utils";
import { EventManager } from "./events";

export class PWAudio {
	// ─── Internal state ───

	#audio: HTMLAudioElement;
	#events: EventManager;

	#tracks: Track[] = [];
	#currentIndex: number = -1;
	#repeat: RepeatMode = DEFAULTS.repeat;
	#shuffle: ShuffleMode = DEFAULTS.shuffle;
	#mediaSessionEnabled: boolean = DEFAULTS.mediaSessionEnabled;
	#destroyed: boolean = false;
	#stopped: boolean = true;
	#endedState: boolean = false;
	#playGeneration: number = 0;
	#previousRestartThreshold: number = DEFAULTS.previousRestartThreshold;

	constructor(options?: PWAudioOptions) {
		this.#audio = new Audio();

		// Apply preload before any load
		this.#audio.preload = options?.preload ?? DEFAULTS.preload;

		// Apply volume and playbackRate
		this.#audio.volume = clampVolume(options?.volume ?? DEFAULTS.volume);
		this.#audio.playbackRate = clampPlaybackRate(options?.playbackRate ?? DEFAULTS.playbackRate);

		// Set preservesPitch (with webkit prefix) — see Plan 09
		this.#applyPreservesPitch(true);

		// Initialize event system
		this.#events = new EventManager(this);
		this.#events.attachNativeProxies(this.#audio);

		// Handle initial tracks/src
		if (options?.tracks && options.tracks.length > 0) {
			this.#tracks = [...options.tracks];
			this.#currentIndex = 0;
			this.#audio.src = this.#tracks[0].src;
		} else if (options?.src) {
			this.#tracks = [{ src: options.src }];
			this.#currentIndex = 0;
			this.#audio.src = options.src;
		}

		// Register native event handlers for internal logic
		this.#audio.addEventListener("ended", this.#handleEnded);
		this.#audio.addEventListener("error", this.#handleError);
	}

	// ─── Playback ───

	play(): Promise<void> {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}

		if (this.#tracks.length === 0) {
			return Promise.reject(new Error("No track loaded"));
		}

		// Clear ended state on explicit play
		this.#endedState = false;
		this.#stopped = false;

		return this.#audio.play();
	}

	pause(): void {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#audio.pause();
	}

	stop(): void {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#audio.pause();
		this.#audio.currentTime = 0;
		this.#stopped = true;
		this.#endedState = false;
		this.#events.emit("stop");
	}

	get playing(): boolean {
		if (this.#destroyed) return false;
		return !this.#audio.paused;
	}

	get paused(): boolean {
		if (this.#destroyed) return true;
		// paused = audio.paused AND NOT stopped AND NOT endedState
		return this.#audio.paused && !this.#stopped && !this.#endedState;
	}

	get stopped(): boolean {
		if (this.#destroyed) return true;
		return this.#stopped;
	}

	get endedState(): boolean {
		return this.#endedState;
	}

	// ─── Seek & Time ───

	get currentTime(): number {
		return this.#audio.currentTime;
	}

	set currentTime(seconds: number) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#audio.currentTime = seconds;
	}

	get duration(): number {
		return this.#audio.duration;
	}

	get buffered(): TimeRanges {
		return this.#audio.buffered;
	}

	get seeking(): boolean {
		return this.#audio.seeking;
	}

	// ─── Volume ───

	get volume(): number {
		return this.#audio.volume;
	}

	set volume(v: number) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#audio.volume = clampVolume(v);
	}

	get muted(): boolean {
		return this.#audio.muted;
	}

	set muted(m: boolean) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#audio.muted = m;
	}

	// ─── Playback Rate ───

	get playbackRate(): number {
		return this.#audio.playbackRate;
	}

	set playbackRate(rate: number) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#audio.playbackRate = clampPlaybackRate(rate);
	}

	get preservesPitch(): boolean {
		// Check standard property first, fall back to webkit prefix
		if ("preservesPitch" in this.#audio) {
			return (this.#audio as any).preservesPitch;
		}
		return (this.#audio as any).webkitPreservesPitch ?? true;
	}

	set preservesPitch(v: boolean) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#applyPreservesPitch(v);
	}

	#applyPreservesPitch(v: boolean): void {
		if ("preservesPitch" in this.#audio) {
			(this.#audio as any).preservesPitch = v;
		}
		if ("webkitPreservesPitch" in this.#audio) {
			(this.#audio as any).webkitPreservesPitch = v;
		}
	}

	// ─── Source (single-track mode) ───

	get src(): string {
		return this.#audio.src;
	}

	set src(url: string) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		// Destructive: replaces entire playlist with single-track
		const previousIndex = this.#currentIndex;
		this.#tracks = [{ src: url }];
		this.#currentIndex = 0;
		this.#audio.src = url;
		this.#audio.preload = this.#preloadStrategy;
		this.#stopped = true;
		this.#endedState = false;
		this.#events.emit("playlistchange", { tracks: this.#tracks });
		if (previousIndex !== this.#currentIndex || previousIndex !== -1) {
			this.#events.emit("trackchange", {
				previousIndex,
				currentIndex: this.#currentIndex,
				track: this.#tracks[0] ?? null,
			});
		}
	}

	#preloadStrategy: PreloadStrategy = DEFAULTS.preload;

	get preload(): PreloadStrategy {
		return this.#preloadStrategy;
	}

	set preload(strategy: PreloadStrategy) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#preloadStrategy = strategy;
		this.#audio.preload = strategy;
	}

	// ─── Playlist (basic getter/setter — navigation in Plan 04) ───

	get tracks(): readonly Track[] {
		return this.#tracks;
	}

	set tracks(newTracks: Track[]) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		const previousIndex = this.#currentIndex;
		const currentSrc = this.#currentTrack()?.src;

		this.#tracks = [...newTracks];

		if (newTracks.length === 0) {
			this.#currentIndex = -1;
		} else if (currentSrc) {
			const newIndex = newTracks.findIndex((t) => t.src === currentSrc);
			this.#currentIndex = newIndex !== -1 ? newIndex : 0;
		} else {
			this.#currentIndex = 0;
		}

		// Playlist replacement while shuffle is on regenerates shuffle order
		// (handled in Plan 05)

		this.#events.emit("playlistchange", { tracks: this.#tracks });

		if (previousIndex !== this.#currentIndex) {
			this.#events.emit("trackchange", {
				previousIndex,
				currentIndex: this.#currentIndex,
				track: this.#currentTrack(),
			});
		}
	}

	get currentIndex(): number {
		return this.#currentIndex;
	}

	get currentTrack(): Track | null {
		return this.#currentTrack();
	}

	#currentTrack(): Track | null {
		if (this.#currentIndex < 0 || this.#currentIndex >= this.#tracks.length) {
			return null;
		}
		return this.#tracks[this.#currentIndex] ?? null;
	}

	// ─── Repeat (basic getter/setter — logic in Plan 05) ───

	get repeat(): RepeatMode {
		return this.#repeat;
	}

	set repeat(mode: RepeatMode) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#repeat = mode;
	}

	// ─── Shuffle (basic getter/setter — logic in Plan 05) ───

	get shuffle(): ShuffleMode {
		return this.#shuffle;
	}

	set shuffle(mode: ShuffleMode) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#shuffle = mode;
	}

	// ─── Previous restart threshold ───

	get previousRestartThreshold(): number {
		return this.#previousRestartThreshold;
	}

	set previousRestartThreshold(seconds: number) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#previousRestartThreshold = seconds;
	}

	// ─── Media Session (getter/setter only — logic in Plan 07) ───

	get mediaSessionEnabled(): boolean {
		return this.#mediaSessionEnabled;
	}

	set mediaSessionEnabled(v: boolean) {
		if (this.#destroyed) {
			throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
		}
		this.#mediaSessionEnabled = v;
	}

	// ─── Events ───

	on<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		this.#events.on(event, handler);
	}

	once<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		this.#events.once(event, handler);
	}

	off<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		this.#events.off(event, handler);
	}

	// ─── Internal handlers (stubs — filled in later plans) ───

	#handleEnded = (): void => {
		// Filled in Plan 05 (repeat modes) and Plan 06 (concurrency guard)
		this.#endedState = true;
	};

	#handleError = (): void => {
		// Filled in Plan 08 (error handling)
	};

	// ─── Placeholder methods filled in Plan 04 ───

	next(): Promise<void> {
		return Promise.resolve();
	}

	previous(): Promise<void> {
		return Promise.resolve();
	}

	goto(_index: number): Promise<void> {
		return Promise.resolve();
	}

	// ─── Placeholder for Plan 07 ───

	#loadTrack(_track: Track): void {
		// Filled in Plan 04
	}

	// ─── Placeholder for Plan 10 ───

	destroy(): void {
		// Filled in Plan 10
	}
}
```

## Key Design Points

1. **State matrix for `paused`/`stopped`/`endedState`**: These three getters decode distinct player states from the underlying `HTMLAudioElement.paused` plus internal flags. Refer to DESIGN.md §5 `paused` getter for the exact matrix.

2. **`play()` after `ended`**: When `play()` is called after a track has ended naturally, it clears `#endedState` and restarts playback. This matches native `HTMLAudioElement` behavior.

3. **`stop()` event cascade**: `stop()` calls `pause()` then `currentTime = 0` on the audio element. The native side effects (`pause`, `seeking`, `seeked` events) are unavoidable. The synthetic `stop` event fires **after** these native events.

4. **`src` setter is destructive**: Setting `src` replaces the entire playlist (per DESIGN.md §6.7). It clears shuffle state and resets `currentIndex`.

5. **`tracks` setter preserves position**: If the current track's `src` exists in the new playlist, `currentIndex` stays at that position (first occurrence wins on duplicates).

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. Creating `const player = new PWAudio()` succeeds without error.
3. `const player = new PWAudio({ src: "test.mp3" })` sets `player.src` correctly.
4. `const player = new PWAudio({ tracks: [{src: "a.mp3"}, {src: "b.mp3"}] })` sets playlist and `currentIndex === 0`.
5. When `tracks` option is provided alongside `src`, `tracks` takes precedence.
6. `player.play()` on empty playlist rejects with `"No track loaded"`.
7. `player.stop()` fires the `stop` synthetic event.
8. `player.paused` returns `true` only when the player is manually paused (not stopped or ended).
9. `player.stopped` returns `true` initially and after `stop()`.
10. All setters throw `DOMException` with name `"InvalidStateError"` after `destroy()` (once Plan 10 is implemented — stubs for now).
