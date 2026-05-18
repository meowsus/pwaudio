import { describe, it, expect } from "vitest";
import { PWAudio } from "../PWAudio";

describe("Constructor", () => {
	describe("instantiation", () => {
		it("can be instantiated with no arguments", () => {
			const player = new PWAudio();
			expect(player).toBeInstanceOf(PWAudio);
		});

		it("can be instantiated with src option", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.src).toContain("test.mp3");
			expect(player.currentIndex).toBe(0);
			expect(player.tracks).toHaveLength(1);
		});

		it("can be instantiated with tracks option", () => {
			const tracks = [{ src: "a.mp3" }, { src: "b.mp3" }];
			const player = new PWAudio({ tracks });
			expect(player.tracks).toHaveLength(2);
			expect(player.currentIndex).toBe(0);
		});

		it("tracks option takes precedence over src", () => {
			const player = new PWAudio({
				src: "single.mp3",
				tracks: [{ src: "first.mp3" }, { src: "second.mp3" }],
			});
			expect(player.tracks).toHaveLength(2);
			expect(player.currentIndex).toBe(0);
		});

		it("empty tracks falls back to src", () => {
			const player = new PWAudio({
				src: "single.mp3",
				tracks: [],
			});
			expect(player.tracks).toHaveLength(1);
			expect(player.currentIndex).toBe(0);
			expect(player.src).toContain("single.mp3");
		});

		it("no src and no tracks creates empty playlist", () => {
			const player = new PWAudio();
			expect(player.tracks).toHaveLength(0);
			expect(player.currentIndex).toBe(-1);
			expect(player.currentTrack).toBeNull();
		});
	});

	describe("default values", () => {
		it("applies all default values", () => {
			const player = new PWAudio();
			expect(player.volume).toBe(1);
			expect(player.playbackRate).toBe(1);
			expect(player.repeat).toBe("off");
			expect(player.shuffle).toBe("off");
			expect(player.preload).toBe("metadata");
			expect(player.mediaSessionEnabled).toBe(true);
			expect(player.previousRestartThreshold).toBe(3);
			expect(player.preloadThreshold).toBe(20);
			expect(player.preservesPitch).toBe(true);
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
			expect(player.ended).toBe(false);
			expect(player.currentTime).toBe(0);
		});
	});
});
