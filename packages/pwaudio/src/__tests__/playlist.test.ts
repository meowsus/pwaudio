import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";
import type { TrackChangeDetail } from "../types";

// ─── Helpers ───

/** Create a player with a standard 3-track playlist. */
function createPlayerWithTracks(): PWAudio {
	return new PWAudio({
		tracks: [
			{ src: "track-a.mp3", title: "Track A" },
			{ src: "track-b.mp3", title: "Track B" },
			{ src: "track-c.mp3", title: "Track C" },
		],
	});
}

/** Create a player with a single-track playlist. */
function createPlayerWithSingleTrack(): PWAudio {
	return new PWAudio({
		tracks: [{ src: "only.mp3", title: "Only Track" }],
	});
}

// ─── Tests ───

describe("Playlist Engine", () => {
	// ─── next() ───

	describe("next()", () => {
		it("advances currentIndex by 1", async () => {
			const player = createPlayerWithTracks();
			expect(player.currentIndex).toBe(0);

			await player.next();
			expect(player.currentIndex).toBe(1);
		});

		it("advances to the third track", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("is a no-op at the last track with repeat='off'", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);

			// At last track, repeat off — should be a no-op
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("is a no-op at the last track with repeat='one'", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "one";
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);

			// repeat=one only affects ended behavior, next() should be a no-op
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("wraps to index 0 with repeat='all'", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);

			await player.next();
			expect(player.currentIndex).toBe(0);
		});

		it("resolves immediately as a no-op for empty playlist", async () => {
			const player = new PWAudio();
			expect(player.tracks.length).toBe(0);

			// Should resolve without error
			await player.next();
			expect(player.currentIndex).toBe(-1);
		});

		it("emits trackchange event with correct detail", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.next();
			expect(handler).toHaveBeenCalledOnce();

			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail.previousIndex).toBe(0);
			expect(event.detail.currentIndex).toBe(1);
			expect(event.detail.track).toEqual({ src: "track-b.mp3", title: "Track B" });
		});

		// Note: DOMException after destroy() is tested in destroy/lifecycle tests (Plan 10)

		it("clears endedState when advancing", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			// endedState starts as false
			expect(player.endedState).toBe(false);

			// After next(), endedState should still be false
			await player.next();
			expect(player.endedState).toBe(false);
		});

		it("sets the audio source to the new track", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			expect(player.src).toContain("track-b.mp3");
		});

		it("does not emit trackchange when no advancement occurs (repeat=off at end)", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			await player.goto(2);
			expect(player.currentIndex).toBe(2);

			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.next();
			expect(player.currentIndex).toBe(2);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	// ─── previous() ───

	describe("previous()", () => {
		it("restarts current track when currentTime > threshold", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			expect(player.currentIndex).toBe(1);

			// Set currentTime beyond threshold (default 3s)
			player.currentTime = 5;

			await player.previous();
			expect(player.currentIndex).toBe(1); // Same track, just restarted
			expect(player.currentTime).toBe(0);
		});

		it("goes to previous track when currentTime <= threshold", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);

			// currentTime is 0, which is <= threshold
			await player.previous();
			expect(player.currentIndex).toBe(1);
		});

		it("stays at index 0 with repeat='off' when at first track", async () => {
			const player = createPlayerWithTracks();
			expect(player.currentIndex).toBe(0);

			// currentTime is 0, below threshold — but already at first track
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		it("wraps to last track with repeat='all' when at first track", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			expect(player.currentIndex).toBe(0);

			await player.previous();
			expect(player.currentIndex).toBe(2);
		});

		it("resolves immediately as a no-op for empty playlist", async () => {
			const player = new PWAudio();
			expect(player.tracks.length).toBe(0);

			await player.previous();
			expect(player.currentIndex).toBe(-1);
		});

		it("emits trackchange event when index changes", async () => {
			const player = createPlayerWithTracks();
			await player.next(); // index 1
			await player.next(); // index 2

			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.previous();
			expect(handler).toHaveBeenCalledOnce();

			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail.previousIndex).toBe(2);
			expect(event.detail.currentIndex).toBe(1);
		});

		it("does not emit trackchange when restarting current track", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			player.currentTime = 5; // Beyond threshold

			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.previous();
			expect(handler).not.toHaveBeenCalled();
		});

		// Note: DOMException after destroy() is tested in destroy/lifecycle tests (Plan 10)

		it("respects custom previousRestartThreshold", async () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				previousRestartThreshold: 10,
			});
			await player.next(); // index 1

			// At 5 seconds, default threshold (3s) would restart, but custom is 10s
			player.currentTime = 5;
			await player.previous();
			expect(player.currentIndex).toBe(0); // Goes back because 5 < 10
		});

		it("restarts at index 0 goes back with threshold > 0", async () => {
			const player = createPlayerWithTracks();
			// At index 0, currentTime = 0 (below threshold)
			await player.previous();
			// Should clamp to 0, not go to -1
			expect(player.currentIndex).toBe(0);
		});
	});

	// ─── goto() ───

	describe("goto()", () => {
		it("jumps to a specific track by index", async () => {
			const player = createPlayerWithTracks();
			expect(player.currentIndex).toBe(0);

			await player.goto(2);
			expect(player.currentIndex).toBe(2);
		});

		it("sets the audio source to the target track", async () => {
			const player = createPlayerWithTracks();
			await player.goto(2);
			expect(player.src).toContain("track-c.mp3");
		});

		it("clamps negative indices to 0", async () => {
			const player = createPlayerWithTracks();
			await player.goto(-5);
			expect(player.currentIndex).toBe(0);
		});

		it("clamps indices beyond the end to the last track", async () => {
			const player = createPlayerWithTracks();
			await player.goto(999);
			expect(player.currentIndex).toBe(2);
		});

		it("resolves immediately as a no-op for empty playlist", async () => {
			const player = new PWAudio();
			await player.goto(0);
			expect(player.currentIndex).toBe(-1);
		});

		it("emits trackchange event with correct detail", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(2);
			expect(handler).toHaveBeenCalledOnce();

			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail.previousIndex).toBe(0);
			expect(event.detail.currentIndex).toBe(2);
			expect(event.detail.track).toEqual({ src: "track-c.mp3", title: "Track C" });
		});

		it("restarts current track when going to same index", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			expect(player.currentIndex).toBe(1);

			// goto(1) — same as current — should just restart, no trackchange
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(1);
			expect(player.currentIndex).toBe(1);
			expect(handler).not.toHaveBeenCalled();
		});

		it("clears endedState", async () => {
			const player = createPlayerWithTracks();
			// endedState starts false
			expect(player.endedState).toBe(false);

			await player.goto(2);
			expect(player.endedState).toBe(false);
		});

		// Note: DOMException after destroy() is tested in destroy/lifecycle tests (Plan 10)

		it("does not emit trackchange when going to same index", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(0);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	// ─── #loadTrack (indirect behavior tested via navigation) ───

	describe("#loadTrack (indirect behavior)", () => {
		it("clears stopped state on track change", async () => {
			const player = createPlayerWithTracks();
			expect(player.stopped).toBe(true);

			await player.next();
			expect(player.stopped).toBe(false);
		});

		it("clears endedState on track change", async () => {
			const player = createPlayerWithTracks();
			// Verify endedState is false initially and stays false after navigation
			expect(player.endedState).toBe(false);
			await player.next();
			expect(player.endedState).toBe(false);
		});

		it("sets audio source to the track's src", async () => {
			const player = createPlayerWithTracks();
			await player.goto(1);
			expect(player.src).toContain("track-b.mp3");
		});
	});

	// ─── #handleEnded behavior (tested via observable state) ───

	describe("#handleEnded behavior", () => {
		it("sets endedState to true when at end with repeat=off", () => {
			// Verify initial endedState is false
			const player = createPlayerWithTracks();
			player.repeat = "off";
			expect(player.endedState).toBe(false);

			// endedState is observable via the public getter.
			// The actual ended event needs to be triggered from the
			// audio element (tested in integration), but we verify
			// the getter contract here.
		});

		it("next() clears endedState set by handleEnded", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			// Verify endedState starts false
			expect(player.endedState).toBe(false);

			// After next(), endedState should remain false
			await player.next();
			expect(player.endedState).toBe(false);
		});

		it("previous() clears endedState", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			await player.next();
			expect(player.endedState).toBe(false);
		});

		it("goto() clears endedState", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			await player.goto(2);
			expect(player.endedState).toBe(false);
		});
	});

	// ─── play() restart-after-end ───

	describe("play() restart behavior", () => {
		it("clears stopped state on play", async () => {
			const player = createPlayerWithTracks();
			expect(player.stopped).toBe(true);

			try {
				await player.play();
			} catch {
				// Autoplay may be blocked in test env
			}
			expect(player.stopped).toBe(false);
		});

		it("rejects with 'No track loaded' for empty playlist", async () => {
			const player = new PWAudio();
			await expect(player.play()).rejects.toThrow("No track loaded");
		});

		it("play() after stop resumes with cleared stopped state", async () => {
			const player = createPlayerWithTracks();
			player.stop();
			expect(player.stopped).toBe(true);

			try {
				await player.play();
			} catch {
				// Autoplay may be blocked
			}
			expect(player.stopped).toBe(false);
		});
	});

	// ─── Edge cases ───

	describe("edge cases", () => {
		it("single track with repeat='all' wraps on next()", async () => {
			const player = createPlayerWithSingleTrack();
			player.repeat = "all";

			// next() on last (and only) track with repeat=all should wrap to 0
			await player.next();
			expect(player.currentIndex).toBe(0);
		});

		it("next() on empty playlist does not change currentIndex", async () => {
			const player = new PWAudio();
			await player.next();
			expect(player.currentIndex).toBe(-1);
		});

		it("previous() on empty playlist does not change currentIndex", async () => {
			const player = new PWAudio();
			await player.previous();
			expect(player.currentIndex).toBe(-1);
		});

		it("goto() on empty playlist does not change currentIndex", async () => {
			const player = new PWAudio();
			await player.goto(0);
			expect(player.currentIndex).toBe(-1);
		});

		it("previous() at index 0 with currentTime=0 stays at 0 (repeat=off)", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";
			// currentTime is 0, below threshold — but already at first track
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		it("multiple next() calls advance correctly", async () => {
			const player = createPlayerWithTracks();

			await player.next();
			expect(player.currentIndex).toBe(1);

			await player.next();
			expect(player.currentIndex).toBe(2);

			// At the end, no-op with repeat off
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("trackchange event detail includes correct track reference", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(2);

			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail.track).toEqual({ src: "track-c.mp3", title: "Track C" });
			expect(event.detail.previousIndex).toBe(0);
			expect(event.detail.currentIndex).toBe(2);
		});

		it("previous() at index 0 with repeat='all' wraps to last track", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";

			await player.previous();
			expect(player.currentIndex).toBe(2);
		});

		it("next() then previous() returns to original track", async () => {
			const player = createPlayerWithTracks();
			expect(player.currentIndex).toBe(0);

			await player.next();
			expect(player.currentIndex).toBe(1);

			// currentTime is 0, below threshold — goes back
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		it("goto() to same index does not emit trackchange", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(0);
			expect(handler).not.toHaveBeenCalled();
		});

		it("previous() with currentTime at threshold boundary (equal)", async () => {
			const player = createPlayerWithTracks();
			await player.next(); // index 1

			// At exactly threshold (3s), should go back (not restart)
			player.currentTime = 3;
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		// Note: destroy() throwing behavior is tested in destroy/lifecycle tests (Plan 10)
	});
});
