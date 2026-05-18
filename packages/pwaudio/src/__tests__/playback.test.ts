import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../PWAudio";
import { installAudioCapture, restoreAudio, getCapturedAudio, expectInitialState } from "./helpers";

describe("Playback", () => {
	describe("play()", () => {
		it("rejects when no track is loaded", async () => {
			const player = new PWAudio();
			await expect(player.play()).rejects.toThrow("No track loaded");
		});

		it("clears stopped state on play", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.stopped).toBe(true);

			try {
				await player.play();
			} catch {
				// Autoplay may be blocked in test env
			}
			expect(player.stopped).toBe(false);
		});

		it("clears ended state when play() is called after ended", async () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				await player.goto(1);
				expect(player.currentIndex).toBe(1);

				// Dispatch ended event on last track with repeat=off
				audioEl.dispatchEvent(new Event("ended"));
				expect(player.ended).toBe(true);

				await player.play().catch(() => {});
				expect(player.ended).toBe(false);
			} finally {
				restoreAudio();
			}
		});
	});

	describe("pause()", () => {
		it("does not change stopped state to paused in initial state", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.pause();
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
		});

		it("sets paused=true when user-paused", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			await player.play().catch(() => {});

			player.pause();
			expect(player.paused).toBe(true);
			expect(player.stopped).toBe(false);
		});
	});

	describe("stop()", () => {
		it("sets stopped and resets currentTime", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.stopped).toBe(true);
			expect(player.currentTime).toBe(0);
		});

		it("emits a stop event with null detail", () => {
			const player = new PWAudio({ src: "test.mp3" });
			const handler = vi.fn();
			player.on("stop", handler);

			player.stop();

			expect(handler).toHaveBeenCalledOnce();
			const event = handler.mock.calls[0][0] as CustomEvent;
			expect(event.type).toBe("stop");
			expect(event.detail).toBeNull();
		});

		it("clears ended state", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.ended).toBe(false);
		});
	});

	describe("state matrix", () => {
		it("initial state: playing=false, paused=false, stopped=true, ended=false", () => {
			const player = new PWAudio();
			expectInitialState(player);
		});

		it("initial state with src: stopped=true (not playing)", () => {
			const player = new PWAudio({ src: "test.mp3" });
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
			expect(player.ended).toBe(false);
		});

		it("after stop(): playing=false, paused=false, stopped=true", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.playing).toBe(false);
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
		});

		it("after ended on last track: stopped=false, ended=true", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({
					tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
				});
				player.repeat = "off";
				const audioEl = getCapturedAudio();

				void player.goto(1);
				audioEl.dispatchEvent(new Event("ended"));

				expect(player.ended).toBe(true);
				expect(player.stopped).toBe(false);
			} finally {
				restoreAudio();
			}
		});

		it("after pause(): paused=true, stopped=false", async () => {
			const player = new PWAudio({ src: "test.mp3" });
			await player.play().catch(() => {});
			player.pause();
			expect(player.paused).toBe(true);
			expect(player.stopped).toBe(false);
		});

		it("after stop(): paused=false, stopped=true (stopped takes precedence)", () => {
			const player = new PWAudio({ src: "test.mp3" });
			player.stop();
			expect(player.paused).toBe(false);
			expect(player.stopped).toBe(true);
		});
	});

	describe("once()+off() integration with native-proxied events", () => {
		it("off() removes once()-registered handler — native event does not call it", () => {
			installAudioCapture();
			try {
				const player = new PWAudio({ src: "test.mp3" });
				const handler = vi.fn();

				player.once("stop", handler);
				player.off("stop", handler);

				player.stop();
				expect(handler).not.toHaveBeenCalled();
			} finally {
				restoreAudio();
			}
		});
	});
});
