import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";
import {
	installAudioCapture,
	restoreAudio,
	getCapturedAudio,
	createPlayerWithTracks,
	createPlayerWithSingleTrack,
} from "./helpers";

describe("Repeat", () => {
	describe("repeat=off", () => {
		it("stays at last track on ended (no advancement)", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "off";
			await player.goto(2);
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

				void player.goto(2);
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.ended).toBe(true);
				expect(player.currentIndex).toBe(2);
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

				audioEl.dispatchEvent(new Event("ended"));
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
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.currentIndex).toBe(1);
				expect(player.ended).toBe(true);
			} finally {
				restoreAudio();
			}
		});
	});

	describe("repeat=one", () => {
		it("replays current track on ended (stays on same track)", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "one";
				const audioEl = getCapturedAudio();

				audioEl.dispatchEvent(new Event("ended"));

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
				audioEl.dispatchEvent(new Event("ended"));

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
			expect(player.currentIndex).toBe(2);
		});
	});

	describe("repeat=all", () => {
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

				audioEl.dispatchEvent(new Event("ended"));

				expect(player.currentIndex).toBe(0);
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("clears ended on advancement via next()", async () => {
			const player = createPlayerWithTracks();
			player.repeat = "all";
			await player.goto(2);
			await player.next();
			expect(player.ended).toBe(false);
		});
	});
});
