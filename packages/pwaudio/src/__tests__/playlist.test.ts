import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";
import type { TrackChangeDetail } from "../types";
import { createPlayerWithTracks, createPlayerWithSingleTrack } from "./helpers";

describe("Playlist Engine", () => {
	describe("next()", () => {
		it("advances currentIndex by 1", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			expect(player.currentIndex).toBe(1);
		});

		it("is a no-op at the last track with repeat='off'", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("is a no-op at the last track with repeat='one'", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "one";
			await player.next();
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("wraps to index 0 with repeat='all'", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			await player.next();
			await player.next();
			await player.next();
			expect(player.currentIndex).toBe(0);
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

		it("sets the audio source to the new track", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			expect(player.src).toContain("track-b.mp3");
		});

		it("does not emit trackchange when no advancement occurs (repeat=off at end)", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";
			await player.goto(2);

			const handler = vi.fn();
			player.on("trackchange", handler);
			await player.next();
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("previous()", () => {
		it("restarts current track when currentTime > threshold", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			player.currentTime = 5;
			await player.previous();
			expect(player.currentIndex).toBe(1);
			expect(player.currentTime).toBe(0);
		});

		it("goes to previous track when currentTime <= threshold", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.next();
			await player.previous();
			expect(player.currentIndex).toBe(1);
		});

		it("stays at index 0 with repeat='off' at first track", async () => {
			const player = createPlayerWithTracks();
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		it("wraps to last track with repeat='all' at first track", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			await player.previous();
			expect(player.currentIndex).toBe(2);
		});

		it("emits trackchange event when index changes", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.next();

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
			player.currentTime = 5;

			const handler = vi.fn();
			player.on("trackchange", handler);
			await player.previous();
			expect(handler).not.toHaveBeenCalled();
		});

		it("respects custom previousRestartThreshold", async () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				previousRestartThreshold: 10,
			});
			await player.next();
			player.currentTime = 5;
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		it("previous() at threshold boundary (equal) goes back", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			player.currentTime = 3;
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});
	});

	describe("goto()", () => {
		it("jumps to a specific track by index", async () => {
			const player = createPlayerWithTracks();
			await player.goto(2);
			expect(player.currentIndex).toBe(2);
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

		it("emits trackchange event with correct detail", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(2);
			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail.previousIndex).toBe(0);
			expect(event.detail.currentIndex).toBe(2);
		});

		it("does not emit trackchange when going to same index", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);
			await player.goto(0);
			expect(handler).not.toHaveBeenCalled();
		});

		it("restarts current track when going to same index", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			const handler = vi.fn();
			player.on("trackchange", handler);
			await player.goto(1);
			expect(player.currentIndex).toBe(1);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("#loadTrack (indirect behavior)", () => {
		it("clears stopped state on track change", async () => {
			const player = createPlayerWithTracks();
			expect(player.stopped).toBe(true);
			await player.next();
			expect(player.stopped).toBe(false);
		});

		it("sets audio source to the track's src", async () => {
			const player = createPlayerWithTracks();
			await player.goto(1);
			expect(player.src).toContain("track-b.mp3");
		});
	});

	describe("edge cases", () => {
		it("single track with repeat='all' wraps on next()", async () => {
			const player = createPlayerWithSingleTrack();
			player.repeat = "all";
			await player.next();
			expect(player.currentIndex).toBe(0);
		});

		it("previous() at index 0 with repeat='all' wraps to last track", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			await player.previous();
			expect(player.currentIndex).toBe(2);
		});

		it("next() then previous() returns to original track", async () => {
			const player = createPlayerWithTracks();
			await player.next();
			await player.previous();
			expect(player.currentIndex).toBe(0);
		});

		it("trackchange event detail includes correct track reference", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			await player.goto(2);
			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail.track).toEqual({ src: "track-c.mp3", title: "Track C" });
		});
	});
});
