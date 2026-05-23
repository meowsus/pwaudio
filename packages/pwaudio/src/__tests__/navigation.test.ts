import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";

describe("Navigation", () => {
	describe("src setter (destructive)", () => {
		it("replaces entire playlist with single track", () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			expect(player.tracks).toHaveLength(2);

			player.src = "new.mp3";
			expect(player.tracks).toHaveLength(1);
			expect(player.currentIndex).toBe(0);
		});

		it("emits playlistchange event", () => {
			const player = new PWAudio({ src: "old.mp3" });
			const handler = vi.fn();
			player.on("playlistchange", handler);
			player.src = "new.mp3";
			expect(handler).toHaveBeenCalledOnce();
		});

		it("emits trackchange event when source changes", () => {
			const player = new PWAudio({ src: "old.mp3" });
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.src = "new.mp3";
			expect(handler).toHaveBeenCalledOnce();
		});

		it("sets stopped state", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.src = "new.mp3";
			expect(player.stopped).toBe(true);
		});
	});

	describe("tracks setter", () => {
		it("replaces the playlist", () => {
			const player = new PWAudio({ src: "a.mp3" });
			player.tracks = [{ src: "x.mp3" }, { src: "y.mp3" }, { src: "z.mp3" }];
			expect(player.tracks).toHaveLength(3);
		});

		it("preserves current track position if src matches", () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }, { src: "c.mp3" }],
			});
			player.tracks = [{ src: "z.mp3" }, { src: "a.mp3" }, { src: "b.mp3" }];
			expect(player.currentIndex).toBe(1); // a.mp3 is now at index 1
		});

		it("resets to 0 if current src not found", () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			player.tracks = [{ src: "c.mp3" }, { src: "d.mp3" }];
			expect(player.currentIndex).toBe(0);
		});

		it("sets currentIndex to -1 for empty array", () => {
			const player = new PWAudio({ src: "a.mp3" });
			player.tracks = [];
			expect(player.currentIndex).toBe(-1);
			expect(player.currentTrack).toBeNull();
		});

		it("clears audio.src when setting empty playlist", () => {
			const player = new PWAudio({ src: "a.mp3" });
			expect(player.src).toContain("a.mp3");
			player.tracks = [];
			expect(player.src).toBe("");
		});

		it("emits playlistchange event", () => {
			const player = new PWAudio({ src: "a.mp3" });
			const handler = vi.fn();
			player.on("playlistchange", handler);
			player.tracks = [{ src: "b.mp3" }];
			expect(handler).toHaveBeenCalledOnce();
		});

		it("emits trackchange when index actually changes", () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.tracks = [{ src: "c.mp3" }, { src: "a.mp3" }, { src: "d.mp3" }];
			expect(player.currentIndex).toBe(1);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("does not emit trackchange when index stays the same", () => {
			const player = new PWAudio({ src: "a.mp3" });
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.tracks = [{ src: "b.mp3" }];
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("currentTrack", () => {
		it("returns null when no tracks", () => {
			const player = new PWAudio();
			expect(player.currentTrack).toBeNull();
		});

		it("returns the track at currentIndex", () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			expect(player.currentTrack).toEqual({ src: "a.mp3" });
		});
	});

	describe("duplicate src in playlist", () => {
		it("treats duplicate entries as distinct tracks", async () => {
			const player = new PWAudio({
				tracks: [
					{ src: "same.mp3", title: "First" },
					{ src: "same.mp3", title: "Second" },
					{ src: "other.mp3", title: "Third" },
				],
			});

			await player.next();
			expect(player.currentIndex).toBe(1);
			expect(player.currentTrack?.title).toBe("Second");
		});

		it("first occurrence wins when searching for current track in new list", () => {
			const player = new PWAudio({
				tracks: [
					{ src: "same.mp3", title: "First" },
					{ src: "other.mp3", title: "Other" },
				],
			});

			player.tracks = [
				{ src: "new.mp3", title: "New" },
				{ src: "same.mp3", title: "Same in New List" },
				{ src: "another.mp3", title: "Another" },
			];

			expect(player.currentIndex).toBe(1); // first occurrence of "same.mp3"
		});
	});

	describe("empty playlist no-ops", () => {
		it("next() resolves immediately on empty playlist", async () => {
			const player = new PWAudio();
			await expect(player.next()).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(-1);
		});

		it("previous() resolves immediately on empty playlist", async () => {
			const player = new PWAudio();
			await expect(player.previous()).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(-1);
		});

		it("goto() resolves immediately on empty playlist", async () => {
			const player = new PWAudio();
			await expect(player.goto(0)).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(-1);
		});
	});

	describe("currentTime", () => {
		it("can be set on the audio element", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.currentTime = 5;
			expect(player.currentTime).toBe(5);
		});
	});
});
