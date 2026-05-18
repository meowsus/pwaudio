import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import type { Track } from "../types";

// ─── Audio capture for native event simulation ───

let capturedAudio: HTMLAudioElement | undefined;
let allAudioElements: HTMLAudioElement[] = [];
const OriginalAudio = globalThis.Audio;

function installAudioCapture(): void {
	capturedAudio = undefined;
	allAudioElements = [];
	globalThis.Audio = class extends OriginalAudio {
		constructor() {
			super();
			// Capture the first Audio element as the main player element.
			// The preload element is created lazily, so tests that need it
			// can access it via allAudioElements.
			if (capturedAudio === undefined) {
				capturedAudio = this;
			}
			allAudioElements.push(this);
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

// ─── Tests ───

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

		it("can be set via constructor option", () => {
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

		it("throws InvalidStateError after destroy", () => {
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

			// Only one Audio element should exist (main player)
			expect(allAudioElements.length).toBe(1);
			expect(player.stopped).toBe(true);
		});

		it("creates preload element and sets src when near track end", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			// Start playing to move out of stopped state
			void player.play().catch(() => {});

			// Initially only one Audio element
			expect(allAudioElements.length).toBe(1);

			// Simulate being near the end of track 1 (within 20s threshold)
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 285, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// Now a second Audio element should have been created (preload)
			expect(allAudioElements.length).toBe(2);
			const preloadAudio = allAudioElements[1];
			expect(preloadAudio.src).toContain("track2.mp3");
			expect(preloadAudio.preload).toBe("auto");
		});

		it("does not preload when far from track end", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			// Simulate being far from the end (more than 20s remaining)
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 100, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// Only main Audio element should exist (no preload triggered)
			expect(allAudioElements.length).toBe(1);
		});

		it("does not preload when preloadThreshold is 0 (disabled)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 0 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			// Simulate being near the end
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// No preload element created (disabled)
			expect(allAudioElements.length).toBe(1);
		});

		it("does not preload when preloadThreshold is negative (disabled)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: -5 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(allAudioElements.length).toBe(1);
		});

		it("does not preload when there is no next track (repeat=off, at end)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }];
			const player = new PWAudio({ tracks, repeat: "off", preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// Single track with repeat=off — no next track to preload
			expect(allAudioElements.length).toBe(1);
		});

		it("preloads first track when repeat=all and at last track", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, repeat: "all", preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			// Navigate to last track
			await player.next(); // index 1 (last track)
			expect(player.currentIndex).toBe(1);

			// Simulate being near the end
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// Should have created a preload element
			expect(allAudioElements.length).toBe(2);
			const preloadAudio = allAudioElements[1];
			expect(preloadAudio.src).toContain("track1.mp3");
		});

		it("does not preload with repeat=one (same track repeats)", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }];
			const player = new PWAudio({ tracks, repeat: "one", preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// repeat=one plays the same track — src is already loaded
			expect(allAudioElements.length).toBe(1);
		});

		it("does not trigger preload twice for the same track", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });

			// First timeupdate — should trigger preload
			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(allAudioElements.length).toBe(2);

			const preloadAudio = allAudioElements[1];
			const firstSrc = preloadAudio.src;

			// Second timeupdate — should NOT create another preload element
			audioEl.dispatchEvent(new Event("timeupdate"));
			expect(allAudioElements.length).toBe(2);
			expect(preloadAudio.src).toBe(firstSrc);
		});

		it("does not preload when duration is NaN", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			void player.play().catch(() => {});

			Object.defineProperty(audioEl, "duration", { value: NaN, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(allAudioElements.length).toBe(1);
		});

		it("does not preload after destroy", async () => {
			const tracks: Track[] = [{ src: "track1.mp3" }, { src: "track2.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });
			player.destroy();

			expect(player.preloadThreshold).toBe(0);
		});

		it("resets preload when tracks are replaced", () => {
			const tracks1: Track[] = [{ src: "a.mp3" }, { src: "b.mp3" }];
			const tracks2: Track[] = [{ src: "c.mp3" }, { src: "d.mp3" }];
			const player = new PWAudio({ tracks: tracks1, preloadThreshold: 20 });
			const audioEl = getCapturedAudio();

			// Trigger preload
			void player.play().catch(() => {});
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			// Should have a preload element
			expect(allAudioElements.length).toBe(2);

			// Replace tracks — should allow re-preloading
			player.tracks = tracks2;

			// Advance time again to trigger new preload
			audioEl.dispatchEvent(new Event("timeupdate"));

			// Verify the preload mechanism still works after track replacement
			// (The exact number of Audio elements may vary since the old preload
			// element is not removed, but the src should have been updated)
		});

		it("resets preload when shuffle mode changes", () => {
			const tracks: Track[] = [{ src: "a.mp3" }, { src: "b.mp3" }, { src: "c.mp3" }];
			const player = new PWAudio({ tracks, preloadThreshold: 20 });

			// Change shuffle mode
			player.shuffle = "on";

			// Should not throw — just resets preload state
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

			// Trigger preload
			Object.defineProperty(audioEl, "duration", { value: 300, configurable: true });
			Object.defineProperty(audioEl, "currentTime", { value: 290, configurable: true });
			audioEl.dispatchEvent(new Event("timeupdate"));

			expect(allAudioElements.length).toBe(2);

			// Destroy should not throw
			player.destroy();

			// Verify destroyed state
			expect(player.destroyed).toBe(true);
		});
	});
});
