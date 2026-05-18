// ─── Track ───

export interface Track {
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

export type RepeatMode = "off" | "one" | "all";
export type ShuffleMode = "off" | "on";
export type PreloadStrategy = "none" | "metadata" | "auto";

// ─── Event detail payloads ───

export interface NativeEventDetail {
	nativeEvent: Event;
}

export interface TrackChangeDetail {
	previousIndex: number;
	currentIndex: number;
	track: Track | null;
}

export interface PlaylistChangeDetail {
	tracks: readonly Track[];
}

export interface MediaCardChangeDetail {
	title: string;
	artist: string;
	album: string;
	artwork: MediaImage[];
}

/**
 * Detail payload for the 'trackerror' synthetic event.
 *
 * `error.code` follows the HTML MediaError spec:
 *   - 1 (MEDIA_ERR_ABORTED):  The browser aborted fetching — common on mobile
 *     when the screen turns off, or when the player changes tracks/stops.
 *     This is expected behaviour, not a genuine playback failure.
 *   - 2 (MEDIA_ERR_NETWORK):  A network error occurred.
 *   - 3 (MEDIA_ERR_DECODE):    An error occurred while decoding.
 *   - 4 (MEDIA_ERR_SRC_NOT_SUPPORTED): The audio source is not supported.
 */
export interface TrackErrorDetail {
	error: MediaError | null;
	track: Track | null;
	index: number;
}

// ─── Event names union ───

export type PlayerEvent =
	// Native HTMLAudioElement events (proxied)
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

// ─── Typed event handler map ───

export interface PlayerEventHandlerMap {
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

export interface PWAudioOptions {
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
	/** Threshold in seconds for previous() restart behavior. Default: 3 */
	previousRestartThreshold?: number;
	/**
	 * Seconds before the end of a track to start preloading the next track.
	 * Preloading fetches the next track's audio data into the browser cache so
	 * that when the current track ends, the transition to the next track can
	 * happen without a network request. This is critical on mobile devices
	 * where the browser throttles background tabs — without preloading, the
	 * network fetch for the next track may be killed, producing a
	 * MEDIA_ERR_SRC_NOT_SUPPORTED ("Format error") and stopping playback.
	 *
	 * Set to 0 or less to disable preloading. Default: 20.
	 */
	preloadThreshold?: number;
}
