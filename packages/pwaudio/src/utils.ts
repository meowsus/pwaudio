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
