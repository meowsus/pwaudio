/**
 * Shared track definitions for the demo app.
 * Uses SoundHelix free MP3 samples.
 *
 * SoundHelix provides 17 unique MP3s. To build a 30-track pool,
 * tracks 18–30 reuse songs 1–13 with different metadata so they
 * appear as distinct entries in the UI while using the same URLs.
 */

import type { Track } from "pwaudio";

export const SOUNDHELIX_BASE = "https://www.soundhelix.com/examples/mp3";
export const UNIQUE_SONGS = 17;
export const TOTAL_TRACKS = 30;

/** Album names to differentiate cycles through the 17 SoundHelix songs */
const ALBUMS = ["SoundHelix", "SoundHelix Vol. 2"] as const;

/** 30 tracks built from 17 unique SoundHelix songs */
export const ALL_TRACKS: Track[] = Array.from({ length: TOTAL_TRACKS }, (_, i) => {
	const songNum = (i % UNIQUE_SONGS) + 1; // cycles 1–17
	const albumIdx = Math.floor(i / UNIQUE_SONGS); // 0 or 1
	return {
		src: `${SOUNDHELIX_BASE}/SoundHelix-Song-${songNum}.mp3`,
		title: `Song ${i + 1} (Helix ${songNum})`,
		artist: "T. Schürger",
		album: ALBUMS[albumIdx],
		duration: i < 6 ? 360 + i * 30 : undefined, // approximate durations for first few
	};
});

/** Pick N random tracks from the pool */
export function pickRandom(count: number): Track[] {
	const shuffled = [...ALL_TRACKS].sort(() => Math.random() - 0.5);
	return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Format seconds as mm:ss or h:mm:ss */
export function formatTime(seconds: number): string {
	if (!isFinite(seconds) || seconds < 0) return "--:--";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
