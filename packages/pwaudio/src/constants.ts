import type { RepeatMode, ShuffleMode, PreloadStrategy } from "./types";

/** Default values for PWAudioOptions */
export const DEFAULTS = {
	volume: 1,
	playbackRate: 1,
	repeat: "off" as RepeatMode,
	shuffle: "off" as ShuffleMode,
	preload: "metadata" as PreloadStrategy,
	mediaSessionEnabled: true,
	previousRestartThreshold: 3,
} as const;

/** Volume is clamped to [0, 1] */
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;

/** Playback rate is clamped to [0.25, 4.0] */
export const RATE_MIN = 0.25;
export const RATE_MAX = 4.0;

/** Position state update throttle in milliseconds */
export const POSITION_STATE_THROTTLE_MS = 1000;

/** Pre-fetch the next track when this fraction of the current track has been played (0–1). */
export const PRE_FETCH_TRIGGER_PERCENTAGE = 0.9;

/** The list of native HTMLAudioElement events that pwaudio proxies */
export const PROXIED_NATIVE_EVENTS = [
	"play",
	"pause",
	"ended",
	"timeupdate",
	"durationchange",
	"volumechange",
	"ratechange",
	"seeking",
	"seeked",
	"waiting",
	"canplay",
	"error",
	"progress",
	"loadedmetadata",
] as const;

/** Error message thrown when calling methods after destroy() — kept in sync with PWAudio.#throwIfDestroyed */
export const DESTROYED_ERROR_MESSAGE = "PWAudio has been destroyed";

/** Error message when play() is called on an empty playlist — kept in sync with PWAudio.play */
export const NO_TRACK_LOADED_MESSAGE = "No track loaded";
