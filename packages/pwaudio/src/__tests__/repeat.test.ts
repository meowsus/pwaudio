import { describe, it, expect } from "vitest";
import { PWAudio } from "../PWAudio";

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

/** Create a single-track player. */
function createPlayerWithSingleTrack(): PWAudio {
	return new PWAudio({
		tracks: [{ src: "only.mp3", title: "Only Track" }],
	});
}

// ─── Audio capture for dispatching native events ───

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

describe("Repeat", () => {
	describe("repeat=off", () => {
		it("defaults to 'off'", () => {
			const player = new PWAudio();
			expect(player.repeat).toBe("off");
		});

		it("can be set to 'off'", () => {
			const player = new PWAudio();
			player.repeat = "off";
			expect(player.repeat).toBe("off");
		});

		it("stays at last track on ended (no advancement)", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			// Navigate to last track
			await player.goto(2);
			expect(player.currentIndex).toBe(2);

			// next() at the end with repeat=off should be no-op
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("does not wrap around with repeat=off", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			await player.goto(2);

			// At last track — next() should be no-op
			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("advances normally when not at the last track", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";

			await player.next();
			expect(player.currentIndex).toBe(1);

			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("sets ended true when at last track and ended fires", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }, { src: "c.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				// Navigate to last track
				void player.goto(2);

				// Dispatch ended event
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.ended).toBe(true);
				expect(player.currentIndex).toBe(2); // stays at last track
			} finally {
				restoreAudio();
			}
		});

		it("advances to next track when ended fires on non-last track", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }, { src: "c.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				expect(player.currentIndex).toBe(0);

				// Dispatch ended on first track
				audioEl.dispatchEvent(new Event("ended"));

				// Should clear ended and advance
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("does not auto-advance after ended at last track", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				void player.goto(1);

				// Dispatch ended event on last track
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.currentIndex).toBe(1); // stays at last track
				expect(player.ended).toBe(true);
			} finally {
				restoreAudio();
			}
		});
	});

	describe("repeat=one", () => {
		it("can be set to 'one'", () => {
			const player = new PWAudio();
			player.repeat = "one";
			expect(player.repeat).toBe("one");
		});

		it("replays current track on ended (stays on same track)", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "one";
				const audioEl = getCapturedAudio();

				expect(player.currentIndex).toBe(0);

				// Dispatch ended event
				audioEl.dispatchEvent(new Event("ended"));

				// Should stay on same track
				expect(player.currentIndex).toBe(0);
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("clears ended and restarts when on non-last track", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "one";
				const audioEl = getCapturedAudio();

				void player.goto(1);
				expect(player.currentIndex).toBe(1);

				// Dispatch ended event
				audioEl.dispatchEvent(new Event("ended"));

				// Should stay on track B, with ended cleared
				expect(player.currentIndex).toBe(1);
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("next() is still a no-op at last track (repeat=one doesn't affect next)", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "one";

			await player.goto(2);
			await player.next();

			// repeat=one does NOT affect next() behavior — only ended behavior
			expect(player.currentIndex).toBe(2);
		});
	});

	describe("repeat=all", () => {
		it("can be set to 'all'", () => {
			const player = new PWAudio();
			player.repeat = "all";
			expect(player.repeat).toBe("all");
		});

		it("wraps to first track with next() when at last", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";

			await player.goto(2);
			await player.next();

			expect(player.currentIndex).toBe(0);
		});

		it("wraps to last track with previous() when at first", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";

			await player.previous();

			expect(player.currentIndex).toBe(2);
		});

		it("single track with repeat=all loops indefinitely (equivalent to repeat=one)", () => {
			installAudioCapture();
			try {
				const player = createPlayerWithSingleTrack();
				player.repeat = "all";
				const audioEl = getCapturedAudio();

				expect(player.currentIndex).toBe(0);

				// Dispatch ended event on single track
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.currentIndex).toBe(0);
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("advances normally when not at last track", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";

			await player.next();
			expect(player.currentIndex).toBe(1);

			await player.next();
			expect(player.currentIndex).toBe(2);
		});

		it("clears ended on advancement via next()", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";

			await player.goto(2);
			await player.next();

			expect(player.ended).toBe(false);
		});
	});

	describe("destroyed state throws", () => {
		it("repeat setter throws InvalidStateError after destroy", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.repeat = "all";
			}).toThrow();
			try {
				player.repeat = "all";
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
			}
		});

		it("repeat getter returns 'off' after destroy", () => {
			const player = new PWAudio();
			player.repeat = "all";
			player.destroy();

			expect(player.repeat).toBe("off");
		});
	});
});
