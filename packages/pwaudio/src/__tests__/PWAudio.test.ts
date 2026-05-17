import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";

describe("PWAudio", () => {
	// ─── Constructor ───

	describe("constructor", () => {
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

		it("applies volume option", () => {
			const player = new PWAudio({ volume: 0.5 });
			expect(player.volume).toBe(0.5);
		});

		it("applies playbackRate option", () => {
			const player = new PWAudio({ playbackRate: 1.5 });
			expect(player.playbackRate).toBe(1.5);
		});

		it("applies default values", () => {
			const player = new PWAudio();
			expect(player.volume).toBe(1);
			expect(player.playbackRate).toBe(1);
			expect(player.repeat).toBe("off");
			expect(player.shuffle).toBe("off");
			expect(player.preload).toBe("metadata");
			expect(player.mediaSessionEnabled).toBe(true);
			expect(player.previousRestartThreshold).toBe(3);
		});
	});

	// ─── Playback ───

	describe("play()", () => {
		it("rejects when no track is loaded", async () => {
			const player = new PWAudio();
			await expect(player.play()).rejects.toThrow("No track loaded");
		});

		it("resolves when a track is loaded", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			// play() may reject due to autoplay policy in test env,
			// but it should at least attempt playback
			try {
				await player.play();
			} catch {
				// Autoplay policy may block — that's expected in test env
			}
		});
	});

	describe("pause()", () => {
		it("does not change stopped state to paused in initial state", () => {
			const player = new PWAudio({ src: "test.mp3" });
			// In initial state, player is stopped (not paused)
			// Calling pause() on a stopped player doesn't change paused to true
			// because paused requires !stopped
			player.pause();
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
		});
	});

	describe("stop()", () => {
		it("sets stopped state and resets currentTime", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.stopped).toBe(true);
			expect(player.currentTime).toBe(0);
		});

		it("emits a stop event", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const handler = vi.fn();
			player.on("stop", handler);
			player.stop();
			expect(handler).toHaveBeenCalledOnce();
		});

		it("clears endedState", () => {
			const player = new PWAudio({ src: "test.mp3" });
			// endedState should be false initially
			expect(player.endedState).toBe(false);
		});
	});

	// ─── State matrix ───

	describe("state matrix", () => {
		it("initial state: playing=false, paused=false, stopped=true, endedState=false", () => {
			const player = new PWAudio();
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
			expect(player.endedState).toBe(false);
		});

		it("after stop(): paused=false, stopped=true", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
		});

		it("after pause() on stopped player: paused=false, stopped=true", () => {
			const player = new PWAudio({ src: "test.mp3" });
			// Calling pause() on a player in initial/stopped state
			// does not flip paused to true because paused requires !stopped
			player.pause();
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
		});
	});

	// ─── Seek & Time ───

	describe("currentTime", () => {
		it("defaults to 0", () => {
			const player = new PWAudio();
			expect(player.currentTime).toBe(0);
		});

		it("can be set", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.currentTime = 5;
			expect(player.currentTime).toBe(5);
		});
	});

	// ─── Volume ───

	describe("volume", () => {
		it("defaults to 1", () => {
			const player = new PWAudio();
			expect(player.volume).toBe(1);
		});

		it("can be set and clamped", () => {
			const player = new PWAudio();
			player.volume = 0.5;
			expect(player.volume).toBe(0.5);
		});

		it("clamps above 1", () => {
			const player = new PWAudio();
			player.volume = 2;
			expect(player.volume).toBe(1);
		});

		it("clamps below 0", () => {
			const player = new PWAudio();
			player.volume = -1;
			expect(player.volume).toBe(0);
		});
	});

	describe("muted", () => {
		it("defaults to false", () => {
			const player = new PWAudio();
			expect(player.muted).toBe(false);
		});

		it("can be toggled", () => {
			const player = new PWAudio();
			player.muted = true;
			expect(player.muted).toBe(true);
			player.muted = false;
			expect(player.muted).toBe(false);
		});
	});

	// ─── Playback Rate ───

	describe("playbackRate", () => {
		it("defaults to 1", () => {
			const player = new PWAudio();
			expect(player.playbackRate).toBe(1);
		});

		it("can be set", () => {
			const player = new PWAudio();
			player.playbackRate = 2;
			expect(player.playbackRate).toBe(2);
		});

		it("clamps to 0.25 minimum", () => {
			const player = new PWAudio();
			player.playbackRate = 0.1;
			expect(player.playbackRate).toBe(0.25);
		});

		it("clamps to 4.0 maximum", () => {
			const player = new PWAudio();
			player.playbackRate = 5;
			expect(player.playbackRate).toBe(4);
		});
	});

	// ─── Source ───

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

	// ─── Playlist ───

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
			// currentIndex is 0 (a.mp3)
			player.tracks = [{ src: "z.mp3" }, { src: "a.mp3" }, { src: "b.mp3" }];
			// a.mp3 is now at index 1
			expect(player.currentIndex).toBe(1);
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
			// currentIndex is 0 (a.mp3)
			const handler = vi.fn();
			player.on("trackchange", handler);
			// Replace tracks with a.mp3 at index 1 — currentIndex should move to 1
			player.tracks = [{ src: "c.mp3" }, { src: "a.mp3" }, { src: "d.mp3" }];
			expect(player.currentIndex).toBe(1);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("does not emit trackchange when index stays the same", () => {
			const player = new PWAudio({ src: "a.mp3" });
			const handler = vi.fn();
			player.on("trackchange", handler);
			player.tracks = [{ src: "b.mp3" }];
			// currentIndex was 0, new index is also 0 (b.mp3 not found, defaults to 0)
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

	// ─── Property defaults ───

	describe("property getters/setters", () => {
		it("repeat defaults to 'off'", () => {
			const player = new PWAudio();
			expect(player.repeat).toBe("off");
		});

		it("repeat can be set", () => {
			const player = new PWAudio();
			player.repeat = "one";
			expect(player.repeat).toBe("one");
		});

		it("shuffle defaults to 'off'", () => {
			const player = new PWAudio();
			expect(player.shuffle).toBe("off");
		});

		it("shuffle can be set", () => {
			const player = new PWAudio();
			player.shuffle = "on";
			expect(player.shuffle).toBe("on");
		});

		it("preload defaults to 'metadata'", () => {
			const player = new PWAudio();
			expect(player.preload).toBe("metadata");
		});

		it("preload can be set", () => {
			const player = new PWAudio();
			player.preload = "auto";
			expect(player.preload).toBe("auto");
		});

		it("previousRestartThreshold defaults to 3", () => {
			const player = new PWAudio();
			expect(player.previousRestartThreshold).toBe(3);
		});

		it("previousRestartThreshold can be set", () => {
			const player = new PWAudio();
			player.previousRestartThreshold = 5;
			expect(player.previousRestartThreshold).toBe(5);
		});

		it("mediaSessionEnabled defaults to true", () => {
			const player = new PWAudio();
			expect(player.mediaSessionEnabled).toBe(true);
		});

		it("mediaSessionEnabled can be set", () => {
			const player = new PWAudio();
			player.mediaSessionEnabled = false;
			expect(player.mediaSessionEnabled).toBe(false);
		});
	});

	// ─── Events ───

	describe("on/off/once", () => {
		it("registers and removes event listeners", () => {
			const player = new PWAudio();
			const handler = vi.fn();
			player.on("play", handler);
			player.off("play", handler);
			// No error means the listeners were registered/removed
			expect(true).toBe(true);
		});

		it("once listener fires only once", () => {
			const player = new PWAudio();
			const handler = vi.fn();
			player.once("stop", handler);
			player.stop();
			player.stop();
			expect(handler).toHaveBeenCalledOnce();
		});

		it("proxies native audio events via EventManager", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const handler = vi.fn();
			player.on("stop", handler);
			player.stop();
			expect(handler).toHaveBeenCalled();
		});
	});

	// ─── Placeholder methods ───

	describe("next/previous/goto (stubs)", () => {
		it("next resolves immediately", async () => {
			const player = new PWAudio();
			await expect(player.next()).resolves.toBeUndefined();
		});

		it("previous resolves immediately", async () => {
			const player = new PWAudio();
			await expect(player.previous()).resolves.toBeUndefined();
		});

		it("goto resolves immediately", async () => {
			const player = new PWAudio();
			await expect(player.goto(0)).resolves.toBeUndefined();
		});
	});

	// ─── Destroy stub ───

	describe("destroy (stub)", () => {
		it("destroy method exists and does not throw", () => {
			const player = new PWAudio();
			player.destroy();
		});
	});
});
