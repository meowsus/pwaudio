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
		return (
			typeof navigator !== "undefined" &&
			"mediaSession" in navigator &&
			navigator.mediaSession != null
		);
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
	 * Update playback state on the Media Session.
	 * Called on play/pause native events.
	 */
	setPlaybackState(state: MediaSessionPlaybackState): void {
		if (!this.#enabled || !this.isAvailable) return;
		navigator.mediaSession.playbackState = state;
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
