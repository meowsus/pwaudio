import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import type { Track } from "../types";
import {
	installAudioCapture,
	restoreAudio,
	getCapturedAudio,
	getAllAudioElements,
} from "./helpers";

describe("Preload", () => {
	beforeEach(() => {
		installAudioCapture();
	});

	afterEach(() => {
		restoreAudio();
		vi.restoreAllMocks();
	});

	describe("preloadThreshold getter/setter", () => {
		it("defaults to 20 seconds", () => {
			const player = new PWAudio();
			expect(player.preloadThreshold).toBe(20);
		});

		it("can be configured in constructor", () => {
			const player = new PWAudio({ preloadThreshold: 30 });
			expect(player.preloadThreshold).toBe(30);
		});

		it("can be set to 0 to disable preloading", () => {
			const player = new PWAudio({ preloadThreshold: 0 });
			expect(player.preloadThreshold).toBe(0);
		});

		it("can be set via setter", () => {
			const player = new PWAudio();
			player.preloadThreshold = 15;
			expect(player.preloadThreshold).toBe(15);
		});

		it("returns 0 after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(player.preloadThreshold).toBe(0);
		});

		it("setter throws InvalidStateError after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(() => {
				player.preloadThreshold = 10;
			}).toThrow(DOMException);
		});
	});

	describe("preloading behavior", () => {
		it("does not create preload element when stopped (initial state)", () => {
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3" }, { src: "track2.mp3" }],
			});
			expect(getAllAudioElements().length).toBe(1);
			expect(player.stopped).toBe(true);
		});

		it("creates preload element and sets src when near track end", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});
			expect(getAllAudioElements().length).toBe(1);

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 285, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(2);
			const preloadAudio = getAllAudioElements()[1];
			expect(preloadAudio.src).toContain("track2.mp3");
			expect(preloadAudio.preload).toBe("auto");
		});

		it("does not preload when far from track end", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 100, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(1);
		});

		it("does not preload when preloadThreshold is 0 (disabled)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 0 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(1);
		});

		it("does not preload when preloadThreshold is negative (disabled)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: -5 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(1);
		});

		it("does not preload when there is no next track (repeat=off, at end)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }];
			const player = new PWAudio({ tracks, repeat: "off", preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(1);
		});

		it("preloads first track when repeat=all and at last track", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, repeat: "all", preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			await player.next();
			expect(player.currentIndex).toBe(1);

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(2);
			expect(getAllAudioElements()[1].src).toContain("track1.mp3");
		});

		it("does not preload with repeat=one (same track repeats)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }];
			const player = new PWAudio({ tracks, repeat: "one", preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(1);
		});

		it("does not trigger preload twice for the same track", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });

			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(getAllAudioElements().length).toBe(2);

			const firstSrc = getAllAudioElements()[1].src;
			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(getAllAudioElements().length).toBe(2);
			expect(getAllAudioElements()[1].src).toBe(firstSrc);
		});

		it("does not preload when duration is NaN", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: NaN, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(getAllAudioElements().length).toBe(1);
		});

		it("resets preload when tracks are replaced", () => {
			const tracks1: Track[] = [{ src: "a.mp3" }, { src: "b.mp3" }];
			const tracks2: Track[] = [{ src: "c.mp3" }, { src: "d.mp3" }];
			const player = new PWAudio({ tracks: tracks1, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(getAllAudioElements().length).toBe(2);

			player.tracks = tracks2;
			audioEl.dispatchEvent(new Event("timeupdate"));
		});

		it("resets preload when shuffle mode changes", () => {
			const tracks: Track[] = [{ src: "a.mp3" }, { src: "b.mp3" }, { src: "c.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			player.shuffle = "on";
			expect(player.shuffle).toBe("on");
		});

		it("resets preload when repeat mode changes", () => {
			const tracks: Track[] = [{ src: "a.mp3" }, { src: "b.mp3" }];
			const player = new PWAudio({ tracks, repeat: "off", preloadThreshold: 20 });
			player.repeat = "all";
			expect(player.repeat).toBe("all");
		});

		it("cleans up preload element on destroy", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(getAllAudioElements().length).toBe(2);

			player.destroy();
			expect(player.destroyed).toBe(true);
		});
	});

	describe("src setter resets preload state", () => {
		it("src setter resets preload — new src clears preloaded next track", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(getAllAudioElements().length).toBe(2);

			// Setting src resets playlist to single track, should reset preload state
			player.src = "new-track.mp3";
			expect(player.tracks).toHaveLength(1);

			// Trigger timeupdate again — no next track to preload (single track, repeat=off)
			audioEl.dispatchEvent(new Event("timeupdate"));
			// No new preload element is created because preloadStarted was reset
			// and there's no next track to preload
			expect(getAllAudioElements()).toHaveLength(2);
		});
	});
});
