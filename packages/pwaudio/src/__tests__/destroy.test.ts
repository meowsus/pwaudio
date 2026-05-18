import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import {
	createPlayerWithTracks,
	installMediaMetadataMock,
	restoreMediaMetadataMock,
} from "./helpers";

describe("destroy()", () => {
	describe("lifecycle", () => {
		it("pauses playback on destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.playing).toBe(false);
		});

		it("is idempotent — calling destroy() multiple times is safe", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(() => player.destroy()).not.toThrow();
			player.destroy();
			player.destroy();
		});

		it("sets audio.src to empty string", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.src).toBe("");
		});

		it("removes all synthetic listeners — on() throws after destroy", () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.destroy();
			expect(() => player.on("play", vi.fn())).toThrow();
		});

		it("emits no events after destroy", () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.destroy();
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("post-destroy behavior — all getters return safe defaults", () => {
		it("returns safe defaults for every property after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();

			expect(player.playing).toBe(false);
			expect(player.paused).toBe(true);
			expect(player.stopped).toBe(true);
			expect(player.ended).toBe(false);
			expect(player.currentTime).toBe(0);
			expect(player.volume).toBe(0);
			expect(player.muted).toBe(false);
			expect(player.playbackRate).toBe(1);
			expect(player.tracks).toEqual([]);
			expect(player.currentIndex).toBe(-1);
			expect(player.currentTrack).toBeNull();
			expect(player.src).toBe("");
			expect(player.repeat).toBe("off");
			expect(player.shuffle).toBe("off");
			expect(player.preload).toBe("none");
			expect(player.mediaSessionEnabled).toBe(false);
			expect(player.preservesPitch).toBe(true);
			expect(player.seeking).toBe(false);
			expect(player.previousRestartThreshold).toBe(0);
			expect(player.preloadThreshold).toBe(0);
			expect(player.duration).toBeNaN();
		});
	});

	describe("post-destroy behavior — all setters and methods throw InvalidStateError", () => {
		it("all setters throw InvalidStateError after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();

			const setters: Record<string, unknown> = {
				volume: 0.5,
				muted: false,
				playbackRate: 1,
				src: "x.mp3",
				tracks: [{ src: "y.mp3" }],
				repeat: "all",
				shuffle: "on",
				preload: "auto",
				mediaSessionEnabled: false,
				preservesPitch: true,
				currentTime: 0,
				previousRestartThreshold: 3,
				preloadThreshold: 10,
			};

			for (const [key, value] of Object.entries(setters)) {
				expect(() => {
					(player as any)[key] = value;
				}, `setter ${key} should throw`).toThrow();
			}
		});

		it("all methods throw InvalidStateError after destroy", async () => {
			const player = createPlayerWithTracks();
			player.destroy();

			expect(() => player.pause()).toThrow();
			expect(() => player.stop()).toThrow();
			expect(() => player.on("play", vi.fn())).toThrow();
			expect(() => player.off("play", vi.fn())).toThrow();
			expect(() => player.once("play", vi.fn())).toThrow();

			await expect(player.play()).rejects.toThrow();
			await expect(player.next()).rejects.toThrow();
			await expect(player.previous()).rejects.toThrow();
			await expect(player.goto(0)).rejects.toThrow();
		});
	});

	describe("in-flight play() Promise", () => {
		it("resolves silently after destroy", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			const playPromise = player.play().catch(() => {});
			player.destroy();
			await playPromise;
		});
	});

	describe("destroy clears Media Session", () => {
		beforeEach(() => {
			installMediaMetadataMock();
		});

		afterEach(() => {
			restoreMediaMetadataMock();
		});

		it("clears Media Session metadata and handlers", () => {
			const mockSetActionHandler = vi.fn();
			Object.defineProperty(navigator, "mediaSession", {
				value: {
					metadata: null,
					playbackState: "none",
					setActionHandler: mockSetActionHandler,
					setPositionState: vi.fn(),
				},
				writable: true,
				configurable: true,
			});

			const player = createPlayerWithTracks();
			expect(navigator.mediaSession.metadata).not.toBeNull();

			player.destroy();

			expect(navigator.mediaSession.metadata).toBeNull();
			expect(navigator.mediaSession.playbackState).toBe("none");

			const actions = [
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
				expect(mockSetActionHandler).toHaveBeenCalledWith(action, null);
			}
		});
	});
});
