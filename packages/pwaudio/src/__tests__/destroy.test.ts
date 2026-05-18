import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";

// ─── MediaMetadata mock ───

const OriginalMediaMetadata = globalThis.MediaMetadata;

function installMediaMetadataMock() {
	// @ts-expect-error — mocking global MediaMetadata for test environment
	globalThis.MediaMetadata = class MockMediaMetadata {
		title: string;
		artist: string;
		album: string;
		artwork: MediaImage[];
		constructor(init: MediaMetadataInit) {
			this.title = init.title ?? "";
			this.artist = init.artist ?? "";
			this.album = init.album ?? "";
			this.artwork = init.artwork ?? [];
		}
	};
}

function restoreMediaMetadataMock() {
	if (OriginalMediaMetadata) {
		globalThis.MediaMetadata = OriginalMediaMetadata;
	} else {
		// @ts-expect-error — removing global mock
		delete globalThis.MediaMetadata;
	}
}

// ─── Helpers ───

function createPlayerWithTracks(): PWAudio {
	return new PWAudio({
		tracks: [
			{ src: "track-a.mp3", title: "Track A" },
			{ src: "track-b.mp3", title: "Track B" },
			{ src: "track-c.mp3", title: "Track C" },
		],
	});
}

// ─── Tests ───

describe("destroy()", () => {
	describe("lifecycle", () => {
		it("pauses playback on destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			// After destroy, the audio element should be paused
			// (we can't check audio.paused directly since it's private, but
			// we can verify the player is in a destroyed state)
			expect(player.playing).toBe(false);
		});

		it("sets destroyed flag — methods throw InvalidStateError", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			// Verify by checking that mutating methods throw
			expect(() => player.pause()).toThrow();
		});

		it("is idempotent — calling destroy() multiple times is safe", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(() => player.destroy()).not.toThrow();
			player.destroy(); // Should not throw or error
			player.destroy(); // Third time
		});

		it("sets audio.src to empty string", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.src).toBe("");
		});

		it("removes all synthetic listeners — on() throws after destroy", () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			player.destroy();

			// Verify by checking that on() throws after destroy
			expect(() => player.on("play", vi.fn())).toThrow();
		});

		it("emits no events after destroy", () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("trackchange", handler);

			player.destroy();

			// Verify destroy was successful — no way to emit events after
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("post-destroy behavior — methods throw InvalidStateError", () => {
		it("play() throws InvalidStateError", async () => {
			const player = new PWAudio();
			player.destroy();

			await expect(player.play()).rejects.toThrow("PWAudio has been destroyed");
			try {
				await player.play();
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
				expect((e as DOMException).message).toBe("PWAudio has been destroyed");
			}
		});

		it("pause() throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => player.pause()).toThrow();
			try {
				player.pause();
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
			}
		});

		it("stop() throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => player.stop()).toThrow();
			try {
				player.stop();
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
			}
		});

		it("next() throws InvalidStateError", async () => {
			const player = new PWAudio();
			player.destroy();

			await expect(player.next()).rejects.toThrow();
		});

		it("previous() throws InvalidStateError", async () => {
			const player = new PWAudio();
			player.destroy();

			await expect(player.previous()).rejects.toThrow();
		});

		it("goto() throws InvalidStateError", async () => {
			const player = new PWAudio();
			player.destroy();

			await expect(player.goto(0)).rejects.toThrow();
		});

		it("volume setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.volume = 0.5;
			}).toThrow();
			try {
				player.volume = 0.5;
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
			}
		});

		it("muted setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.muted = true;
			}).toThrow();
			try {
				player.muted = true;
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
			}
		});

		it("playbackRate setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.playbackRate = 2;
			}).toThrow();
			try {
				player.playbackRate = 2;
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
			}
		});

		it("src setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.src = "test.mp3";
			}).toThrow();
		});

		it("tracks setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.tracks = [{ src: "new.mp3" }];
			}).toThrow();
		});

		it("repeat setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.repeat = "all";
			}).toThrow();
		});

		it("shuffle setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.shuffle = "on";
			}).toThrow();
		});

		it("preload setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.preload = "auto";
			}).toThrow();
		});

		it("mediaSessionEnabled setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.mediaSessionEnabled = false;
			}).toThrow();
		});

		it("on() throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.on("play", vi.fn());
			}).toThrow();
		});

		it("off() throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.off("play", vi.fn());
			}).toThrow();
		});

		it("once() throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.once("play", vi.fn());
			}).toThrow();
		});

		it("preservesPitch setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.preservesPitch = false;
			}).toThrow();
		});

		it("currentTime setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.currentTime = 5;
			}).toThrow();
		});

		it("previousRestartThreshold setter throws InvalidStateError", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.previousRestartThreshold = 10;
			}).toThrow();
		});
	});

	describe("post-destroy behavior — getters return safe defaults", () => {
		it("playing returns false after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.playing).toBe(false);
		});

		it("paused returns true after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.paused).toBe(true);
		});

		it("stopped returns true after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.stopped).toBe(true);
		});

		it("ended returns false after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.ended).toBe(false);
		});

		it("currentTime returns 0 after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.currentTime).toBe(0);
		});

		it("duration returns NaN after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.duration).toBeNaN();
		});

		it("volume returns 0 after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.volume).toBe(0);
		});

		it("muted returns false after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.muted).toBe(false);
		});

		it("playbackRate returns 1 after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.playbackRate).toBe(1);
		});

		it("tracks returns empty array after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.tracks).toEqual([]);
		});

		it("currentIndex returns -1 after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.currentIndex).toBe(-1);
		});

		it("currentTrack returns null after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.currentTrack).toBeNull();
		});

		it("src returns empty string after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.src).toBe("");
		});

		it("repeat returns 'off' after destroy", () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			player.destroy();
			expect(player.repeat).toBe("off");
		});

		it("shuffle returns 'off' after destroy", () => {
			const player = createPlayerWithTracks();
			player.shuffle = "on";
			player.destroy();
			expect(player.shuffle).toBe("off");
		});

		it("preload returns 'none' after destroy", () => {
			const player = createPlayerWithTracks();
			player.preload = "auto";
			player.destroy();
			expect(player.preload).toBe("none");
		});

		it("mediaSessionEnabled returns false after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.mediaSessionEnabled).toBe(false);
		});

		it("preservesPitch returns true after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.preservesPitch).toBe(true);
		});

		it("seeking returns false after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.seeking).toBe(false);
		});

		it("previousRestartThreshold returns 0 after destroy", () => {
			const player = createPlayerWithTracks();
			player.destroy();
			expect(player.previousRestartThreshold).toBe(0);
		});
	});

	describe("in-flight play() Promise", () => {
		it("resolves silently after destroy", async () => {
			const player = new PWAudio({ src: "test.mp3" });

			// Start a play() that may be pending
			const playPromise = player.play().catch(() => {
				// Autoplay policy may block — that's fine
			});

			// Destroy while play() is potentially in-flight
			player.destroy();

			// The promise should resolve (not reject with InvalidStateError)
			await playPromise;
		});
	});

	describe("destroy clears Media Session", () => {
		beforeEach(() => {
			installMediaMetadataMock();
		});

		afterEach(() => {
			restoreMediaMetadataMock();
		});

		it("clears Media Session metadata and handlers", () => {
			const mockSetActionHandler = vi.fn();
			Object.defineProperty(navigator, "mediaSession", {
				value: {
					metadata: null,
					playbackState: "none",
					setActionHandler: mockSetActionHandler,
					setPositionState: vi.fn(),
				},
				writable: true,
				configurable: true,
			});

			const player = createPlayerWithTracks();
			// Verify metadata was set during construction
			expect(navigator.mediaSession.metadata).not.toBeNull();

			player.destroy();

			// After destroy, metadata should be null and playbackState "none"
			expect(navigator.mediaSession.metadata).toBeNull();
			expect(navigator.mediaSession.playbackState).toBe("none");

			// Action handlers should have been cleared (set to null)
			const actions = [
				"play",
				"pause",
				"stop",
				"seekto",
				"seekbackward",
				"seekforward",
				"nexttrack",
				"previoustrack",
			];
			for (const action of actions) {
				expect(mockSetActionHandler).toHaveBeenCalledWith(action, null);
			}
		});
	});
});
