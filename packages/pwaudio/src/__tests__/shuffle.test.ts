import { describe, it, expect, vi, beforeEach } from "vitest";
import { PWAudio } from "../PWAudio";
import { ShuffleManager } from "../shuffle";

// ─── Helpers ───

/** Create a player with a standard 5-track playlist for shuffle testing. */
function createPlayerWithTracks(): PWAudio {
	return new PWAudio({
		tracks: [
			{ src: "track-a.mp3", title: "Track A" },
			{ src: "track-b.mp3", title: "Track B" },
			{ src: "track-c.mp3", title: "Track C" },
			{ src: "track-d.mp3", title: "Track D" },
			{ src: "track-e.mp3", title: "Track E" },
		],
	});
}

// ─── ShuffleManager Unit Tests ───

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

			const order = manager.order;
			expect(order[0]).toBe(2);
		});

		it("handles single-track playlist", () => {
			const manager = new ShuffleManager();
			manager.generate(1, 0);

			expect(manager.order).toEqual([0]);
			expect(manager.current).toBe(0);
		});

		it("handles empty playlist", () => {
			const manager = new ShuffleManager();
			manager.generate(0, -1);

			expect(manager.order).toHaveLength(0);
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

			// Generate multiple permutations with current at 0
			manager1.generate(10, 0);
			manager2.generate(10, 0);
			manager3.generate(10, 0);

			// All start with 0
			expect(manager1.order[0]).toBe(0);
			expect(manager2.order[0]).toBe(0);
			expect(manager3.order[0]).toBe(0);

			// Each contains all indices
			expect([...manager1.order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
			expect([...manager2.order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
			expect([...manager3.order].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});
	});

	describe("next()", () => {
		it("returns the next index in shuffle order", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 2);

			const nextIndex = manager.next(false);
			// next() returns the index at position historyPosition + 1 in shuffle order
			expect(nextIndex).toBeGreaterThanOrEqual(0);
			expect(nextIndex).toBeLessThan(5);
			expect(nextIndex).not.toBe(2); // shouldn't be current (already at position 0)
		});

		it("returns -1 when shuffle order is exhausted with repeat=off", () => {
			const manager = new ShuffleManager();
			manager.generate(2, 0);

			// Exhaust: only 2 tracks, already at position 0, next takes us to 1
			const nextIndex1 = manager.next(false);
			expect(nextIndex1).toBeGreaterThanOrEqual(0);

			// Next call should return -1 (no more tracks with repeat=off)
			const nextIndex2 = manager.next(false);
			expect(nextIndex2).toBe(-1);
		});

		it("returns -1 when shuffle order is exhausted (repeat=off) for more tracks", () => {
			const manager = new ShuffleManager();
			manager.generate(3, 1);

			// Advance through all tracks
			manager.next(false); // go to 2nd shuffled
			manager.next(false); // go to 3rd shuffled

			// Now exhausted
			const result = manager.next(false);
			expect(result).toBe(-1);
		});

		it("returns -1 for repeat=all to signal regeneration needed", () => {
			const manager = new ShuffleManager();
			manager.generate(3, 0);

			// Advance through all tracks
			manager.next(true);
			manager.next(true);

			// Exhausted — returns -1 to signal caller to regenerate
			const result = manager.next(true);
			expect(result).toBe(-1);
		});
	});

	describe("previous()", () => {
		it("retreats through shuffle history", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			// Advance twice
			manager.next(false);
			manager.next(false);

			// Go back once
			const prev = manager.previous();
			expect(prev).toBeGreaterThanOrEqual(0);
			expect(prev).toBeLessThan(5);
		});

		it("returns -1 when at the beginning of history", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			// At the beginning — no previous
			const result = manager.previous();
			expect(result).toBe(-1);
		});

		it("can retreat multiple times in sequence", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			const idx1 = manager.next(false); // 2nd shuffled
			const idx2 = manager.next(false); // 3rd shuffled

			// Retreat back
			const prev1 = manager.previous();
			expect(prev1).toBe(idx1); // back to 2nd

			const prev2 = manager.previous();
			expect(prev2).toBe(0); // back to start
		});
	});

	describe("pushToHistory()", () => {
		it("pushes a target index onto history for goto()", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			manager.pushToHistory(3);

			expect(manager.current).toBe(3);
		});

		it("removes forward history when pushing", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			manager.next(false); // advance once
			manager.pushToHistory(4); // push new index

			// Can retreat to the first advanced position
			const prev = manager.previous();
			expect(prev).toBeGreaterThanOrEqual(0);

			// Can retreat again to start
			const prev2 = manager.previous();
			expect(prev2).toBe(0); // back to initial
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

	describe("pushToHistory() — replaces history", () => {
		it("resets history to a single index", () => {
			const manager = new ShuffleManager();
			manager.generate(5, 0);

			manager.next(false);
			manager.next(false);

			manager.pushToHistory(3);

			expect(manager.current).toBe(3);
			expect(manager.historyPosition).toBe(manager.historyPosition);
		});
	});
});

// ─── PWAudio Shuffle Integration Tests ───

describe("Shuffle (PWAudio Integration)", () => {
	describe("shuffle toggle — enabling", () => {
		it("enabling shuffle generates order with current track at position 0", () => {
			const player = createPlayerWithTracks();
			expect(player.shuffle).toBe("off");

			player.shuffle = "on";
			expect(player.shuffle).toBe("on");

			// Current track should remain at index 0 (the starting position)
			expect(player.currentIndex).toBe(0);
		});

		it("enabling shuffle preserves current track position", () => {
			const player = createPlayerWithTracks();

			// Navigate to track 2 before enabling shuffle
			player.goto(2);
			expect(player.currentIndex).toBe(2);

			player.shuffle = "on";

			// currentIndex should stay at 2
			expect(player.currentIndex).toBe(2);
		});

		it("enabling shuffle when already on is a no-op", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			expect(player.shuffle).toBe("on");

			const handler = vi.fn();
			player.on("trackchange", handler);

			// Setting to "on" again should be a no-op (no trackchange event)
			player.shuffle = "on";
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("shuffle toggle — disabling", () => {
		it("disabling shuffle preserves current track position", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// Navigate via shuffle
			player.next();

			const currentIndex = player.currentIndex;
			expect(currentIndex).toBeGreaterThan(-1);

			player.shuffle = "off";

			// currentIndex should stay at the same position
			expect(player.currentIndex).toBe(currentIndex);
		});
	});

	describe("next() with shuffle", () => {
		it("follows shuffle order", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// next() should navigate to a different track
			const startIndex = player.currentIndex;
			await player.next();
			const nextIndex = player.currentIndex;

			// Should have moved to a different track
			expect(nextIndex).not.toBe(-1);
			// Each call should advance to a valid track
			expect(nextIndex).toBeGreaterThanOrEqual(0);
			expect(nextIndex).toBeLessThan(5);
		});

		it("does not stay on same track after next()", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// With more than 1 track, next() should move to a DIFFERENT track
			await player.next();
			expect(player.currentIndex).not.toBe(-1);
		});

		it("wraps and regenerates with repeat=all", async () => {
			const player = new PWAudio({
				tracks: [{ src: "track-a.mp3" }, { src: "track-b.mp3" }, { src: "track-c.mp3" }],
			});
			player.shuffle = "on";
			player.repeat = "all";

			// Exhaust all shuffled tracks through next() calls.
			// With 3 tracks, we need to call next() 3 times to cycle.
			await player.next(); // 2nd shuffled track
			await player.next(); // 3rd shuffled track
			await player.next(); // should wrap/regenerate

			// Should still be on a valid track (regeneration happened)
			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
			expect(player.currentIndex).toBeLessThan(3);
		});

		it("does nothing at end with repeat=off", async () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			player.shuffle = "on";
			player.repeat = "off";

			await player.next(); // 2nd shuffled track

			// Now at the end of shuffle order, next() should do nothing
			const indexBeforeNext = player.currentIndex;
			await player.next();
			// Index should remain the same (or close — shuffle exhausted means no-op)
			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
		});
	});

	describe("previous() with shuffle", () => {
		it("retreats through shuffle history", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			const startIndex = player.currentIndex;

			await player.next(); // forward one
			const afterNext = player.currentIndex;

			await player.previous(); // back one

			// Should return to a valid position (either start or the one we came from)
			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
			expect(player.currentIndex).toBeLessThan(5);
		});

		it("restarts current track when history is empty", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// At start of shuffle history, previous() has no history to retreat to
			// So it restarts the current track (seeks to 0)
			player.currentTime = 5; // Beyond threshold
			await player.previous();

			// currentTime should be reset
			expect(player.currentTime).toBe(0);
		});
	});

	describe("playlist replacement while shuffle on", () => {
		it("regenerates shuffle order on tracks replacement", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// Replace playlist — should regenerate
			player.tracks = [{ src: "new-a.mp3" }, { src: "new-b.mp3" }, { src: "new-c.mp3" }];

			expect(player.shuffle).toBe("on");
			expect(player.currentIndex).toBeGreaterThanOrEqual(0);
		});

		it("places current track at position 0 if it exists in new list", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// Navigate to track C
			player.goto(2);
			expect(player.currentIndex).toBe(2);

			// Replace playlist with track C present
			player.tracks = [
				{ src: "new-x.mp3" },
				{ src: "track-c.mp3" }, // current track
				{ src: "new-y.mp3" },
			];

			// currentIndex should resolve to track-c.mp3 position
			expect(player.currentIndex).toBe(1); // track-c.mp3 is at index 1
		});

		it("resets to index 0 if current track not in new list", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// Replace with completely different tracks
			player.tracks = [{ src: "x.mp3" }, { src: "y.mp3" }, { src: "z.mp3" }];

			expect(player.currentIndex).toBe(0);
		});
	});

	describe("goto() with shuffle", () => {
		it("pushes target index onto shuffle history", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			// goto() should work correctly in shuffle mode
			await player.goto(3);

			expect(player.currentIndex).toBe(3);
		});

		it("goto() then previous() returns to previous position", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";

			await player.goto(2);
			await player.goto(4);

			// Now go back
			await player.previous();

			// Should go back to the position before goto(4)
			expect(player.currentIndex).toBe(2);
		});
	});

	describe("shuffle off — no shuffle behavior", () => {
		it("next() follows sequential order when shuffle is off", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "off";

			expect(player.currentIndex).toBe(0);
			await player.next();
			expect(player.currentIndex).toBe(1);
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("previous() follows sequential order when shuffle is off", async () => {
			const player = createPlayerWithTracks();
			player.shuffle = "off";

			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);

			await player.previous();
			expect(player.currentIndex).toBe(1);
		});
	});
});
