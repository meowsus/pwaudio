import type {
	Track,
	PWAudioOptions,
	RepeatMode,
	ShuffleMode,
	PreloadStrategy,
	PlayerEvent,
	PlayerEventHandlerMap,
} from "./types";
import { DEFAULTS, DESTROYED_ERROR_MESSAGE, NO_TRACK_LOADED_MESSAGE } from "./constants";
import { clampVolume, clampPlaybackRate } from "./utils";
import { EventManager } from "./events";
import { ShuffleManager } from "./shuffle";
import { MediaSessionManager } from "./media-session";

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
	#userPaused: boolean = false;
	#playGeneration: number = 0;
	#previousRestartThreshold: number = DEFAULTS.previousRestartThreshold;
	#shuffleManager = new ShuffleManager();
	#mediaSession: MediaSessionManager;

	/** Snapshot of the track that was last loaded via #loadTrack, used by #handleError */
	#lastLoadedTrack: Track | null = null;
	#lastLoadedIndex: number = -1;

	constructor(options?: PWAudioOptions) {
		this.#audio = new Audio();

		// Apply preload — assign to #preloadStrategy first, then apply to audio
		this.#preloadStrategy = options?.preload ?? DEFAULTS.preload;
		this.#audio.preload = this.#preloadStrategy;

		// Apply volume and playbackRate
		this.#audio.volume = clampVolume(options?.volume ?? DEFAULTS.volume);
		this.#audio.playbackRate = clampPlaybackRate(options?.playbackRate ?? DEFAULTS.playbackRate);

		// Apply constructor-only options
		this.#repeat = options?.repeat ?? DEFAULTS.repeat;
		this.#shuffle = options?.shuffle ?? DEFAULTS.shuffle;
		this.#mediaSessionEnabled = options?.mediaSessionEnabled ?? DEFAULTS.mediaSessionEnabled;
		this.#previousRestartThreshold =
			options?.previousRestartThreshold ?? DEFAULTS.previousRestartThreshold;

		// Set preservesPitch (with webkit prefix) — see Plan 09
		this.#applyPreservesPitch(true);

		// Initialize event system — #target is the internal dispatch target
		this.#events = new EventManager(this.#target);
		this.#events.attachNativeProxies(this.#audio);

		// Register native event handlers for internal logic
		this.#audio.addEventListener("ended", this.#handleEnded);
		this.#audio.addEventListener("error", this.#handleError);

		// Initialize Media Session manager
		this.#mediaSession = new MediaSessionManager(this.#audio);
		this.#mediaSession.enabled = this.#mediaSessionEnabled;

		// Set up Media Session action handlers
		this.#mediaSession.setActionHandlers({
			play: () => this.play(),
			pause: () => this.pause(),
			stop: () => this.stop(),
			seekto: (details) => {
				if (details.fastSeek && "fastSeek" in this.#audio) {
					(this.#audio as any).fastSeek(details.seekTime);
				} else {
					this.#audio.currentTime = details.seekTime ?? 0;
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

		// Update Media Session playbackState on play/pause native events
		this.#audio.addEventListener("play", this.#handlePlayState);
		this.#audio.addEventListener("pause", this.#handlePauseState);

		// Throttled position state update on timeupdate
		this.#audio.addEventListener("timeupdate", this.#handleTimeUpdate);

		// Full position state update on ratechange
		this.#audio.addEventListener("ratechange", this.#handleRateChange);

		// Handle initial tracks/src
		if (options?.tracks && options.tracks.length > 0) {
			this.#tracks = [...options.tracks];
			this.#currentIndex = 0;
			this.#lastLoadedTrack = this.#tracks[0];
			this.#lastLoadedIndex = 0;
			this.#audio.src = this.#tracks[0].src;
		} else if (options?.src) {
			this.#tracks = [{ src: options.src }];
			this.#currentIndex = 0;
			this.#lastLoadedTrack = this.#tracks[0];
			this.#lastLoadedIndex = 0;
			this.#audio.src = options.src;
		}

		// Initial Media Session update if we have a track
		if (this.#currentTrack()) {
			this.#updateMediaSession();
		}
	}

	// ─── Playback ───

	async play(): Promise<void> {
		this.#throwIfDestroyed();

		if (this.#tracks.length === 0) {
			return Promise.reject(new Error(NO_TRACK_LOADED_MESSAGE));
		}

		// Capture generation before any state mutation — guards against stale play() calls
		// that are superseded by next(), previous(), goto(), stop(), or destroy()
		const generation = this.#playGeneration;

		// If ended, restart from beginning
		if (this.#endedState) {
			this.#audio.currentTime = 0;
		}

		this.#endedState = false;
		this.#stopped = false;
		this.#userPaused = false;

		try {
			await this.#audio.play();
		} catch (error) {
			// If another track was loaded while we were waiting, discard the error
			if (this.#playGeneration !== generation) {
				return; // stale generation — silently discard
			}
			throw error;
		}

		// Discard stale results: if another operation superseded us, roll back state
		if (this.#playGeneration !== generation) {
			return; // stale generation — silently discard
		}

		// Re-check destroyed after await — destroy() bumps #playGeneration
		// but as a belt-and-suspenders guard:
		if (this.#destroyed) return;
	}

	pause(): void {
		this.#throwIfDestroyed();
		this.#userPaused = true;
		this.#audio.pause();
	}

	/**
	 * Stop playback: pause and seek to 0. Emits 'stop'.
	 *
	 * Event cascade: pause → seeking → seeked → stop.
	 * Consumers should treat 'stop' as the definitive signal;
	 * the native side effects (pause, seeking, seeked) are unavoidable.
	 */
	stop(): void {
		this.#throwIfDestroyed();
		this.#playGeneration++; // invalidate in-flight play() promises
		this.#audio.pause();
		this.#audio.currentTime = 0;
		this.#stopped = true;
		this.#endedState = false;
		this.#userPaused = false;
		this.#events.emit("stop");
	}

	get playing(): boolean {
		if (this.#destroyed) return false;
		return !this.#audio.paused && !this.#stopped;
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

	/** Whether playback has ended (track finished with repeat=off). */
	get ended(): boolean {
		if (this.#destroyed) return false;
		return this.#endedState;
	}

	/** @deprecated Use ended instead */
	get endedState(): boolean {
		return this.ended;
	}

	/** Whether the instance has been destroyed. */
	get destroyed(): boolean {
		return this.#destroyed;
	}

	// ─── Seek & Time ───

	get currentTime(): number {
		if (this.#destroyed) return 0;
		return this.#audio.currentTime;
	}

	set currentTime(seconds: number) {
		this.#throwIfDestroyed();
		this.#audio.currentTime = seconds;
	}

	get duration(): number {
		if (this.#destroyed) return NaN;
		return this.#audio.duration;
	}

	get buffered(): TimeRanges {
		if (this.#destroyed) return this.#audio.buffered; // empty after destroy
		return this.#audio.buffered;
	}

	get seeking(): boolean {
		if (this.#destroyed) return false;
		return this.#audio.seeking;
	}

	// ─── Volume ───

	/**
	 * Volume level, clamped to 0–1. Values outside this range are
	 * clamped rather than thrown. Matches HTMLAudioElement behavior.
	 * Default: 1
	 *
	 * Note: Programmatic volume control is disabled on many mobile
	 * browsers (iOS Safari, Android Chrome). The setter will not throw,
	 * but the value may be ignored by the OS.
	 */
	get volume(): number {
		if (this.#destroyed) return 0;
		return this.#audio.volume;
	}

	set volume(v: number) {
		this.#throwIfDestroyed();
		this.#audio.volume = clampVolume(v);
	}

	get muted(): boolean {
		if (this.#destroyed) return false;
		return this.#audio.muted;
	}

	set muted(m: boolean) {
		this.#throwIfDestroyed();
		this.#audio.muted = m;
	}

	// ─── Playback Rate ───

	/**
	 * Playback rate multiplier, clamped to 0.25–4.0.
	 * Values outside this range are silently clamped.
	 * Default: 1
	 */
	get playbackRate(): number {
		if (this.#destroyed) return 1;
		return this.#audio.playbackRate;
	}

	set playbackRate(rate: number) {
		this.#throwIfDestroyed();
		this.#audio.playbackRate = clampPlaybackRate(rate);
	}

	/**
	 * Whether pitch is preserved when playbackRate ≠ 1.
	 * Default: true (maps to HTMLAudioElement.preservesPitch)
	 *
	 * Safari < 17 requires the -webkit- prefixed version.
	 * Both properties are set for maximum compatibility.
	 */
	get preservesPitch(): boolean {
		if (this.#destroyed) return true;
		if ("preservesPitch" in this.#audio) {
			return (this.#audio as any).preservesPitch;
		}
		if ("webkitPreservesPitch" in this.#audio) {
			return (this.#audio as any).webkitPreservesPitch;
		}
		return true; // default per spec
	}

	/**
	 * Set whether pitch is preserved when playbackRate ≠ 1.
	 * Sets both preservesPitch and webkitPreservesPitch for
	 * maximum browser compatibility.
	 */
	set preservesPitch(v: boolean) {
		this.#throwIfDestroyed();
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
		if (this.#destroyed) return "";
		return this.#audio.src;
	}

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
	set src(url: string) {
		this.#throwIfDestroyed();
		// Destructive: replaces entire playlist with single-track
		this.#playGeneration++; // invalidate in-flight play() promises
		this.#audio.pause(); // pause before changing source
		const previousIndex = this.#currentIndex;
		const track: Track = { src: url };
		this.#tracks = [track];
		this.#currentIndex = 0;
		this.#audio.src = url;
		this.#audio.preload = this.#preloadStrategy;
		this.#stopped = true;
		this.#endedState = false;
		this.#shuffleManager.clear(); // reset stale shuffle state

		// Snapshot track info for #handleError
		this.#lastLoadedTrack = track;
		this.#lastLoadedIndex = this.#currentIndex;

		this.#updateMediaSession();

		this.#events.emit("playlistchange", { tracks: this.#tracks });
		// Always emit trackchange for src setter — it's a destructive operation
		// that replaces the playlist. Even if index stays at 0, the track content has changed.
		if (previousIndex !== this.#currentIndex || previousIndex !== -1) {
			this.#events.emit("trackchange", {
				previousIndex,
				currentIndex: this.#currentIndex,
				track,
			});
		}
	}

	#preloadStrategy: PreloadStrategy = DEFAULTS.preload;

	get preload(): PreloadStrategy {
		if (this.#destroyed) return "none";
		return this.#preloadStrategy;
	}

	set preload(strategy: PreloadStrategy) {
		this.#throwIfDestroyed();
		this.#preloadStrategy = strategy;
		this.#audio.preload = strategy;
	}

	// ─── Playlist (basic getter/setter — navigation in Plan 04) ───

	get tracks(): readonly Track[] {
		if (this.#destroyed) return [];
		return this.#tracks;
	}

	set tracks(newTracks: Track[]) {
		this.#throwIfDestroyed();
		const previousIndex = this.#currentIndex;
		const currentSrc = this.#currentTrack()?.src;

		this.#tracks = [...newTracks];

		if (newTracks.length === 0) {
			this.#currentIndex = -1;
			this.#shuffleManager.clear(); // reset stale shuffle state
		} else if (currentSrc) {
			const newIndex = newTracks.findIndex((t) => t.src === currentSrc);
			this.#currentIndex = newIndex !== -1 ? newIndex : 0;

			// If current song wasn't found, load the first track
			if (newIndex === -1) {
				this.#loadTrack(newTracks[0]);
			}

			// Regenerate shuffle order if shuffle is on
			if (this.#shuffle === "on") {
				this.#shuffleManager.generate(newTracks.length, this.#currentIndex);
			}
		} else {
			this.#currentIndex = 0;

			// Load the first track
			this.#loadTrack(newTracks[0]);

			// Regenerate shuffle order if shuffle is on
			if (this.#shuffle === "on") {
				this.#shuffleManager.generate(newTracks.length, this.#currentIndex);
			}
		}

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
		if (this.#destroyed) return -1;
		return this.#currentIndex;
	}

	get currentTrack(): Track | null {
		if (this.#destroyed) return null;
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
		if (this.#destroyed) return "off";
		return this.#repeat;
	}

	set repeat(mode: RepeatMode) {
		this.#throwIfDestroyed();
		this.#repeat = mode;
	}

	// ─── Shuffle (basic getter/setter — logic in Plan 05) ───

	get shuffle(): ShuffleMode {
		if (this.#destroyed) return "off";
		return this.#shuffle;
	}

	set shuffle(mode: ShuffleMode) {
		this.#throwIfDestroyed();
		if (this.#shuffle === mode) return; // no change

		this.#shuffle = mode;

		if (mode === "on") {
			// Generate shuffle order with current track at position 0
			this.#shuffleManager.generate(this.#tracks.length, this.#currentIndex);
		} else {
			// Clear shuffle state — currentIndex stays on the current track
			this.#shuffleManager.clear();
		}
	}

	// ─── Previous restart threshold ───

	get previousRestartThreshold(): number {
		if (this.#destroyed) return 0;
		return this.#previousRestartThreshold;
	}

	set previousRestartThreshold(seconds: number) {
		this.#throwIfDestroyed();
		this.#previousRestartThreshold = seconds;
	}

	// ─── Media Session ──

	get mediaSessionEnabled(): boolean {
		if (this.#destroyed) return false;
		return this.#mediaSession.enabled;
	}

	set mediaSessionEnabled(v: boolean) {
		this.#throwIfDestroyed();
		this.#mediaSessionEnabled = v;
		this.#mediaSession.enabled = v;
		if (v) {
			this.#updateMediaSession();
		} else {
			this.#mediaSession.clear();
		}
	}

	// ─── Events ───

	on<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		this.#throwIfDestroyed();
		this.#events.on(event, handler);
	}

	once<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		this.#throwIfDestroyed();
		this.#events.once(event, handler);
	}

	off<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		this.#throwIfDestroyed();
		this.#events.off(event, handler);
	}

	// ─── Internal handlers (stubs — filled in later plans) ───

	#handleEnded = (): void => {
		// Stale ended event — no tracks loaded
		if (this.#tracks.length === 0) return;

		// Ignore ended event if stopped — avoids contradictory stopped+endedState
		if (this.#stopped) return;

		this.#endedState = true;

		// Capture generation to detect if another operation supersedes us
		const generation = this.#playGeneration;

		if (this.#repeat === "one") {
			this.#endedState = false;
			this.#audio.currentTime = 0;
			this.#mediaSessionKeepAlive();
			void this.play().catch(() => {}); // guarded by playGeneration
			return;
		}

		// Single-track with repeat=all is equivalent to repeat=one
		if (this.#repeat === "all" && this.#tracks.length === 1) {
			this.#endedState = false;
			this.#audio.currentTime = 0;
			this.#mediaSessionKeepAlive();
			void this.play().catch(() => {}); // guarded by playGeneration
			return;
		}

		if (this.#repeat === "all") {
			// If a new track was loaded since the ended event fired, don't advance
			if (this.#playGeneration !== generation) return;
			this.#mediaSessionKeepAlive();
			void this.next().catch(() => {});
			return;
		}

		// Not at the end — advance
		if (this.#currentIndex < this.#tracks.length - 1 || this.#shuffle === "on") {
			// If a new track was loaded since the ended event fired, don't advance
			if (this.#playGeneration !== generation) return;
			this.#mediaSessionKeepAlive();
			void this.next().catch(() => {});
			return;
		}

		// repeat=off, at the end — stay in endedState
	};

	/**
	 * Keep mediaSession.playbackState = "playing" during track transitions so
	 * mobile browsers (Chrome Android) continue treating this tab as an active
	 * media player, preventing throttling and MEDIA_ERR_ABORTED errors.
	 */
	#mediaSessionKeepAlive = (): void => {
		if (this.#mediaSession.enabled && !this.#destroyed) {
			this.#mediaSession.setPlaybackState("playing");
		}
	};

	#handleError = (): void => {
		// Use the snapshot taken at load time, not current state.
		// After #loadTrack() is called for a new track (incrementing generation),
		// #currentIndex may already point to the new track. The error event
		// fires for the previous src, so we report the track that was loading.
		this.#events.emit("trackerror", {
			error: this.#audio.error,
			track: this.#lastLoadedTrack,
			index: this.#lastLoadedIndex,
		});
	};

	// ─── Playlist navigation ───

	async next(): Promise<void> {
		this.#throwIfDestroyed();

		if (this.#tracks.length === 0) {
			return;
		}

		const previousIndex = this.#currentIndex;
		let nextIndex: number;

		if (this.#shuffle === "on") {
			const shuffledNext = this.#shuffleManager.next(this.#repeat === "all");
			if (shuffledNext === -1) {
				if (this.#repeat === "all") {
					// Regenerate shuffle order and start from the beginning
					this.#shuffleManager.generate(this.#tracks.length, this.#currentIndex);
					nextIndex = this.#shuffleManager.next(true);
					if (nextIndex === -1) return; // shouldn't happen but guard
				} else {
					// At the end with repeat=off
					return;
				}
			} else {
				nextIndex = shuffledNext;
			}
		} else {
			nextIndex = this.#currentIndex + 1;
			if (nextIndex >= this.#tracks.length) {
				if (this.#repeat === "all") {
					nextIndex = 0;
				} else {
					return; // repeat=off, at the end
				}
			}
		}

		this.#currentIndex = nextIndex;
		this.#endedState = false;

		const track = this.#currentTrack();
		if (!track) return;

		this.#loadTrack(track);
		this.#events.emit("trackchange", {
			previousIndex,
			currentIndex: this.#currentIndex,
			track,
		});

		return this.play();
	}

	async previous(): Promise<void> {
		this.#throwIfDestroyed();

		if (this.#tracks.length === 0) {
			return; // empty playlist — no-op
		}

		// If beyond threshold, restart current track
		if (this.#audio.currentTime > this.#previousRestartThreshold) {
			this.#audio.currentTime = 0;
			this.#endedState = false;
			if (!this.#audio.paused) return; // already playing, just seeked
			return this.play();
		}

		const previousIndex = this.#currentIndex;
		let prevIndex: number;

		if (this.#shuffle === "on") {
			const shuffledPrev = this.#shuffleManager.previous();
			if (shuffledPrev === -1) {
				// No history — restart current track
				this.#audio.currentTime = 0;
				this.#endedState = false;
				if (!this.#audio.paused) return;
				return this.play();
			}
			prevIndex = shuffledPrev;
		} else {
			prevIndex = this.#currentIndex - 1;
			if (prevIndex < 0) {
				if (this.#repeat === "all") {
					prevIndex = this.#tracks.length - 1;
				} else {
					prevIndex = 0; // clamp to first track
				}
			}
		}

		this.#currentIndex = prevIndex;
		this.#endedState = false;

		const track = this.#currentTrack();
		if (!track) return;

		this.#loadTrack(track);
		this.#events.emit("trackchange", {
			previousIndex,
			currentIndex: this.#currentIndex,
			track,
		});

		return this.play();
	}

	async goto(index: number): Promise<void> {
		this.#throwIfDestroyed();

		if (this.#tracks.length === 0) {
			return; // empty playlist — no-op
		}

		// Clamp index
		const clampedIndex = Math.max(0, Math.min(index, this.#tracks.length - 1));
		const previousIndex = this.#currentIndex;

		if (clampedIndex === previousIndex) {
			// Same track — just restart
			this.#audio.currentTime = 0;
			this.#endedState = false;
			if (!this.#audio.paused) return;
			return this.play();
		}

		this.#currentIndex = clampedIndex;
		this.#endedState = false;

		if (this.#shuffle === "on") {
			this.#shuffleManager.pushToHistory(clampedIndex);
		}

		const track = this.#currentTrack();
		if (!track) return;

		this.#loadTrack(track);
		this.#events.emit("trackchange", {
			previousIndex,
			currentIndex: this.#currentIndex,
			track,
		});

		return this.play();
	}

	// ─── Internal ───

	#loadTrack(track: Track): void {
		this.#playGeneration++;
		this.#stopped = false;
		this.#endedState = false;

		// Snapshot track info for #handleError — the error event fires
		// for the src that was loading, which may no longer be current.
		this.#lastLoadedTrack = track;
		this.#lastLoadedIndex = this.#currentIndex;

		this.#audio.src = track.src;
		this.#audio.preload = this.#preloadStrategy;
		this.#updateMediaSession();
	}

	/**
	 * Update Media Session metadata, action handlers, and position state.
	 * Called on trackchange and when mediaSession is re-enabled.
	 */
	#updateMediaSession(): void {
		const track = this.#currentTrack();
		if (!track) return;

		this.#mediaSession.updateMetadata(track, () => (this.#audio.paused ? "paused" : "playing"));

		this.#mediaSession.setActionHandlers({
			play: () => this.play(),
			pause: () => this.pause(),
			stop: () => this.stop(),
			seekto: (details) => {
				if (details.fastSeek && "fastSeek" in this.#audio) {
					(this.#audio as any).fastSeek(details.seekTime);
				} else {
					this.#audio.currentTime = details.seekTime ?? 0;
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

		// Emit mediacardchange event
		this.#events.emit("mediacardchange", {
			title: track.title ?? "",
			artist: track.artist ?? "",
			album: track.album ?? "",
			artwork: track.artwork ?? [],
		});
	}

	/** Handles native play event — updates Media Session playbackState. */
	#handlePlayState = (): void => {
		if (!this.#destroyed && this.#mediaSession.enabled) {
			this.#mediaSession.setPlaybackState("playing");
		}
	};

	/** Handles native pause event — updates Media Session playbackState.
	 *
	 *  When a track naturally ends, the browser fires a `pause` event after `ended`.
	 *  If we blindly set playbackState = "paused" here, mobile Chrome sees the tab
	 *  as idle and may throttle it (aborting fetches, suspending JS). By keeping
	 *  playbackState = "playing" during track transitions (!#userPaused),
	 *  we tell the browser this tab is still an active media player, which prevents
	 *  throttling and keeps the lock-screen notification alive.
	 */
	#handlePauseState = (): void => {
		if (this.#destroyed || !this.#mediaSession.enabled) return;

		// During a track transition (user didn't pause — #userPaused is false),
		// the audio element pauses between tracks. Keep playbackState = "playing"
		// so the browser keeps the tab alive as an active media player.
		if (!this.#stopped && !this.#userPaused) {
			this.#mediaSession.setPlaybackState("playing");
		} else {
			this.#mediaSession.setPlaybackState("paused");
		}
	};

	/** Handles timeupdate — throttled position state update. */
	#handleTimeUpdate = (): void => {
		if (!this.#destroyed) {
			this.#mediaSession.throttleSetPositionState();
		}
	};

	/** Handles ratechange — full position state update. */
	#handleRateChange = (): void => {
		if (!this.#destroyed) {
			this.#mediaSession.setPositionState();
		}
	};

	// ─── Lifecycle ───

	/**
	 * Tear down the player completely:
	 *   1. Pause playback
	 *   2. Remove all event listeners (native proxies + internal + synthetic)
	 *   3. Clear Media Session metadata and action handlers
	 *   4. Set audio.src = '' and call audio.load() to abort in-flight requests
	 *   5. Remove the src attribute
	 *   6. Set the #destroyed flag
	 *
	 * Idempotent — calling multiple times is safe.
	 * After destroy(), all setters and methods throw DOMException
	 * with name "InvalidStateError". Getters return safe defaults.
	 */
	destroy(): void {
		if (this.#destroyed) return; // Idempotent

		// Invalidate in-flight play() continuations before async resumes
		this.#playGeneration++;

		// 1. Pause playback
		this.#audio.pause();

		// 2. Remove all event listeners

		// Remove proxied native events (play, pause, ended, timeupdate, etc.)
		this.#events.detachNativeProxies(this.#audio);

		// Remove internal native handlers
		this.#audio.removeEventListener("ended", this.#handleEnded);
		this.#audio.removeEventListener("error", this.#handleError);
		this.#audio.removeEventListener("timeupdate", this.#handleTimeUpdate);
		this.#audio.removeEventListener("ratechange", this.#handleRateChange);
		this.#audio.removeEventListener("play", this.#handlePlayState);
		this.#audio.removeEventListener("pause", this.#handlePauseState);

		// Remove all synthetic event listeners
		this.#events.removeAllListeners();

		// 3. Clear Media Session metadata and action handlers
		this.#mediaSession.clear();

		// 4. Abort any in-flight network request
		this.#audio.src = "";
		this.#audio.load();

		// 5. Remove src attribute
		this.#audio.removeAttribute("src");

		// 6. Set destroyed flag
		this.#destroyed = true;
	}

	/**
	 * Throw a DOMException if the instance has been destroyed.
	 * Used as a guard at the top of every public setter and mutating method.
	 */
	#throwIfDestroyed(): void {
		if (this.#destroyed) {
			throw new DOMException(DESTROYED_ERROR_MESSAGE, "InvalidStateError");
		}
	}
}
