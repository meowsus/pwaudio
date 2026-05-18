import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import type { MediaCardChangeDetail } from "../types";
import { MediaSessionManager } from "../media-session";
import { createPlayerWithTracks, getMockMs, setupMediaSessionMock, teardownMediaSessionMock, installAudioCapture, getCapturedAudio } from "./helpers";

describe("MediaSessionManager", () => {
	let audio: HTMLAudioElement;
	let manager: MediaSessionManager;
	let mock: ReturnType<typeof setupMediaSessionMock>;

	beforeEach(() => {
		audio = new Audio();
		manager = new MediaSessionManager(audio);
		mock = setupMediaSessionMock();
	});

	afterEach(() => {
		teardownMediaSessionMock();
	});

	describe("enabled property", () => {
		it("clears handlers when disabled", () => {
			manager.enabled = false;
			expect(mock.metadata).toBeNull();
			expect(mock.playbackState).toBe("none");
		});

		it("no-ops on updateMetadata when disabled", () => {
			manager.enabled = false;
			manager.updateMetadata({ src: "test.mp3" }, () => "playing");
			expect(mock.metadata).toBeNull();
		});

		it("no-ops on setActionHandlers when disabled", () => {
			mock.setActionHandler.mockClear();
			manager.enabled = false;
			mock.setActionHandler.mockClear();

			manager.setActionHandlers({
				play: vi.fn(),
				pause: vi.fn(),
				stop: vi.fn(),
				seekto: vi.fn(),
				seekbackward: vi.fn(),
				seekforward: vi.fn(),
				nexttrack: vi.fn(),
				previoustrack: vi.fn(),
			});
			expect(mock.setActionHandler).not.toHaveBeenCalled();
		});

		it("no-ops on setPositionState when disabled", () => {
			manager.enabled = false;
			manager.setPositionState();
			expect(mock.setPositionState).not.toHaveBeenCalled();
		});
	});

	describe("isAvailable", () => {
		it("returns true when navigator.mediaSession exists", () => {
			expect(manager.isAvailable).toBe(true);
		});

		it("returns false when navigator.mediaSession is undefined", () => {
			teardownMediaSessionMock();
			expect(manager.isAvailable).toBe(false);
		});
	});

	describe("updateMetadata", () => {
		it("sets MediaMetadata with track info", () => {
			const track = {
				src: "test.mp3",
				title: "Test Track",
				artist: "Test Artist",
				album: "Test Album",
				artwork: [{ src: "art.png", sizes: "96x96", type: "image/png" }],
			};
			manager.updateMetadata(track, () => "playing");
			expect(mock.metadata).not.toBeNull();
			expect(mock.metadata!.title).toBe("Test Track");
			expect(mock.metadata!.artist).toBe("Test Artist");
			expect(mock.metadata!.album).toBe("Test Album");
			expect(mock.metadata!.artwork).toHaveLength(1);
		});

		it("uses empty strings for missing metadata", () => {
			manager.updateMetadata({ src: "test.mp3" }, () => "paused");
			expect(mock.metadata!.title).toBe("");
			expect(mock.metadata!.artist).toBe("");
			expect(mock.metadata!.album).toBe("");
			expect(mock.metadata!.artwork).toHaveLength(0);
		});
	});

	describe("setActionHandlers", () => {
		it("registers all 8 action handlers", () => {
			mock.setActionHandler.mockClear();
			const handlers = {
				play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekto: vi.fn(),
				seekbackward: vi.fn(), seekforward: vi.fn(), nexttrack: vi.fn(), previoustrack: vi.fn(),
			};
			manager.setActionHandlers(handlers);
			expect(mock.setActionHandler).toHaveBeenCalledTimes(8);
		});
	});

	describe("setPositionState", () => {
		it("sets position state when duration is valid", () => {
			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });
			manager.setPositionState();
			expect(mock.setPositionState).toHaveBeenCalledWith({
				duration: 180, playbackRate: 1, position: 30,
			});
		});

		it("skips position state when duration is NaN", () => {
			Object.defineProperty(audio, "duration", { value: NaN, configurable: true });
			manager.setPositionState();
			expect(mock.setPositionState).not.toHaveBeenCalled();
		});
	});

	describe("throttleSetPositionState", () => {
		it("throttles calls within 1 second", () => {
			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });

			manager.throttleSetPositionState();
			expect(mock.setPositionState).toHaveBeenCalledTimes(1);
			manager.throttleSetPositionState();
			expect(mock.setPositionState).toHaveBeenCalledTimes(1);
		});
	});

	describe("clear", () => {
		it("sets metadata to null and playbackState to none", () => {
			manager.updateMetadata({ src: "test.mp3", title: "Test" }, () => "playing");
			manager.clear();
			expect(mock.metadata).toBeNull();
			expect(mock.playbackState).toBe("none");
		});

		it("removes all 8 action handlers", () => {
			mock.setActionHandler.mockClear();
			manager.clear();
			expect(mock.setActionHandler).toHaveBeenCalledTimes(8);
			for (const action of ["play", "pause", "stop", "seekto", "seekbackward", "seekforward", "nexttrack", "previoustrack"]) {
				expect(mock.setActionHandler).toHaveBeenCalledWith(action, null);
			}
		});
	});
});

// ─── PWAudio Integration tests ───

describe("PWAudio Media Session Integration", () => {
	beforeEach(() => {
		setupMediaSessionMock();
	});

	afterEach(() => {
		teardownMediaSessionMock();
	});

	describe("mediaSessionEnabled toggle", () => {
		it("clears Media Session when disabled", () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();
			player.mediaSessionEnabled = false;
			expect(mock.metadata).toBeNull();
			expect(mock.playbackState).toBe("none");
		});

		it("re-registers handlers when re-enabled", () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();
			player.mediaSessionEnabled = false;
			mock.setActionHandler.mockClear();
			player.mediaSessionEnabled = true;
			expect(mock.setActionHandler).toHaveBeenCalled();
			expect(mock.setActionHandler.mock.calls.length).toBeGreaterThanOrEqual(8);
		});

		it("throws InvalidStateError after destroy", () => {
			const player = new PWAudio();
			player.destroy();
			expect(() => { player.mediaSessionEnabled = true; }).toThrow(DOMException);
		});
	});

	describe("mediacardchange event", () => {
		it("emits mediacardchange on track change", async () => {
			const player = new PWAudio({
				tracks: [
					{ src: "track-a.mp3", title: "Track A", artist: "Artist A", album: "Album A" },
					{ src: "track-b.mp3", title: "Track B", artist: "Artist B", album: "Album B" },
				],
			});
			const handler = vi.fn();
			player.on("mediacardchange", handler);
			await player.next();
			expect(handler).toHaveBeenCalled();
			const event = handler.mock.calls[0][0] as CustomEvent<MediaCardChangeDetail>;
			expect(event.detail.title).toBe("Track B");
			expect(event.detail.artist).toBe("Artist B");
		});

		it("emits mediacardchange with empty strings for missing metadata", async () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			const handler = vi.fn();
			player.on("mediacardchange", handler);
			await player.next();
			const event = handler.mock.calls[0][0] as CustomEvent<MediaCardChangeDetail>;
			expect(event.detail.title).toBe("");
			expect(event.detail.artist).toBe("");
			expect(event.detail.album).toBe("");
			expect(event.detail.artwork).toHaveLength(0);
		});

		it("fires mediacardchange when re-enabling mediaSession", () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("mediacardchange", handler);
			player.mediaSessionEnabled = false;
			player.mediaSessionEnabled = true;
			expect(handler).toHaveBeenCalled();
		});
	});

	describe("Media Session action handlers", () => {
		it("registers action handlers on construction with src", () => {
			const mock = getMockMs();
			mock.setActionHandler.mockClear();
			new PWAudio({ src: "test.mp3" });
			expect(mock.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("nexttrack", expect.any(Function));
		});

		it("re-registers action handlers on track change", async () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();
			mock.setActionHandler.mockClear();
			await player.next();
			expect(mock.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
		});
	});

	describe("Position state updates", () => {
		it("calls setPositionState when duration is valid", () => {
			const audio = new Audio();
			const manager = new MediaSessionManager(audio);
			const localMock = getMockMs();
			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });
			manager.setPositionState();
			expect(localMock.setPositionState).toHaveBeenCalledWith({
				duration: 180, playbackRate: 1, position: 30,
			});
		});
	});

	describe("Playback state keep-alive during track transitions", () => {
		it("keeps playbackState 'playing' during ended transition (repeat=all)", () => {
			installAudioCapture();
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3", title: "Track 1" }, { src: "track2.mp3", title: "Track 2" }],
				repeat: "all",
			});
			const mock = getMockMs();
			const audioEl = getCapturedAudio();

			void player.goto(1);
			audioEl.dispatchEvent(new Event("ended"));
			audioEl.dispatchEvent(new Event("pause"));
			expect(mock.playbackState).toBe("playing");
		});

		it("sets playbackState 'paused' for user-initiated pause", () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();
			void player.goto(1);
			player.pause();
			expect(mock.playbackState).toBe("paused");
		});

		it("sets playbackState 'paused' when stop() is called", () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();
			player.stop();
			expect(mock.playbackState).toBe("paused");
		});
	});

	describe("Graceful degradation when Media Session unavailable", () => {
		it("does not throw when mediaSession is not available", () => {
			teardownMediaSessionMock();
			expect(() => new PWAudio({ src: "test.mp3" })).not.toThrow();
		});

		it("next() does not throw when mediaSession is unavailable", async () => {
			teardownMediaSessionMock();
			const player = new PWAudio({ tracks: [{ src: "a.mp3" }, { src: "b.mp3" }] });
			await expect(player.next()).resolves.toBeUndefined();
		});

		it("mediaSessionEnabled toggle works when unavailable", () => {
			teardownMediaSessionMock();
			const player = new PWAudio();
			player.mediaSessionEnabled = false;
			expect(player.mediaSessionEnabled).toBe(false);
			player.mediaSessionEnabled = true;
			expect(player.mediaSessionEnabled).toBe(true);
		});
	});
});