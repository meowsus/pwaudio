import { describe, it, expect } from "vitest";
import { PWAudio } from "../PWAudio";
import { installAudioCapture, restoreAudio, getCapturedAudio } from "./helpers";

describe("Properties", () => {
	describe("volume", () => {
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
		it("can be toggled", () => {
			const player = new PWAudio();
			player.muted = true;
			expect(player.muted).toBe(true);
			player.muted = false;
			expect(player.muted).toBe(false);
		});
	});

	describe("playbackRate", () => {
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

	describe("preservesPitch", () => {
		it("defaults to true and toggles", () => {
			const player = new PWAudio();
			expect(player.preservesPitch).toBe(true);

			player.preservesPitch = false;
			expect(player.preservesPitch).toBe(false);

			player.preservesPitch = true;
			expect(player.preservesPitch).toBe(true);
		});

		it("sets both preservesPitch and webkitPreservesPitch (when available)", () => {
			const player = new PWAudio();
			player.preservesPitch = false;
			expect(player.preservesPitch).toBe(false);
		});
	});

	describe("preload", () => {
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
				expect(audioEl.preload).toBe("metadata");

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
				await player.next();
				expect(audioEl.preload).toBe("auto");
			} finally {
				restoreAudio();
			}
		});
	});

	describe("src getter", () => {
		it("returns current audio source", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.src).toContain("test.mp3");
		});
	});

	describe("duration", () => {
		it("returns NaN before metadata is loaded", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.duration).toBeNaN();
		});
	});

	describe("buffered", () => {
		it("returns TimeRanges from audio element", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.buffered).toBeDefined();
		});
	});

	describe("seeking", () => {
		it("returns false when not seeking", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.seeking).toBe(false);
		});
	});
});
