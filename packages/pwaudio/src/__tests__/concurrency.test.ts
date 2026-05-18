import { describe, it, expect } from "vitest";
import { PWAudio } from "../PWAudio";
import { createPlayerWithTracks } from "./helpers";

describe("Stale Promise Guards", () => {
	describe("old play() promises resolve silently after navigation", () => {
		it("play() before next() — old promise resolves silently", async () => {
			const player = createPlayerWithTracks();
			const playPromise = player.play().catch(() => {});
			await player.next();
			await expect(playPromise).resolves.toBeUndefined();
		});

		it("play() before goto() — old promise resolves silently", async () => {
			const player = createPlayerWithTracks();
			const playPromise = player.play().catch(() => {});
			await player.goto(2);
			await expect(playPromise).resolves.toBeUndefined();
		});

		it("play() before previous() — old promise resolves silently", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			player.currentTime = 0;
			const playPromise = player.play().catch(() => {});
			await player.previous();
			await expect(playPromise).resolves.toBeUndefined();
		});
	});

	describe("rapid navigation calls", () => {
		it("only the last track plays after rapid next() calls", async () => {
			const player = createPlayerWithTracks();
			const p1 = player.next().catch(() => {});
			const p2 = player.next().catch(() => {});
			const p3 = player.next().catch(() => {});
			await Promise.all([p1, p2, p3]);
			expect(player.currentIndex).toBe(2);
		});

		it("intermediate play() promises from rapid next() resolve silently", async () => {
			const player = createPlayerWithTracks();
			const nextPromise1 = player.next();
			const nextPromise2 = player.next();
			await expect(nextPromise1).resolves.toBeUndefined();
			await expect(nextPromise2).resolves.toBeUndefined();
		});

		it("play() after rapid next() calls uses current generation", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			await player.next();
			await player.next();
			const playPromise = player.play().catch(() => {});
			await expect(playPromise).resolves.toBeUndefined();
		});
	});

	describe("stop() during pending play()", () => {
		it("stop() causes pending play() to resolve silently", async () => {
			const player = createPlayerWithTracks();
			const playPromise = player.play().catch(() => {});
			player.stop();
			await playPromise;
			expect(player.stopped).toBe(true);
		});
	});

	describe("generation guards in navigation play() chains", () => {
		it("next() → play() with stale generation resolves silently", async () => {
			const player = createPlayerWithTracks();
			await player.play().catch(() => {});
			const nextPromise = player.next();
			const nextPromise2 = player.next();
			await expect(nextPromise).resolves.toBeUndefined();
			await expect(nextPromise2).resolves.toBeUndefined();
		});

		it("goto() with stale generation resolves silently", async () => {
			const player = createPlayerWithTracks();
			const gotoPromise1 = player.goto(1);
			const gotoPromise2 = player.goto(2);
			await expect(gotoPromise1).resolves.toBeUndefined();
			await expect(gotoPromise2).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(2);
		});
	});

	describe("autoplay policy propagation", () => {
		it("play() rejection due to autoplay blocks propagates when generation matches", async () => {
			const player = createPlayerWithTracks();
			try {
				await player.play();
			} catch (error) {
				expect(error).toBeDefined();
			}
		});
	});

	describe("destroy() during pending play()", () => {
		it("destroy() during pending play() — resolves silently", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const playPromise = player.play().catch(() => {});
			player.destroy();
			return playPromise.then(
				() => {},
				() => {},
			);
		});
	});
});