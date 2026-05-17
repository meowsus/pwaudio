# Plan 01: Types & Constants

## Objective

Create the type definitions, constants, and utility functions that all other modules depend on. This plan produces three files with zero runtime behavior — purely static types and values.

## Files to Create

### `packages/pwaudio/src/types.ts`

Define every public and internal type referenced in `DESIGN.md` §4.

```ts
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
}
```

### `packages/pwaudio/src/constants.ts`

```ts
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

/** Error message thrown when calling methods after destroy() */
export const DESTROYED_ERROR_MESSAGE = "PWAudio has been destroyed";

/** Error message when play() is called on an empty playlist */
export const NO_TRACK_LOADED_MESSAGE = "No track loaded";
```

### `packages/pwaudio/src/utils.ts`

```ts
import { VOLUME_MIN, VOLUME_MAX, RATE_MIN, RATE_MAX } from "./constants";

/** Clamp a number between min and max (inclusive). */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Clamp volume to [0, 1]. */
export function clampVolume(volume: number): number {
	return clamp(volume, VOLUME_MIN, VOLUME_MAX);
}

/** Clamp playback rate to [0.25, 4.0]. */
export function clampPlaybackRate(rate: number): number {
	return clamp(rate, RATE_MIN, RATE_MAX);
}

/** Check if a duration value is a finite, positive number. */
export function isFiniteDuration(duration: number): boolean {
	return Number.isFinite(duration) && duration > 0;
}
```

## Verification

1. `pnpm -C packages/pwaudio typecheck` must pass with zero errors.
2. All types reference each other correctly (e.g., `PlayerEventHandlerMap` keys match `PlayerEvent` values).
3. No runtime code in `types.ts` — it is purely type-level.
4. Constants use `as const` where appropriate for literal inference.

## Notes

- `MediaImage` is a browser builtin type from the Media Session API — do **not** redefine it. It is available in `lib.dom.d.ts`.
- `Track.metadata` is typed as `unknown` intentionally — the library never inspects it.
- The `stop` event in `PlayerEventHandlerMap` uses `CustomEvent` (no generic parameter) because `stop` has no detail payload.
- Do not export anything from these files that isn't listed in the design document's export map. Internal helpers can be unexported or exported with a comment marking them internal.
