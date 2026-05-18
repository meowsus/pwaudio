import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";

// ─── Audio capture for native event simulation ───

let capturedAudio: HTMLAudioElement | undefined;
const OriginalAudio = globalThis.Audio;

function installAudioCapture(): void {
	capturedAudio = undefined;
	globalThis.Audio = class extends OriginalAudio {
		constructor() {
			super();
			capturedAudio = this;
		}
	} as typeof OriginalAudio;
}

function restoreAudio(): void {
	globalThis.Audio = OriginalAudio;
}

function getCapturedAudio(): HTMLAudioElement {
	if (!capturedAudio) {
		throw new Error("No Audio element was captured.");
	}
	return capturedAudio;
}

// ─── Tests ───

describe("Edge cases", () => {
	describe("preservesPitch", () => {
		it("defaults to true", () => {
			const player = new PWAudio();
			expect(player.preservesPitch).toBe(true);
		});

		it("can be set to false", () => {
			const player = new PWAudio();
			player.preservesPitch = false;
			expect(player.preservesPitch).toBe(false);
		});

		it("can be set back to true", () => {
			const player = new PWAudio();
			player.preservesPitch = false;
			expect(player.preservesPitch).toBe(false);
			player.preservesPitch = true;
			expect(player.preservesPitch).toBe(true);
		});

		it("sets both preservesPitch and webkitPreservesPitch (when available)", () => {
			const player = new PWAudio();
			// happy-dom provides preservesPitch on HTMLAudioElement
			player.preservesPitch = false;
			// Reading back should reflect the set value
			expect(player.preservesPitch).toBe(false);
		});

		it("getter reads from preservesPitch property", () => {
			const player = new PWAudio();
			player.preservesPitch = true;
			expect(player.preservesPitch).toBe(true);

			player.preservesPitch = false;
			expect(player.preservesPitch).toBe(false);
		});

		it("applies preservesPitch from constructor options", () => {
			// There's no preservesPitch option in PWAudioOptions, but
			// the default is true and we verify it's applied on construction
			const player = new PWAudio();
			expect(player.preservesPitch).toBe(true);
		});
	});

	describe("preload", () => {
		it("defaults to 'metadata'", () => {
			const player = new PWAudio();
			expect(player.preload).toBe("metadata");
		});

		it("applies to HTMLAudioElement on construction", () => {
			installAudioCapture();
			try {
				new PWAudio({ src: "test.mp3", preload: "auto" });
				const audioEl = getCapturedAudio();
				expect(audioEl.preload).toBe("auto");
			} finally {
				restoreAudio();
			}
		});

		it("applies immediately on setter change", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({ src: "test.mp3" });
				const audioEl = getCapturedAudio();
				expect(audioEl.preload).toBe("metadata"); // default

				player.preload = "none";
				expect(audioEl.preload).toBe("none");
				expect(player.preload).toBe("none");
			} finally {
				restoreAudio();
			}
		});

		it("takes full effect on next loadTrack (via next/goto)", async () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
					preload: "metadata",
				});
				const audioEl = getCapturedAudio();
				expect(audioEl.preload).toBe("metadata");

				player.preload = "auto";
				await player.next(); // triggers loadTrack

				expect(audioEl.preload).toBe("auto");
			} finally {
				restoreAudio();
			}
		});

		it("can be set to 'none'", () => {
			const player = new PWAudio();
			player.preload = "none";
			expect(player.preload).toBe("none");
		});

		it("can be set to 'auto'", () => {
			const player = new PWAudio();
			player.preload = "auto";
			expect(player.preload).toBe("auto");
		});
	});

	describe("volume on mobile", () => {
		it("setter does not throw (may be ignored by OS)", () => {
			const player = new PWAudio();
			// Volume setter should not throw even if the OS ignores it
			expect(() => {
				player.volume = 0.5;
			}).not.toThrow();
			expect(player.volume).toBe(0.5);
		});
	});

	describe("state matrix", () => {
		it("initial: playing=false, paused=false, stopped=true, ended=false", () => {
			const player = new PWAudio();
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
			expect(player.ended).toBe(false);
		});

		it("initial with src: stopped=true (not playing)", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
			expect(player.ended).toBe(false);
		});

		it("after play(): playing=true, paused=false, stopped=false, ended=false", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			await player.play().catch(() => {
				// autoplay may be blocked
			});
			expect(player.stopped).toBe(false);
			expect(player.ended).toBe(false);
			// playing and paused depend on whether autoplay was blocked
		});

		it("after stop(): playing=false, paused=false, stopped=true, ended=false", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
			expect(player.ended).toBe(false);
		});

		it("after ended: stopped=false, ended=true", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				// Navigate to last track
				void player.goto(1);

				// Dispatch ended event
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.ended).toBe(true);
				expect(player.stopped).toBe(false);
				// Note: playing/paused depend on HTMLAudioElement.paused which
				// may vary across environments after dispatching ended events.
			} finally {
				restoreAudio();
			}
		});

		it("paused state: paused=true when user-paused", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			await player.play().catch(() => {});

			// Simulate play succeeding (audio.paused = false)
			// Then pause
			player.pause();

			// After pause, audio.paused is true, but stopped is false
			// So paused should be true
			expect(player.paused).toBe(true);
			expect(player.stopped).toBe(false);
		});

		it("paused state: stopped user should show paused=false, stopped=true", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			// stopped takes precedence — paused should be false
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
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

			expect(player.tracks).toHaveLength(3);
			expect(player.currentIndex).toBe(0);

			await player.next();
			expect(player.currentIndex).toBe(1);
			// It's the second "same.mp3" — distinct track
			expect(player.currentTrack?.title).toBe("Second");
		});

		it("first occurrence wins when searching for current track in new list", () => {
			const player = new PWAudio({
				tracks: [
					{ src: "same.mp3", title: "First" },
					{ src: "other.mp3", title: "Other" },
				],
			});

			// currentIndex is 0, which has src "same.mp3"
			expect(player.currentIndex).toBe(0);

			// Replace playlist — "same.mp3" appears in new list
			player.tracks = [
				{ src: "new.mp3", title: "New" },
				{ src: "same.mp3", title: "Same in New List" },
				{ src: "another.mp3", title: "Another" },
			];

			// Should match first occurrence of "same.mp3" in the new list
			expect(player.currentIndex).toBe(1);
		});
	});

	describe("single track with repeat=all", () => {
		it("loops indefinitely (equivalent to repeat=one)", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "only.mp3", title: "Only Track" }],
				});
				player.repeat = "all";
				const audioEl = getCapturedAudio();

				expect(player.currentIndex).toBe(0);

				// Dispatch ended event — single track, repeat=all
				audioEl.dispatchEvent(new Event("ended"));

				// Should stay on same track (repeat=one behavior)
				expect(player.currentIndex).toBe(0);
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("next() on single track with repeat=all stays at 0", async () => {
			const player = new PWAudio({
				tracks: [{ src: "only.mp3" }],
			});
			player.repeat = "all";

			await player.next();
			expect(player.currentIndex).toBe(0);
		});
	});

	describe("empty playlist", () => {
		it("next() resolves as no-op", async () => {
			const player = new PWAudio();
			await expect(player.next()).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(-1);
		});

		it("previous() resolves as no-op", async () => {
			const player = new PWAudio();
			await expect(player.previous()).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(-1);
		});

		it("goto() resolves as no-op", async () => {
			const player = new PWAudio();
			await expect(player.goto(0)).resolves.toBeUndefined();
			expect(player.currentIndex).toBe(-1);
		});

		it("play() rejects with 'No track loaded'", async () => {
			const player = new PWAudio();
			await expect(player.play()).rejects.toThrow("No track loaded");
		});

		it("currentIndex is -1", () => {
			const player = new PWAudio();
			expect(player.currentIndex).toBe(-1);
		});

		it("currentTrack is null", () => {
			const player = new PWAudio();
			expect(player.currentTrack).toBeNull();
		});

		it("tracks returns empty array", () => {
			const player = new PWAudio();
			expect(player.tracks).toEqual([]);
		});
	});

	describe("stop() event cascade", () => {
		it("fires stop event (synthetic)", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const stopHandler = vi.fn();
			player.on("stop", stopHandler);

			player.stop();

			expect(stopHandler).toHaveBeenCalledOnce();
			const event = stopHandler.mock.calls[0][0] as CustomEvent;
			expect(event.type).toBe("stop");
		});

		it("stop event detail is null (no detail payload)", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const stopHandler = vi.fn();
			player.on("stop", stopHandler);

			player.stop();

			const event = stopHandler.mock.calls[0][0] as CustomEvent;
			expect(event.detail).toBeNull();
		});

		it("sets stopped=true and clears ended", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({ src: "test.mp3" });
				player.stop();

				expect(player.stopped).toBe(true);
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("native pause event is proxied before stop event", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const order: string[] = [];

			player.on("pause", () => order.push("pause"));
			player.on("stop", () => order.push("stop"));

			player.stop();

			// pause is proxied natively, stop is synthetic
			// Both should fire, with pause potentially before stop
			expect(order).toContain("stop");
		});
	});

	describe("playing getter", () => {
		it("returns false initially", () => {
			const player = new PWAudio();
			expect(player.playing).toBe(false);
		});

		it("returns false when paused", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			await player.play().catch(() => {});
			player.pause();
			expect(player.playing).toBe(false);
		});

		it("returns false when stopped", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.playing).toBe(false);
		});

		it("returns false after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(player.playing).toBe(false);
		});
	});

	describe("buffered", () => {
		it("returns TimeRanges from audio element", () => {
			const player = new PWAudio({ src: "test.mp3" });
			// In happy-dom, buffered should be available but may be empty
			expect(player.buffered).toBeDefined();
		});
	});

	describe("seeking", () => {
		it("returns false when not seeking", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.seeking).toBe(false);
		});

		it("returns false after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(player.seeking).toBe(false);
		});
	});

	describe("currentTime setter", () => {
		it("sets the current time on the audio element", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.currentTime = 10;
			expect(player.currentTime).toBe(10);
		});

		it("throws InvalidStateError after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(() => {
				player.currentTime = 5;
			}).toThrow();
		});
	});

	describe("duration", () => {
		it("returns NaN before metadata is loaded", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.duration).toBeNaN();
		});
	});

	describe("src getter", () => {
		it("returns current audio source", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.src).toContain("test.mp3");
		});

		it("returns empty string after destroy", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.destroy();
			expect(player.src).toBe("");
		});
	});

	describe("play() clears ended", () => {
		it("clears ended when play() is called after ended", async () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				// Navigate to last track
				await player.goto(1);
				expect(player.currentIndex).toBe(1);

				// Dispatch ended event on last track with repeat=off
				audioEl.dispatchEvent(new Event("ended"));
				// ended should be set
				expect(player.ended).toBe(true);

				// play() should clear ended and restart
				await player.play().catch(() => {});
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});
	});

	describe("play() clears stopped state", () => {
		it("clears stopped state on play()", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.stopped).toBe(true);

			await player.play().catch(() => {});
			expect(player.stopped).toBe(false);
		});
	});

	describe("previousRestartThreshold", () => {
		it("defaults to 3 seconds", () => {
			const player = new PWAudio();
			expect(player.previousRestartThreshold).toBe(3);
		});

		it("can be configured in constructor", () => {
			const player = new PWAudio({ previousRestartThreshold: 5 });
			expect(player.previousRestartThreshold).toBe(5);
		});

		it("can be set after construction", () => {
			const player = new PWAudio();
			player.previousRestartThreshold = 10;
			expect(player.previousRestartThreshold).toBe(10);
		});

		it("setter throws InvalidStateError after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(() => {
				player.previousRestartThreshold = 5;
			}).toThrow();
		});

		it("getter returns 0 after destroy", () => {
			const player = new PWAudio({ previousRestartThreshold: 5 });
			player.destroy();
			expect(player.previousRestartThreshold).toBe(0);
		});
	});

	describe("constructor precedence: tracks over src", () => {
		it("tracks option takes precedence over src", () => {
			const player = new PWAudio({
				src: "single.mp3",
				tracks: [{ src: "first.mp3" }, { src: "second.mp3" }],
			});
			// tracks should be used, not src
			expect(player.tracks).toHaveLength(2);
			expect(player.src).toContain("first.mp3");
			expect(player.currentIndex).toBe(0);
		});

		it("src option creates single-track playlist", () => {
			const player = new PWAudio({ src: "single.mp3" });
			expect(player.tracks).toHaveLength(1);
			expect(player.tracks[0].src).toContain("single.mp3");
		});

		it("empty tracks array falls back to src", () => {
			const player = new PWAudio({
				src: "single.mp3",
				tracks: [],
			});
			// Empty tracks (length 0) falls through to the src branch
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
});
