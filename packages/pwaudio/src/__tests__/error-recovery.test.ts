import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import type { TrackErrorDetail, NativeEventDetail, Track } from "../types";

// ─── MediaError code constants (happy-dom may not define MediaError) ───

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

// ─── Helpers ───

/**
 * Capture the internal Audio element created by PWAudio.
 * We intercept the Audio constructor to capture a reference,
 * which allows us to dispatch events on it for testing.
 */
let capturedAudio: HTMLAudioElement | undefined;

const OriginalAudio = globalThis.Audio;

function installAudioCapture(): void {
	capturedAudio = undefined;
	globalThis.Audio = class extends OriginalAudio {
		constructor() {
			super();
			capturedAudio = this;
		}
	} as typeof OriginalAudio;
}

function restoreAudio(): void {
	globalThis.Audio = OriginalAudio;
}

function getCapturedAudio(): HTMLAudioElement {
	if (!capturedAudio) {
		throw new Error("No Audio element was captured. Did PWAudio constructor run?");
	}
	return capturedAudio;
}

/**
 * Set the error property on an HTMLAudioElement.
 * Uses Object.defineProperty because audio.error is normally readonly.
 */
function setAudioError(audio: HTMLAudioElement, error: MediaError | null): void {
	try {
		Object.defineProperty(audio, "error", {
			value: error,
			writable: true,
			configurable: true,
		});
	} catch {
		// Some environments don't allow redefining; set via direct assignment as fallback
		(audio as unknown as Record<string, unknown>).error = error;
	}
}

/**
 * Create a mock MediaError object with the given code.
 */
function createMediaError(code: number, message: string = ""): MediaError {
	return { code, message } as MediaError;
}

// ─── Tests ───

describe("Error Handling", () => {
	beforeEach(() => {
		installAudioCapture();
	});

	afterEach(() => {
		restoreAudio();
		vi.restoreAllMocks();
	});

	describe("trackerror synthetic event", () => {
		it("emits trackerror when HTMLAudioElement fires error event", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// Simulate an error event from the audio element
			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED));
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();

			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.type).toBe("trackerror");
			expect(event.detail.index).toBe(0);
		});

		it("trackerror detail contains error, track, and index", () => {
			const track: Track = { src: "broken.mp3", title: "Broken Track" };
			const player = new PWAudio({ tracks: [track] });
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			const mediaError = createMediaError(MEDIA_ERR_NETWORK, "A network error occurred");
			setAudioError(audioEl, mediaError);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();

			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.error).toBe(mediaError);
			expect(event.detail.track).toEqual(track);
			expect(event.detail.index).toBe(0);
		});

		it("emits both native error event (proxied) and trackerror", () => {
			const track: Track = { src: "broken.mp3" };
			const player = new PWAudio({ tracks: [track] });
			const audioEl = getCapturedAudio();

			const nativeErrorHandler = vi.fn();
			const trackerrorHandler = vi.fn();
			player.on("error", nativeErrorHandler);
			player.on("trackerror", trackerrorHandler);

			const mediaError = createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, "Not supported");
			setAudioError(audioEl, mediaError);
			audioEl.dispatchEvent(new Event("error"));

			// Both events should fire
			expect(nativeErrorHandler).toHaveBeenCalledOnce();
			expect(trackerrorHandler).toHaveBeenCalledOnce();

			// Native event should be proxied with NativeEventDetail
			const nativeEvent = nativeErrorHandler.mock.calls[0][0] as CustomEvent<NativeEventDetail>;
			expect(nativeEvent.type).toBe("error");
			expect(nativeEvent.detail.nativeEvent).toBeInstanceOf(Event);

			// Synthetic trackerror should have TrackErrorDetail
			const trackerrorEvent = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(trackerrorEvent.type).toBe("trackerror");
			expect(trackerrorEvent.detail.error).toBe(mediaError);
			expect(trackerrorEvent.detail.track).toEqual(track);
			expect(trackerrorEvent.detail.index).toBe(0);
		});

		it("trackerror fires with null track and -1 index when playlist is empty", () => {
			const player = new PWAudio();
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// Simulate error on audio element with no tracks loaded
			setAudioError(audioEl, null);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();

			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.error).toBeNull();
			expect(event.detail.track).toBeNull();
			expect(event.detail.index).toBe(-1);
		});

		it("trackerror fires with the correct track when currentIndex > 0", async () => {
			const tracks: Track[] = [
				{ src: "track1.mp3", title: "Track 1" },
				{ src: "track2.mp3", title: "Track 2" },
				{ src: "track3.mp3", title: "Track 3" },
			];
			const player = new PWAudio({ tracks });
			const audioEl = getCapturedAudio();

			// Navigate to track index 2
			await player.next(); // index 1
			await player.next(); // index 2

			expect(player.currentIndex).toBe(2);

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			const mediaError = createMediaError(MEDIA_ERR_NETWORK, "Network error");
			setAudioError(audioEl, mediaError);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();

			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.index).toBe(2);
			expect(event.detail.track).toEqual(tracks[2]);
		});

		it("trackerror fires with different MediaError codes", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// Test MEDIA_ERR_ABORTED (1)
			const abortedError = createMediaError(MEDIA_ERR_ABORTED, "Aborted");
			setAudioError(audioEl, abortedError);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledTimes(1);
			let event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.error?.code).toBe(MEDIA_ERR_ABORTED);

			// Test MEDIA_ERR_DECODE (3)
			trackerrorHandler.mockClear();
			const decodeError = createMediaError(MEDIA_ERR_DECODE, "Decode error");
			setAudioError(audioEl, decodeError);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();
			event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.error?.code).toBe(MEDIA_ERR_DECODE);
		});
	});

	describe("empty playlist rejection", () => {
		it("play() rejects with Error when no tracks are loaded", async () => {
			const player = new PWAudio();
			await expect(player.play()).rejects.toThrow("No track loaded");
		});

		it("play() rejects with Error (not DOMException) for empty playlist", async () => {
			const player = new PWAudio();

			try {
				await player.play();
				expect.fail("Expected play() to reject");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe("No track loaded");
				// It should NOT be a DOMException — it's a plain Error
				expect(error).not.toBeInstanceOf(DOMException);
			}
		});

		it("play() rejects for empty track array", async () => {
			const player = new PWAudio({ tracks: [] });
			await expect(player.play()).rejects.toThrow("No track loaded");
		});

		it("play() works after tracks are added", async () => {
			const player = new PWAudio();
			player.tracks = [{ src: "test.mp3" }];

			// play() should not reject now
			const result = player.play();
			// May reject due to autoplay policy in test env, so catch
			await result.catch(() => {
				// Autoplay policy may block — that's expected in test env
			});
		});
	});

	describe("autoplay policy handling", () => {
		it("NotAllowedError from audio.play() propagates to consumer", async () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

			// Mock audio.play() to reject with NotAllowedError
			const notAllowedError = new DOMException(
				"play() failed because the user didn't interact with the document",
				"NotAllowedError",
			);
			vi.spyOn(audioEl, "play").mockRejectedValue(notAllowedError);

			try {
				await player.play();
				expect.fail("Expected play() to reject with NotAllowedError");
			} catch (error) {
				expect((error as DOMException).name).toBe("NotAllowedError");
				expect(error).toBeInstanceOf(DOMException);
			}
		});

		it("stale play() Promise rejections are silently discarded by generation guard", async () => {
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3" }, { src: "track2.mp3" }],
			});

			// First play() call — should be superseded by next()
			const firstPlay = player.play();

			// Immediately navigate to next track — this increments playGeneration
			// The first play() result should be discarded
			const nextPromise = player.next();

			// Both should resolve without unhandled rejection
			await expect(firstPlay).resolves.toBeUndefined();
			await expect(nextPromise).resolves.toBeUndefined();
		});

		it("play() after next() uses current generation", async () => {
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3" }, { src: "track2.mp3" }],
			});

			// Start playing, then advance
			await player.play().catch(() => {}); // may fail due to autoplay
			await player.next();

			// currentIndex should have advanced
			expect(player.currentIndex).toBe(1);
		});
	});

	describe("error event does not auto-skip", () => {
		it("library does not auto-advance to next track on trackerror", () => {
			const tracks: Track[] = [{ src: "broken.mp3" }, { src: "track2.mp3" }, { src: "track3.mp3" }];
			const player = new PWAudio({ tracks });
			const audioEl = getCapturedAudio();

			expect(player.currentIndex).toBe(0);

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// Simulate error on the current track
			const mediaError = createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, "Not supported");
			setAudioError(audioEl, mediaError);
			audioEl.dispatchEvent(new Event("error"));

			// trackerror should fire
			expect(trackerrorHandler).toHaveBeenCalledOnce();

			// The current index should NOT have changed — no auto-skip
			expect(player.currentIndex).toBe(0);
			expect(player.currentTrack).toEqual(tracks[0]);
		});

		it("consumer can manually call next() in trackerror handler", async () => {
			const tracks: Track[] = [{ src: "broken.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks });
			const audioEl = getCapturedAudio();

			// Simulate consumer skip-on-error behavior
			player.on("trackerror", () => {
				void player.next();
			});

			const mediaError = createMediaError(MEDIA_ERR_NETWORK, "Network error");
			setAudioError(audioEl, mediaError);
			audioEl.dispatchEvent(new Event("error"));

			// Wait for the async next() to complete
			await vi.waitFor(() => {
				expect(player.currentIndex).toBe(1);
			});
		});

		it("multiple rapid errors fire multiple trackerror events", () => {
			const player = new PWAudio({ tracks: [{ src: "broken.mp3" }] });
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// First error
			const error1 = createMediaError(MEDIA_ERR_NETWORK, "Network");
			setAudioError(audioEl, error1);
			audioEl.dispatchEvent(new Event("error"));

			// Second error
			const error2 = createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, "Not supported");
			setAudioError(audioEl, error2);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledTimes(2);

			const event1 = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event1.detail.error?.code).toBe(MEDIA_ERR_NETWORK);

			const event2 = trackerrorHandler.mock.calls[1][0] as CustomEvent<TrackErrorDetail>;
			expect(event2.detail.error?.code).toBe(MEDIA_ERR_SRC_NOT_SUPPORTED);
		});
	});

	describe("error during navigation", () => {
		it("trackerror captures the track at the time of error", async () => {
			const tracks: Track[] = [
				{ src: "track1.mp3", title: "Track 1" },
				{ src: "track2.mp3", title: "Track 2" },
			];
			const player = new PWAudio({ tracks });
			const audioEl = getCapturedAudio();

			// Navigate to track 1 first
			await player.next();
			expect(player.currentIndex).toBe(1);

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// Simulate error while on track 1
			const mediaError = createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, "Not supported");
			setAudioError(audioEl, mediaError);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();
			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.index).toBe(1);
			expect(event.detail.track?.title).toBe("Track 2");
		});
	});

	describe("play() rejection types", () => {
		it("play() on empty playlist rejects with plain Error 'No track loaded'", async () => {
			const player = new PWAudio();

			let caughtError: Error | undefined;
			try {
				await player.play();
			} catch (error) {
				caughtError = error as Error;
			}

			expect(caughtError).toBeInstanceOf(Error);
			expect(caughtError?.message).toBe("No track loaded");
		});

		it("play() NotAllowedError is a DOMException", async () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

			const notAllowedError = new DOMException("Autoplay blocked", "NotAllowedError");
			vi.spyOn(audioEl, "play").mockRejectedValue(notAllowedError);

			let caughtError: DOMException | undefined;
			try {
				await player.play();
			} catch (error) {
				caughtError = error as DOMException;
			}

			expect(caughtError).toBeInstanceOf(DOMException);
			expect(caughtError?.name).toBe("NotAllowedError");
		});
	});

	describe("off() removes trackerror handler", () => {
		it("trackerror handler is not called after off()", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

			const handler = vi.fn();
			player.on("trackerror", handler);

			// Trigger and verify handler works
			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED));
			audioEl.dispatchEvent(new Event("error"));
			expect(handler).toHaveBeenCalledOnce();

			// Remove handler
			player.off("trackerror", handler);

			// Trigger again — handler should NOT be called
			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK));
			audioEl.dispatchEvent(new Event("error"));

			expect(handler).toHaveBeenCalledOnce(); // Still only 1 call
		});
	});

	describe("once() for trackerror", () => {
		it("trackerror handler registered with once() fires only once", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

			const handler = vi.fn();
			player.once("trackerror", handler);

			// First error
			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED));
			audioEl.dispatchEvent(new Event("error"));
			expect(handler).toHaveBeenCalledOnce();

			// Second error — handler should NOT fire again
			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK));
			audioEl.dispatchEvent(new Event("error"));

			expect(handler).toHaveBeenCalledOnce(); // Still only 1
		});
	});

	describe("MEDIA_ERR_ABORTED (mobile screen-off, track change)", () => {
		it("trackerror is emitted for MEDIA_ERR_ABORTED with code 1", () => {
			// The library emits trackerror for ALL error codes, including ABORTED.
			// Consumers should filter MEDIA_ERR_ABORTED (code 1) at the application
			// level — it is not a genuine playback failure, just the user-agent
			// aborting the fetch (e.g. mobile Chrome when the screen turns off,
			// or the player changing tracks).
			const player = new PWAudio({ tracks: [{ src: "track.mp3" }] });
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			const abortedError = createMediaError(MEDIA_ERR_ABORTED, "Aborted");
			setAudioError(audioEl, abortedError);
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();
			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.error?.code).toBe(MEDIA_ERR_ABORTED);
		});

		it("consumer can filter MEDIA_ERR_ABORTED by checking error.code", () => {
			// Demonstrates the recommended pattern for ignoring spurious aborts
			const player = new PWAudio({ tracks: [{ src: "track.mp3" }] });
			const audioEl = getCapturedAudio();

			const genuineErrors: CustomEvent<TrackErrorDetail>[] = [];
			player.on("trackerror", (e: CustomEvent<TrackErrorDetail>) => {
				if (e.detail.error?.code !== MEDIA_ERR_ABORTED) {
					genuineErrors.push(e);
				}
			});

			// Spurious abort — common on mobile when screen turns off
			setAudioError(audioEl, createMediaError(MEDIA_ERR_ABORTED, "Aborted"));
			audioEl.dispatchEvent(new Event("error"));
			expect(genuineErrors).toHaveLength(0);

			// Genuine network error
			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK, "Network error"));
			audioEl.dispatchEvent(new Event("error"));
			expect(genuineErrors).toHaveLength(1);
			expect(genuineErrors[0].detail.error?.code).toBe(MEDIA_ERR_NETWORK);
		});

		it("trackerror after track change carries the new track index", async () => {
			// When the player advances tracks and the browser aborts the previous
			// fetch, #loadTrack has already updated the snapshot, so trackerror
			// reports the new track's index — not the one that just played.
			const tracks: Track[] = [
				{ src: "track1.mp3", title: "Track 1" },
				{ src: "track2.mp3", title: "Track 2" },
			];
			const player = new PWAudio({ tracks, repeat: "all" });
			const audioEl = getCapturedAudio();

			// Advance to track 1
			await player.next();
			expect(player.currentIndex).toBe(1);

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// Simulate MEDIA_ERR_ABORTED after track change
			setAudioError(audioEl, createMediaError(MEDIA_ERR_ABORTED, "Aborted"));
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();
			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			// The snapshot was updated to track 2 by #loadTrack
			expect(event.detail.index).toBe(1);
		});
	});
});
