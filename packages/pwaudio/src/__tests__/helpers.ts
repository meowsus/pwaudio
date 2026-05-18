/**
 * Shared test helpers for PWAudio test suite.
 *
 * Centralizes audio capture, player factories, and common assertions
 * that were copy-pasted across multiple test files.
 */

import { expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";

// ─── Audio element capture ───

let capturedAudio: HTMLAudioElement | undefined;
let allAudioElements: HTMLAudioElement[];
const OriginalAudio = globalThis.Audio;

/**
 * Intercept `globalThis.Audio` to capture constructed elements.
 * Call before creating a PWAudio instance.
 * Use `getCapturedAudio()` to retrieve the main player element,
 * or `getAllAudioElements()` for all elements (including preload).
 */
export function installAudioCapture(): void {
	capturedAudio = undefined;
	allAudioElements = [];
	globalThis.Audio = class extends OriginalAudio {
		constructor() {
			super();
			if (capturedAudio === undefined) {
				capturedAudio = this;
			}
			allAudioElements.push(this);
		}
	} as typeof OriginalAudio;
}

/** Restore the original `globalThis.Audio`. Call in afterEach. */
export function restoreAudio(): void {
	globalThis.Audio = OriginalAudio;
}

/** Get the first captured Audio element (the main player element). */
export function getCapturedAudio(): HTMLAudioElement {
	if (!capturedAudio) {
		throw new Error("No Audio element was captured.");
	}
	return capturedAudio;
}

/** Get all captured Audio elements (main + preload). */
export function getAllAudioElements(): HTMLAudioElement[] {
	return allAudioElements;
}

// ─── Player factories ───

/** Create a player with a standard 3-track playlist. */
export function createPlayerWithTracks(
	countOrTracks?: number | { src: string; title?: string }[],
): PWAudio {
	if (countOrTracks === undefined || typeof countOrTracks === "number") {
		const count = countOrTracks ?? 3;
		const tracks = Array.from({ length: count }, (_, i) => ({
			src: `track-${String.fromCharCode(97 + i)}.mp3`,
			title: `Track ${String.fromCharCode(65 + i)}`,
		}));
		return new PWAudio({ tracks });
	}
	return new PWAudio({ tracks: countOrTracks });
}

/** Create a player with a single track. */
export function createPlayerWithSingleTrack(src = "test.mp3"): PWAudio {
	return new PWAudio({ src });
}

// ─── MediaMetadata mock ───

const OriginalMediaMetadata = globalThis.MediaMetadata;

/** Install a mock MediaMetadata constructor. Call in beforeEach. */
export function installMediaMetadataMock(): void {
	// @ts-expect-error — mocking global MediaMetadata for test environment
	globalThis.MediaMetadata = class MockMediaMetadata {
		title: string;
		artist: string;
		album: string;
		artwork: MediaImage[];
		constructor(init: MediaMetadataInit) {
			this.title = init.title ?? "";
			this.artist = init.artist ?? "";
			this.album = init.album ?? "";
			this.artwork = init.artwork ?? [];
		}
	};
}

/** Restore the original MediaMetadata. Call in afterEach. */
export function restoreMediaMetadataMock(): void {
	if (OriginalMediaMetadata) {
		globalThis.MediaMetadata = OriginalMediaMetadata;
	} else {
		// @ts-expect-error — removing global mock
		delete globalThis.MediaMetadata;
	}
}

// ─── MediaSession mock ───

export interface MediaSessionMock {
	metadata: MediaMetadata | null;
	playbackState: MediaSessionPlaybackState;
	setActionHandler: ReturnType<typeof vi.fn>;
	setPositionState: ReturnType<typeof vi.fn>;
}

export function createMediaSessionMock(): MediaSessionMock {
	return {
		metadata: null as MediaMetadata | null,
		playbackState: "none" as MediaSessionPlaybackState,
		setActionHandler: vi.fn(),
		setPositionState: vi.fn(),
	};
}

export function setupMediaSessionMock(): MediaSessionMock {
	installMediaMetadataMock();
	const mock = createMediaSessionMock();
	Object.defineProperty(navigator, "mediaSession", {
		value: mock,
		writable: true,
		configurable: true,
	});
	return mock;
}

export function teardownMediaSessionMock(): void {
	restoreMediaMetadataMock();
	Object.defineProperty(navigator, "mediaSession", {
		value: undefined,
		writable: true,
		configurable: true,
	});
}

/** Get the mock MediaSession from navigator. */
export function getMockMs(): MediaSessionMock {
	return navigator.mediaSession as unknown as MediaSessionMock;
}

// ─── MediaError mock ───

export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

/** Create a mock MediaError object with the given code. */
export function createMediaError(code: number, message = ""): MediaError {
	return { code, message } as MediaError;
}

/**
 * Set the error property on an HTMLAudioElement.
 * Uses Object.defineProperty because audio.error is normally readonly.
 */
export function setAudioError(audio: HTMLAudioElement, error: MediaError | null): void {
	try {
		Object.defineProperty(audio, "error", {
			value: error,
			writable: true,
			configurable: true,
		});
	} catch {
		(audio as unknown as Record<string, unknown>).error = error;
	}
}

// ─── Common assertions ───

/** Assert the player is in the initial stopped state. */
export function expectInitialState(player: PWAudio): void {
	expect(player.playing).toBe(false);
	expect(player.paused).toBe(false);
	expect(player.stopped).toBe(true);
	expect(player.ended).toBe(false);
}
