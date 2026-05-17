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
	#target: EventTarget = new EventTarget();

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

		// Initialize event system — #target is the internal dispatch target
		this.#events = new EventManager(this.#target);
		this.#events.attachNativeProxies(this.#audio);

		// Register native event handlers for internal logic
		this.#audio.addEventListener("ended", this.#handleEnded);
		this.#audio.addEventListener("error", this.#handleError);

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
