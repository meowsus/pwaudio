import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import type { TrackErrorDetail, Track, NativeEventDetail } from "../types";
import {
	installAudioCapture,
	restoreAudio,
	getCapturedAudio,
	createMediaError,
	setAudioError,
	MEDIA_ERR_ABORTED,
	MEDIA_ERR_NETWORK,
	MEDIA_ERR_SRC_NOT_SUPPORTED,
} from "./helpers";

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

			expect(nativeErrorHandler).toHaveBeenCalledOnce();
			expect(trackerrorHandler).toHaveBeenCalledOnce();

			const nativeEvent = nativeErrorHandler.mock.calls[0][0] as CustomEvent<NativeEventDetail>;
			expect(nativeEvent.type).toBe("error");

			const trackerrorEvent = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(trackerrorEvent.detail.error).toBe(mediaError);
		});

		it("trackerror fires with null track and -1 index when playlist is empty", () => {
			const player = new PWAudio();
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			setAudioError(audioEl, null);
			audioEl.dispatchEvent(new Event("error"));

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

			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK, "Network error"));
			audioEl.dispatchEvent(new Event("error"));

			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.index).toBe(2);
			expect(event.detail.track).toEqual(tracks[2]);
		});

		it("trackerror fires with different MediaError codes", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();
			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			// MEDIA_ERR_ABORTED
			setAudioError(audioEl, createMediaError(MEDIA_ERR_ABORTED, "Aborted"));
			audioEl.dispatchEvent(new Event("error"));
			expect(trackerrorHandler).toHaveBeenCalledTimes(1);

			// MEDIA_ERR_NETWORK
			trackerrorHandler.mockClear();
			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK, "Network error"));
			audioEl.dispatchEvent(new Event("error"));
			expect(trackerrorHandler).toHaveBeenCalledOnce();
		});
	});

	describe("empty playlist rejection", () => {
		it("play() rejects with Error (not DOMException) when no tracks are loaded", async () => {
			const player = new PWAudio();
			try {
				await player.play();
				expect.fail("Expected play() to reject");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toBe("No track loaded");
				expect(error).not.toBeInstanceOf(DOMException);
			}
		});

		it("play() works after tracks are added", async () => {
			const player = new PWAudio();
			player.tracks = [{ src: "test.mp3" }];
			const result = player.play();
			await result.catch(() => {});
		});
	});

	describe("autoplay policy handling", () => {
		it("NotAllowedError from audio.play() propagates to consumer", async () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();

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
			}
		});

		it("stale play() Promise rejections are silently discarded by generation guard", async () => {
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3" }, { src: "track2.mp3" }],
			});

			const firstPlay = player.play();
			const nextPromise = player.next();

			await expect(firstPlay).resolves.toBeUndefined();
			await expect(nextPromise).resolves.toBeUndefined();
		});
	});

	describe("error event does not auto-skip", () => {
		it("library does not auto-advance to next track on trackerror", () => {
			const tracks: Track[] = [{ src: "broken.mp3" }, { src: "track2.mp3" }, { src: "track3.mp3" }];
			const player = new PWAudio({ tracks });
			const audioEl = getCapturedAudio();

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, "Not supported"));
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();
			expect(player.currentIndex).toBe(0);
			expect(player.currentTrack).toEqual(tracks[0]);
		});

		it("consumer can manually call next() in trackerror handler", async () => {
			const tracks: Track[] = [{ src: "broken.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks });
			const audioEl = getCapturedAudio();

			player.on("trackerror", () => {
				void player.next();
			});

			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK, "Network error"));
			audioEl.dispatchEvent(new Event("error"));

			await vi.waitFor(() => {
				expect(player.currentIndex).toBe(1);
			});
		});

		it("multiple rapid errors fire multiple trackerror events", () => {
			const player = new PWAudio({ tracks: [{ src: "broken.mp3" }] });
			const audioEl = getCapturedAudio();
			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK, "Network"));
			audioEl.dispatchEvent(new Event("error"));
			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, "Not supported"));
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledTimes(2);
		});
	});

	describe("error snapshotted to track at load time", () => {
		it("trackerror after track change carries the new track index (not the old one)", async () => {
			const tracks: Track[] = [
				{ src: "track1.mp3", title: "Track 1" },
				{ src: "track2.mp3", title: "Track 2" },
			];
			const player = new PWAudio({ tracks, repeat: "all" });
			const audioEl = getCapturedAudio();

			await player.next();
			expect(player.currentIndex).toBe(1);

			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_ABORTED, "Aborted"));
			audioEl.dispatchEvent(new Event("error"));

			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.index).toBe(1);
		});
	});

	describe("off() and once() for trackerror", () => {
		it("trackerror handler is not called after off()", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();
			const handler = vi.fn();
			player.on("trackerror", handler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED));
			audioEl.dispatchEvent(new Event("error"));
			expect(handler).toHaveBeenCalledOnce();

			player.off("trackerror", handler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK));
			audioEl.dispatchEvent(new Event("error"));
			expect(handler).toHaveBeenCalledOnce();
		});

		it("trackerror handler registered with once() fires only once", () => {
			const player = new PWAudio({ tracks: [{ src: "test.mp3" }] });
			const audioEl = getCapturedAudio();
			const handler = vi.fn();
			player.once("trackerror", handler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED));
			audioEl.dispatchEvent(new Event("error"));
			expect(handler).toHaveBeenCalledOnce();

			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK));
			audioEl.dispatchEvent(new Event("error"));
			expect(handler).toHaveBeenCalledOnce();
		});
	});

	describe("MEDIA_ERR_ABORTED handling", () => {
		it("trackerror is emitted for MEDIA_ERR_ABORTED with code 1", () => {
			const player = new PWAudio({ tracks: [{ src: "track.mp3" }] });
			const audioEl = getCapturedAudio();
			const trackerrorHandler = vi.fn();
			player.on("trackerror", trackerrorHandler);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_ABORTED, "Aborted"));
			audioEl.dispatchEvent(new Event("error"));

			expect(trackerrorHandler).toHaveBeenCalledOnce();
			const event = trackerrorHandler.mock.calls[0][0] as CustomEvent<TrackErrorDetail>;
			expect(event.detail.error?.code).toBe(MEDIA_ERR_ABORTED);
		});

		it("consumer can filter MEDIA_ERR_ABORTED by checking error.code", () => {
			const player = new PWAudio({ tracks: [{ src: "track.mp3" }] });
			const audioEl = getCapturedAudio();

			const genuineErrors: CustomEvent<TrackErrorDetail>[] = [];
			player.on("trackerror", (e: CustomEvent<TrackErrorDetail>) => {
				if (e.detail.error?.code !== MEDIA_ERR_ABORTED) {
					genuineErrors.push(e);
				}
			});

			setAudioError(audioEl, createMediaError(MEDIA_ERR_ABORTED, "Aborted"));
			audioEl.dispatchEvent(new Event("error"));
			expect(genuineErrors).toHaveLength(0);

			setAudioError(audioEl, createMediaError(MEDIA_ERR_NETWORK, "Network error"));
			audioEl.dispatchEvent(new Event("error"));
			expect(genuineErrors).toHaveLength(1);
			expect(genuineErrors[0].detail.error?.code).toBe(MEDIA_ERR_NETWORK);
		});
	});
});