import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";
import { ShuffleManager } from "../shuffle";
import { createPlayerWithTracks } from "./helpers";

describe("ShuffleManager", () => {
	describe("generate()", () => {
		it("generates a permutation containing all indices exactly once", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			const order = manager.order;
			expect(order).toHaveLength(5);
			expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
		});

		it("places current track at position 0", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 2);
			expect(manager.order[0]).toBe(2);
		});

		it("handles single-track playlist", () => {
			const manager = new ShuffleManager();
			manager.generate(1, 0);
			expect(manager.order).toEqual([0]);
			expect(manager.current).toBe(0);
		});

		it("initializes history with current index", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 3);
			expect(manager.current).toBe(3);
		});

		it("generates different permutations (stochastic)", () => {
			const manager1 = new ShuffleManager();
			const manager2 = new ShuffleManager();
			const manager3 = new ShuffleManager();

			manager1.generate(10, 0);
			manager2.generate(10, 0);
			manager3.generate(10, 0);

			// All start with 0
			expect(manager1.order[0]).toBe(0);
			expect(manager2.order[0]).toBe(0);
			expect(manager3.order[0]).toBe(0);

			// Each contains all indices
			expect([...manager1.order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

			// At least some permutations should differ (probabilistic)
			const same =
				JSON.stringify(manager1.order) === JSON.stringify(manager2.order) &&
				JSON.stringify(manager2.order) === JSON.stringify(manager3.order);
			// Extremely unlikely all 3 are identical with 10 tracks
			expect(same).toBe(false);
		});
	});

	describe("next()", () => {
		it("returns the next index in shuffle order", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 2);

			const nextIndex = manager.next(false);
			expect(nextIndex).toBeGreaterThanOrEqual(0);
			expect(nextIndex).toBeLessThan(5);
			expect(nextIndex).not.toBe(2);
		});

		it("returns -1 when shuffle order is exhausted (repeat=off)", () => {
			const manager = new ShuffleManager();
			manager.generate(2, 0);

			manager.next(false);
			const result = manager.next(false);
			expect(result).toBe(-1);
		});
	});

	describe("previous()", () => {
		it("retreats through shuffle history", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			const idx1 = manager.next(false);
			manager.next(false);

			const prev = manager.previous();
			expect(prev).toBe(idx1);
		});

		it("returns -1 when at the beginning of history", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);
			expect(manager.previous()).toBe(-1);
		});
	});

	describe("pushToHistory()", () => {
		it("pushes a target index onto history for goto()", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);
			manager.pushToHistory(3);
			expect(manager.current).toBe(3);
		});
	});

	describe("clear()", () => {
		it("clears all shuffle state", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);
			manager.clear();
			expect(manager.order).toHaveLength(0);
			expect(manager.current).toBe(-1);
		});
	});
});

// ─── PWAudio Shuffle Integration Tests ───

describe("Shuffle (PWAudio Integration)", () => {
	describe("shuffle toggle", () => {
		it("enabling shuffle preserves current track position", () => {
			const player = createPlayerWithTracks();
			player.goto(2);
			expect(player.currentIndex).toBe(2);

			player.shuffle = "on";
			expect(player.currentIndex).toBe(2);
		});

		it("enabling shuffle when already on is a no-op", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.shuffle = "on";
			expect(handler).not.toHaveBeenCalled();
		});

		it("disabling shuffle preserves current track position", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			player.next();
			const currentIndex = player.currentIndex;
			player.shuffle = "off";
			expect(player.currentIndex).toBe(currentIndex);
		});
	});

	describe("navigation with shuffle", () => {
		it("next() navigates to a valid different track with shuffle on", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			const prev = player.currentIndex;
			await player.next();
			expect(player.currentIndex).not.toBe(prev);
			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
			expect(player.currentIndex).toBeLessThan(5);
		});

		it("wraps and regenerates with repeat=all", async () => {
			const player = new PWAudio({
				tracks: [{ src: "track-a.mp3" }, { src: "track-b.mp3" }, { src: "track-c.mp3" }],
			});
			player.shuffle = "on";
			player.repeat = "all";

			await player.next();
			await player.next();
			await player.next();

			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
			expect(player.currentIndex).toBeLessThan(3);
		});

		it("previous() retreats through shuffle history", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			await player.next();
			await player.previous();

			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
			expect(player.currentIndex).toBeLessThan(5);
		});

		it("restarts current track when history is empty", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			player.currentTime = 5;
			await player.previous();
			expect(player.currentTime).toBe(0);
		});
	});

	describe("playlist replacement while shuffle on", () => {
		it("regenerates shuffle order on tracks replacement", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			player.tracks = [{ src: "new-a.mp3" }, { src: "new-b.mp3" }, { src: "new-c.mp3" }];
			expect(player.shuffle).toBe("on");
			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
		});

		it("places current track at position 0 if it exists in new list", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			player.goto(2);

			player.tracks = [
				{ src: "new-x.mp3" },
				{ src: "track-c.mp3" },
				{ src: "new-y.mp3" },
			];
			expect(player.currentIndex).toBe(1);
		});

		it("resets to index 0 if current track not in new list", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			player.tracks = [{ src: "x.mp3" }, { src: "y.mp3" }, { src: "z.mp3" }];
			expect(player.currentIndex).toBe(0);
		});
	});

	describe("goto() with shuffle", () => {
		it("pushes target index onto shuffle history", async () => {
			const player = createPlayerWithTracks(5);
			player.shuffle = "on";
			await player.goto(3);
			expect(player.currentIndex).toBe(3);
		});

		it("goto() then previous() returns to previous position", async () => {
			const player = createPlayerWithTracks(5);
			player.shuffle = "on";
			await player.goto(2);
			await player.goto(4);
			await player.previous();
			expect(player.currentIndex).toBe(2);
		});
	});
});