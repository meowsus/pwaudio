import type {
	Track,
	PWAudioOptions,
	RepeatMode,
	ShuffleMode,
	PreloadStrategy,
	PlayerEvent,
	PlayerEventHandlerMap,
} from "./types";
import {
	DEFAULTS,
	DESTROYED_ERROR_MESSAGE,
	NO_TRACK_LOADED_MESSAGE,
	PRELOAD_THRESHOLD_SECONDS,
	PLAYBACK_WATCHDOG_INTERVAL_MS,
	PLAYBACK_STALL_THRESHOLD_SECONDS,
} from "./constants";
import { clampVolume, clampPlaybackRate, isFiniteDuration } from "./utils";
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

	// ─── Preloading ───

	/**
	 * Secondary audio element used exclusively to preload the next track's
	 * data into the browser's HTTP cache. When the current track is within
	 * `#preloadThreshold` seconds of ending, this element's `src` is set to
	 * the next track's URL with `preload="auto"`, causing the browser to fetch
	 * the full audio file. When the player later advances to that track via
	 * `#loadTrack()`, the browser can serve the data from its cache instead of
	 * making a new network request — critical on mobile devices where the
	 * screen is off and background network requests are throttled or killed.
	 *
	 * Created lazily to avoid capturing it in test mocks that intercept Audio()
	 * construction to capture the main audio element.
	 */
	#preloadAudio: HTMLAudioElement | null = null;

	/**
	 * Seconds before the end of the current track to start preloading the next.
	 * Set to 0 or less to disable preloading. Default: 20.
	 */
	#preloadThreshold: number = PRELOAD_THRESHOLD_SECONDS;

	/**
	 * Get or create the preload audio element.
	 */
	#getPreloadAudio(): HTMLAudioElement {
		if (!this.#preloadAudio) {
			this.#preloadAudio = new Audio();
			this.#preloadAudio.preload = "auto";
		}
		return this.#preloadAudio;
	}

	/**
	 * Revoke the pre-fetched blob URL, if any.
	 * Called on lifecycle changes (destroy, new track, mode changes) to
	 * prevent memory leaks from unreferenced blob:// URLs.
	 */
	#revokeBlobUrl(): void {
		if (this.#nextTrackBlobUrl) {
			URL.revokeObjectURL(this.#nextTrackBlobUrl);
			this.#nextTrackBlobUrl = null;
		}
		this.#nextTrackBlobIndex = -1;
	}

	/**
	 * Fetch the next track's audio data as a Blob and create an object URL
	 * for synchronous consumption in #advanceToNextTrackSync.
	 *
	 * On success: stores the blob URL in #nextTrackBlobUrl for the sync handoff.
	 * On failure: falls back to setting the preloadAudio element's src to warm
	 * the HTTP cache (the traditional approach).
	 */
	async #fetchNextTrackAsBlob(track: Track, index: number): Promise<void> {
		if (this.#destroyed) return;

		try {
			const response = await fetch(track.src);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const blob = await response.blob();
			if (this.#destroyed) return; // re-check after await

			// Revoke any previous blob URL before creating a new one
			this.#revokeBlobUrl();

			this.#nextTrackBlobUrl = URL.createObjectURL(blob);
			this.#nextTrackBlobIndex = index;
		} catch {
			// Blob fetch failed — fall back to HTTP cache warming via
			// the preloadAudio element. The async path (next()/play())
			// will be used in #handleEnded if no blob URL is available.
			if (!this.#destroyed) {
				const preloadAudio = this.#getPreloadAudio();
				preloadAudio.src = track.src;
			}
		}
	}

	/**
	 * Whether the preload element has been started for the current track.
	 * Reset on track change so it doesn't re-trigger for the same track.
	 */
	#preloadStarted: boolean = false;

	/**
	 * The src URL currently loaded (or loading) on #preloadAudio.
	 * Used to avoid redundant preload kicks when timeupdate fires rapidly.
	 */
	#preloadedSrc: string = "";

	// ─── Blob prefetch (next track fetched as blob for sync handoff) ───

	/**
	 * Object URL for the next track's audio data, fetched as a Blob during
	 * #handlePreload. Consumed synchronously in #advanceToNextTrackSync so the
	 * src can be set and play() called without a network request — critical on
	 * mobile where background network requests are killed by the browser.
	 *
	 * Lifecycle: created in #fetchNextTrackAsBlob, consumed (set to null) in
	 * #advanceToNextTrackSync, or cleaned up via #revokeBlobUrl().
	 */
	#nextTrackBlobUrl: string | null = null;

	/**
	 * The playlist index that #nextTrackBlobUrl corresponds to.
	 * Validated in #advanceToNextTrackSync before consuming the blob URL.
	 */
	#nextTrackBlobIndex: number = -1;

	// ─── Background playback resilience ───

	/**
	 * Whether automatic background playback resilience is enabled.
	 * When true (default), PWAudio will:
	 *   - Listen for visibilitychange events and recover stalled playback when the
	 *     page returns to the foreground
	 *   - Run a periodic watchdog timer that detects playback stalls (currentTime
	 *     not advancing while the player believes it should be playing)
	 *   - Automatically attempt to resume playback after a stall
	 *   - Manage a Screen Wake Lock to prevent Chrome Android from revoking the
	 *     media session when the screen turns off
	 *
	 * These mechanisms address Chrome Android's aggressive background throttling,
	 * which can suspend the audio pipeline, stop timeupdate events, and revoke
	 * the media session notification for background tabs after as little as 1-5
	 * minutes.
	 */
	#backgroundPlaybackEnabled: boolean = true;

	/**
	 * Reference to the Screen Wake Lock sentinel, if active.
	 * A wake lock prevents Chrome Android from considering the page as "idle"
	 * and revoking the media session when the screen turns off.
	 *
	 * The wake lock is automatically released when the page becomes hidden
	 * (per the spec) and re-acquired when the page becomes visible again.
	 * When the user manually turns off the screen, the lock releases but
	 * Chrome continues to treat the page as an active media producer.
	 */
	#wakeLockSentinel: WakeLockSentinel | null = null;

	/**
	 * Whether we intend to hold a wake lock (i.e., playback is active).
	 * Used to re-acquire the lock after visibility changes.
	 */
	#wakeLockDesired: boolean = false;

	/**
	 * Timer ID for the playback health watchdog.
	 * Checks every PLAYBACK_WATCHDOG_INTERVAL_MS whether currentTime is
	 * advancing when it should be. If not, attempts recovery.
	 */
	#watchdogTimer: ReturnType<typeof setInterval> | null = null;

	/**
	 * The last observed currentTime value, used by the watchdog to detect stalls.
	 * Updated on each timeupdate event.
	 */
	#lastWatchdogTime: number = 0;

	/**
	 * The Date.now() timestamp when #lastWatchdogTime was last observed.
	 * Used by the watchdog to calculate how long currentTime has been stuck.
	 */
	#lastWatchdogTimestamp: number = 0;

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

		// Preload threshold — seconds before track end to start fetching the next track
		this.#preloadThreshold = options?.preloadThreshold ?? PRELOAD_THRESHOLD_SECONDS;

		// Background playback resilience
		this.#backgroundPlaybackEnabled = options?.backgroundPlayback ?? true;

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

		// Preload next track when approaching end of current track
		this.#audio.addEventListener("timeupdate", this.#handlePreload);

		// Full position state update on ratechange
		this.#audio.addEventListener("ratechange", this.#handleRateChange);

		// Background playback resilience: visibility change + wake lock + watchdog
		if (this.#backgroundPlaybackEnabled) {
			document.addEventListener("visibilitychange", this.#handleVisibilityChange);
		}

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

		// Background playback resilience: request wake lock and start watchdog
		this.#startBackgroundPlaybackProtection();
	}

	pause(): void {
		this.#throwIfDestroyed();
		this.#userPaused = true;
		this.#audio.pause();
		// Background playback resilience: release wake lock and stop watchdog
		this.#stopBackgroundPlaybackProtection();
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
		// Background playback resilience: release wake lock and stop watchdog
		this.#stopBackgroundPlaybackProtection();
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

		// Reset preload state — single-track mode, nothing to preload
		this.#preloadStarted = false;
		this.#preloadedSrc = "";
		// Revoke any pre-fetched blob URL — single-track mode
		this.#revokeBlobUrl();

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

		// Reset preload state — playlist changed, next track may be different
		this.#preloadStarted = false;
		this.#preloadedSrc = "";
		// Revoke any pre-fetched blob URL — next track may have changed
		this.#revokeBlobUrl();

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
		// Reset preload state — the next track may have changed (e.g. repeat mode changed from off to all)
		this.#preloadStarted = false;
		this.#preloadedSrc = "";
		// Revoke any pre-fetched blob URL — next track may have changed
		this.#revokeBlobUrl();
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

		// Reset preload state — the next track may have changed
		this.#preloadStarted = false;
		this.#preloadedSrc = "";
		// Revoke any pre-fetched blob URL — next track may have changed
		this.#revokeBlobUrl();

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

	// ─── Next-track preloading ───

	/**
	 * Seconds before the end of the current track to start preloading the next.
	 * Set to 0 or less to disable preloading. Default: 20.
	 *
	 * Preloading starts fetching the next track's audio data into the browser
	 * cache when the current track is within this many seconds of ending. This
	 * is critical on mobile devices where the browser throttles background tabs —
	 * without preloading, the network fetch for the next track may be killed,
	 * producing `MEDIA_ERR_SRC_NOT_SUPPORTED` ("Format error") and stopping playback.
	 */
	get preloadThreshold(): number {
		if (this.#destroyed) return 0;
		return this.#preloadThreshold;
	}

	set preloadThreshold(seconds: number) {
		this.#throwIfDestroyed();
		this.#preloadThreshold = seconds;
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

	// ─── Background Playback Resilience ───

	/**
	 * Whether background playback resilience is enabled.
	 * When true, PWAudio manages Screen Wake Lock, visibility-based recovery,
	 * and a playback stall watchdog to keep audio playing when the app is
	 * backgrounded on mobile devices.
	 *
	 * Default: true
	 */
	get backgroundPlayback(): boolean {
		if (this.#destroyed) return false;
		return this.#backgroundPlaybackEnabled;
	}

	set backgroundPlayback(v: boolean) {
		this.#throwIfDestroyed();
		if (v === this.#backgroundPlaybackEnabled) return;
		this.#backgroundPlaybackEnabled = v;
		if (v) {
			document.addEventListener("visibilitychange", this.#handleVisibilityChange);
			if (!this.#userPaused && !this.#stopped && !this.#audio.paused) {
				this.#startBackgroundPlaybackProtection();
			}
		} else {
			document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
			this.#stopBackgroundPlaybackProtection();
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

	// ─── Synchronous track transition ───

	/**
	 * Advance to the next track synchronously within the ended event handler,
	 * preserving Chrome's gesture token so play() is not rejected when the
	 * tab is backgrounded.
	 *
	 * Uses a pre-fetched blob URL (if available) to avoid network requests
	 * that would be killed on backgrounded mobile tabs. Falls back to the
	 * track's original src for the async path (next()/play()).
	 *
	 * Must only be called from #handleEnded or other synchronous event handlers
	 * where the browser's gesture token is still active on the call stack.
	 */
	#advanceToNextTrackSync(generation: number): void {
		if (this.#destroyed) return;

		// Compute next index (same logic as next())
		let nextIndex: number;

		if (this.#shuffle === "on") {
			const shuffledNext = this.#shuffleManager.next(this.#repeat === "all");
			if (shuffledNext === -1) {
				if (this.#repeat === "all") {
					this.#shuffleManager.generate(this.#tracks.length, this.#currentIndex);
					nextIndex = this.#shuffleManager.next(true);
					if (nextIndex === -1) return;
				} else {
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
					return;
				}
			}
		}

		// Stale generation guard — another operation superseded us
		if (this.#playGeneration !== generation) return;

		const previousIndex = this.#currentIndex;
		this.#currentIndex = nextIndex;
		this.#endedState = false;
		this.#stopped = false;
		this.#userPaused = false;
		this.#playGeneration++;

		// Keep media session alive during transition
		this.#mediaSessionKeepAlive();

		const track = this.#currentTrack();
		if (!track) return;

		// Snapshot for error handler
		this.#lastLoadedTrack = track;
		this.#lastLoadedIndex = this.#currentIndex;

		// Use pre-fetched blob URL if available and still valid for this index
		let src = track.src;
		let usedBlob = false;
		if (this.#nextTrackBlobUrl && this.#nextTrackBlobIndex === nextIndex) {
			src = this.#nextTrackBlobUrl;
			this.#nextTrackBlobUrl = null; // ownership transferred to audio element
			this.#nextTrackBlobIndex = -1;
			usedBlob = true;
		}

		// Set src synchronously, then call play() on the same call stack
		this.#audio.src = src;
		this.#audio.preload = this.#preloadStrategy;

		// Reset preload state for the new track
		this.#preloadStarted = false;

		// Clean up blob URL if it wasn't consumed (belt-and-suspenders)
		if (!usedBlob) {
			this.#revokeBlobUrl();
		}

		// Update media session
		this.#updateMediaSession();

		// Emit trackchange event
		this.#events.emit("trackchange", {
			previousIndex,
			currentIndex: this.#currentIndex,
			track,
		});

		// Start/restart background playback protection
		this.#startBackgroundPlaybackProtection();

		// Call play() synchronously — no await. Preserves gesture token from
		// the ended event that triggered this transition.
		void this.#audio.play().catch(() => {});
	}

	// ─── Internal handlers ───

	/**
	 * Handle the ended event from HTMLAudioElement.
	 *
	 * Uses synchronous track transition (#advanceToNextTrackSync) instead of
	 * async next()/play() to preserve Chrome's gesture token. On mobile,
	 * calling play() asynchronously after the ended callback returns can
	 * cause Chrome to reject the play() call, stopping playback.
	 */
	#handleEnded = (): void => {
		// Stale ended event — no tracks loaded
		if (this.#tracks.length === 0) return;

		// Ignore ended event if stopped — avoids contradictory stopped+endedState
		if (this.#stopped) return;

		this.#endedState = true;

		// Capture generation to detect if another operation supersedes us
		const generation = this.#playGeneration;

		// repeat=one: restart current track from beginning
		if (this.#repeat === "one") {
			this.#endedState = false;
			this.#audio.currentTime = 0;
			this.#mediaSessionKeepAlive();
			void this.#audio.play().catch(() => {});
			return;
		}

		// Single-track with repeat=all is equivalent to repeat=one
		if (this.#repeat === "all" && this.#tracks.length === 1) {
			this.#endedState = false;
			this.#audio.currentTime = 0;
			this.#mediaSessionKeepAlive();
			void this.#audio.play().catch(() => {});
			return;
		}

		// Advance to next track (repeat=all with multiple tracks,
		// or playlist continues with more tracks)
		if (
			this.#repeat === "all" ||
			this.#currentIndex < this.#tracks.length - 1 ||
			this.#shuffle === "on"
		) {
			// If a new track was loaded since the ended event fired, don't advance
			if (this.#playGeneration !== generation) return;
			this.#advanceToNextTrackSync(generation);
			return;
		}

		// repeat=off, at the end — stay in endedState
		this.#stopBackgroundPlaybackProtection();
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

		// Reset preload state for the new track — we may need to preload
		// the track after this one once the current track approaches its end.
		this.#preloadStarted = false;

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

	/** Handles timeupdate — throttled position state update + watchdog tracking. */
	#handleTimeUpdate = (): void => {
		if (this.#destroyed) return;
		this.#mediaSession.throttleSetPositionState();
		// Feed the watchdog — currentTime is advancing, update tracking state
		this.#lastWatchdogTime = this.#audio.currentTime;
		this.#lastWatchdogTimestamp = Date.now();
	};

	/**
	 * Handles timeupdate — preloads the next track when approaching end of the current track.
	 *
	 * On mobile devices (especially Chrome on Android), when the screen is off the browser
	 * aggressively throttles background tabs. If a track ends and the player needs to fetch
	 * the next track's audio data, the network request may be killed, producing
	 * `MEDIA_ERR_SRC_NOT_SUPPORTED` ("Format error"). By preloading the next track into the
	 * browser's HTTP cache before the current track ends, we ensure the data is available
	 * locally so the transition happens without a network request.
	 */
	#handlePreload = (): void => {
		if (this.#destroyed || this.#preloadThreshold <= 0) return;

		// Don't preload if stopped, no tracks, or already preloaded for this track
		if (this.#stopped || this.#tracks.length === 0 || this.#preloadStarted) return;

		const duration = this.#audio.duration;
		const currentTime = this.#audio.currentTime;

		// Need a finite duration and current time to determine proximity to end
		if (!isFiniteDuration(duration) || !isFiniteDuration(currentTime)) return;

		// Only preload if we're within the threshold of the end
		const remaining = duration - currentTime;
		if (remaining > this.#preloadThreshold) return;

		// Determine the next track
		let nextIndex: number;
		if (this.#repeat === "one") {
			// repeat=one replays the current track, no need to preload a different track
			return;
		} else if (this.#shuffle === "on") {
			const shuffledNext = this.#shuffleManager.peekNext(this.#repeat === "all");
			if (shuffledNext === -1) return; // no next track available
			nextIndex = shuffledNext;
		} else {
			// Ordered playback
			nextIndex = this.#currentIndex + 1;
			if (nextIndex >= this.#tracks.length) {
				if (this.#repeat === "all") {
					nextIndex = 0;
				} else {
					return; // repeat=off, at the end — no next track to preload
				}
			}
		}

		const nextTrack = this.#tracks[nextIndex];
		if (!nextTrack) return;

		// Don't preload if it's the same src (already loaded on the main element)
		if (nextTrack.src === this.#audio.src) return;

		// Don't preload if we've already preloaded this exact src
		if (nextTrack.src === this.#preloadedSrc) return;

		// Start preloading — two paths:
		//   1. Synchronously set the preloadAudio element's src to warm the HTTP
		//      cache (existing behavior, also serves as fallback if blob fetch fails).
		//   2. Kick off an async blob fetch to get the full audio in memory for
		//      synchronous handoff in #advanceToNextTrackSync.
		this.#preloadStarted = true;
		this.#preloadedSrc = nextTrack.src;
		const preloadAudio = this.#getPreloadAudio();
		preloadAudio.src = nextTrack.src;
		void this.#fetchNextTrackAsBlob(nextTrack, nextIndex);
	};

	/** Handles ratechange — full position state update. */
	#handleRateChange = (): void => {
		if (!this.#destroyed) {
			this.#mediaSession.setPositionState();
		}
	};

	// ─── Background Playback Resilience (internal) ───

	/**
	 * Called when play() succeeds — requests a Screen Wake Lock and starts
	 * the playback health watchdog.
	 *
	 * The Screen Wake Lock is the primary defense against Chrome Android's
	 * background audio throttling. When a wake lock is active:
	 *   - Chrome treats the page as an active media producer
	 *   - If the user turns off the screen, the lock releases (per spec) but
	 *     Chrome continues to honor the media session
	 *   - The media notification stays visible
	 *   - The audio pipeline is not suspended
	 *
	 * The watchdog is a secondary defense that detects if currentTime stops
	 * advancing (indicating a suspended audio pipeline) and attempts recovery
	 * by calling play() again. This handles edge cases where the wake lock
	 * isn't available or effective (e.g., low battery, browser doesn't support it).
	 */
	#startBackgroundPlaybackProtection(): void {
		if (!this.#backgroundPlaybackEnabled) return;

		// Request Screen Wake Lock
		this.#requestWakeLock();

		// Start watchdog timer
		this.#startWatchdog();
	}

	/**
	 * Called on pause/stop/ended — releases the Screen Wake Lock and stops
	 * the playback health watchdog. We no longer need background protection
	 * when audio isn't playing.
	 */
	#stopBackgroundPlaybackProtection(): void {
		this.#releaseWakeLock();
		this.#stopWatchdog();
	}

	/**
	 * Request a Screen Wake Lock. If the browser doesn't support the API
	 * or the request is denied (e.g., low battery), we silently continue —
	 * the watchdog and visibility recovery still provide fallback protection.
	 */
	async #requestWakeLock(): Promise<void> {
		if (!this.#backgroundPlaybackEnabled || this.#destroyed) return;

		// Already holding a lock
		if (this.#wakeLockSentinel && !this.#wakeLockSentinel.released) return;

		this.#wakeLockDesired = true;

		// Check if the API is available
		if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

		try {
			this.#wakeLockSentinel = await navigator.wakeLock.request("screen");
			// Listen for automatic release (happens when page becomes hidden)
			this.#wakeLockSentinel.addEventListener("release", this.#handleWakeLockRelease);
		} catch {
			// Not supported, denied, or page isn't visible — silently continue
			// The watchdog and visibility recovery still provide fallback protection
		}
	}

	/**
	 * Release the Screen Wake Lock. Called when playback pauses/stops/ends.
	 */
	#releaseWakeLock(): void {
		this.#wakeLockDesired = false;
		if (this.#wakeLockSentinel) {
			this.#wakeLockSentinel.removeEventListener("release", this.#handleWakeLockRelease);
			if (!this.#wakeLockSentinel.released) {
				this.#wakeLockSentinel.release().catch(() => {});
			}
			this.#wakeLockSentinel = null;
		}
	}

	/**
	 * Called when the Screen Wake Lock is released by the browser
	 * (happens automatically when the page becomes hidden).
	 * We don't clear #wakeLockDesired — we'll re-acquire on visibility change.
	 */
	#handleWakeLockRelease = (): void => {
		this.#wakeLockSentinel = null;
	};

	/**
	 * Handle visibility change events. This is the core of background playback
	 * resilience — it handles two critical scenarios:
	 *
	 * 1. Page becomes VISIBLE after being hidden:
	 *    - Re-acquire the Screen Wake Lock (Chrome releases it when the page
	 *      goes hidden per spec, so we need to re-request it)
	 *    - Check if playback is stalled (currentTime not advancing despite the
	 *      player believing it's playing) and attempt recovery
	 *    - Refresh the Media Session state to restore the notification
	 *
	 * 2. Page becomes HIDDEN:
	 *    - The wake lock auto-releases (per spec) — nothing to do
	 *    - Chrome may suspend the audio pipeline shortly — the watchdog
	 *      will detect this if it can, or visibility recovery will fix it
	 */
	#handleVisibilityChange = (): void => {
		if (this.#destroyed || !this.#backgroundPlaybackEnabled) return;

		if (document.visibilityState === "visible") {
			// Page is back in the foreground — re-acquire wake lock if playing
			if (!this.#userPaused && !this.#stopped && this.#wakeLockDesired) {
				this.#requestWakeLock();
			}

			// Detect and recover from stalled playback.
			// When Chrome suspends the audio pipeline for a background tab, the
			// audio element reports !paused but currentTime stops advancing.
			// Check if we need to recover.
			if (!this.#audio.paused && !this.#stopped && !this.#userPaused) {
				const stalledFor = (Date.now() - this.#lastWatchdogTimestamp) / 1000;
				const timeAdvanced = this.#audio.currentTime !== this.#lastWatchdogTime;

				// If currentTime hasn't advanced since the page was backgrounded,
				// the audio pipeline was suspended. Try to resume.
				if (!timeAdvanced || stalledFor > PLAYBACK_STALL_THRESHOLD_SECONDS) {
					this.#recoverPlayback("visibility");
				}
			}

			// Refresh Media Session state — Chrome may have revoked the
			// notification while the page was hidden. Re-setting playbackState
			// and position state nudges Chrome to restore the notification.
			if (this.#mediaSession.enabled && !this.#audio.paused) {
				this.#mediaSession.setPlaybackState("playing");
				this.#mediaSession.setPositionState();
			}
		}
	};

	/**
	 * Attempt to recover stalled playback. Called by the watchdog timer or
	 * the visibility change handler when playback appears to have stalled.
	 *
	 * Recovery works by calling play() on the audio element, which forces
	 * Chrome to re-engage the audio pipeline. The audio resumes from the
	 * same currentTime where it stalled (not from the beginning).
	 */
	#recoverPlayback(reason: "visibility" | "watchdog"): void {
		if (this.#destroyed || this.#audio.paused || this.#stopped || this.#userPaused) return;

		const stalledFor = (Date.now() - this.#lastWatchdogTimestamp) / 1000;

		// Emit stall event so consumers know playback was interrupted
		this.#events.emit("stall", {
			currentTime: this.#audio.currentTime,
			stalledFor,
		});

		// Attempt to resume playback. The play() call forces Chrome to
		// re-engage the audio pipeline. We do NOT reset currentTime —
		// the audio should resume from where it stalled.
		void this.#audio
			.play()
			.then(() => {
				this.#events.emit("recovery", {
					reason,
					currentTime: this.#audio.currentTime,
				});
			})
			.catch(() => {
				// Play was rejected — another operation may have intervened, or
				// the browser refused. Consumers can use the stall event to
				// implement their own recovery logic.
			});
	}

	/**
	 * Start the playback health watchdog timer.
	 *
	 * Every PLAYBACK_WATCHDOG_INTERVAL_MS (5s), checks if currentTime is
	 * advancing while the player believes it should be playing. If
	 * currentTime hasn't changed for PLAYBACK_STALL_THRESHOLD_SECONDS (3s),
	 * attempts recovery by calling play() again.
	 *
	 * Note: When Chrome throttles background timers, this interval may
	 * fire less frequently (once per second or less). That's acceptable —
	 * the stall threshold is generous enough that delayed detection still
	 * works, and the visibility change handler provides a guaranteed
	 * recovery path when the user returns to the app.
	 */
	#startWatchdog(): void {
		if (this.#watchdogTimer !== null) return; // already running

		// Initialize tracking state
		this.#lastWatchdogTime = this.#audio.currentTime;
		this.#lastWatchdogTimestamp = Date.now();

		this.#watchdogTimer = setInterval(() => {
			if (this.#destroyed || this.#audio.paused || this.#stopped || this.#userPaused) {
				return; // not playing — nothing to check
			}

			const now = Date.now();
			const elapsed = (now - this.#lastWatchdogTimestamp) / 1000;
			const timeAdvanced = this.#audio.currentTime !== this.#lastWatchdogTime;

			if (timeAdvanced) {
				// Playback is healthy — update tracking state
				this.#lastWatchdogTime = this.#audio.currentTime;
				this.#lastWatchdogTimestamp = now;
			} else if (elapsed >= PLAYBACK_STALL_THRESHOLD_SECONDS) {
				// currentTime hasn't advanced for too long — attempt recovery
				this.#recoverPlayback("watchdog");
			}
		}, PLAYBACK_WATCHDOG_INTERVAL_MS);
	}

	/**
	 * Stop the playback health watchdog timer.
	 */
	#stopWatchdog(): void {
		if (this.#watchdogTimer !== null) {
			clearInterval(this.#watchdogTimer);
			this.#watchdogTimer = null;
		}
	}

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
		this.#audio.removeEventListener("timeupdate", this.#handlePreload);
		this.#audio.removeEventListener("ratechange", this.#handleRateChange);
		this.#audio.removeEventListener("play", this.#handlePlayState);
		this.#audio.removeEventListener("pause", this.#handlePauseState);

		// Remove visibility change listener (background playback resilience)
		document.removeEventListener("visibilitychange", this.#handleVisibilityChange);

		// Stop background playback protection
		this.#stopWatchdog();
		this.#releaseWakeLock();

		// Remove all synthetic event listeners
		this.#events.removeAllListeners();

		// 3. Clear Media Session metadata and action handlers
		this.#mediaSession.clear();

		// 4. Abort any in-flight network request
		this.#audio.src = "";
		this.#audio.load();

		// 5. Also abort any preload request and clean up the preload element
		this.#preloadAudio?.pause();
		if (this.#preloadAudio) {
			this.#preloadAudio.src = "";
			this.#preloadAudio.removeAttribute("src");
		}
		// Revoke any pre-fetched blob URL
		this.#revokeBlobUrl();

		// 6. Remove src attribute
		this.#audio.removeAttribute("src");

		// 7. Set destroyed flag
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
