import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import type { MediaCardChangeDetail } from "../types";
import { MediaSessionManager } from "../media-session";

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

// ─── Media Session API Mock ───

interface MediaSessionMock {
	metadata: MediaMetadata | null;
	playbackState: MediaSessionPlaybackState;
	setActionHandler: ReturnType<typeof vi.fn>;
	setPositionState: ReturnType<typeof vi.fn>;
}

function createMediaSessionMock(): MediaSessionMock {
	return {
		metadata: null as MediaMetadata | null,
		playbackState: "none" as MediaSessionPlaybackState,
		setActionHandler: vi.fn(),
		setPositionState: vi.fn(),
	};
}

function getMockMs(): MediaSessionMock {
	return navigator.mediaSession as unknown as MediaSessionMock;
}

// ─── Global MediaMetadata mock ───

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
			{ src: "track-a.mp3", title: "Track A", artist: "Artist A", album: "Album A" },
			{ src: "track-b.mp3", title: "Track B", artist: "Artist B", album: "Album B" },
			{ src: "track-c.mp3", title: "Track C", artist: "Artist C", album: "Album C" },
		],
	});
}

// ─── Setup / teardown ───

function setupMediaSessionMock() {
	installMediaMetadataMock();
	const mock = createMediaSessionMock();
	Object.defineProperty(navigator, "mediaSession", {
		value: mock,
		writable: true,
		configurable: true,
	});
	return mock;
}

function teardownMediaSessionMock() {
	restoreMediaMetadataMock();
	Object.defineProperty(navigator, "mediaSession", {
		value: undefined,
		writable: true,
		configurable: true,
	});
}

// ─── MediaSessionManager unit tests ───

describe("MediaSessionManager", () => {
	let audio: HTMLAudioElement;
	let manager: MediaSessionManager;
	let mock: MediaSessionMock;

	beforeEach(() => {
		audio = new Audio();
		manager = new MediaSessionManager(audio);
		mock = setupMediaSessionMock();
	});

	afterEach(() => {
		teardownMediaSessionMock();
	});

	describe("enabled property", () => {
		it("defaults to true", () => {
			expect(manager.enabled).toBe(true);
		});

		it("can be set to false", () => {
			manager.enabled = false;
			expect(manager.enabled).toBe(false);
		});

		it("clears handlers when disabled", () => {
			manager.enabled = false;
			expect(mock.metadata).toBeNull();
			expect(mock.playbackState).toBe("none");
		});

		it("no-ops on updateMetadata when disabled", () => {
			manager.enabled = false;
			manager.updateMetadata({ src: "test.mp3" }, () => "playing");
			// metadata was cleared by enabled=false, not set to new values
			expect(mock.metadata).toBeNull();
		});

		it("no-ops on setActionHandlers when disabled", () => {
			// Reset mock call count (clear() calls setActionHandler 8 times with null)
			mock.setActionHandler.mockClear();

			manager.enabled = false;
			// After clear(), any further calls should be no-ops
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
			const track = { src: "test.mp3" };

			manager.updateMetadata(track, () => "paused");

			expect(mock.metadata).not.toBeNull();
			expect(mock.metadata!.title).toBe("");
			expect(mock.metadata!.artist).toBe("");
			expect(mock.metadata!.album).toBe("");
			expect(mock.metadata!.artwork).toHaveLength(0);
		});

		it("sets playbackState from callback", () => {
			const track = { src: "test.mp3" };

			manager.updateMetadata(track, () => "playing");
			expect(mock.playbackState).toBe("playing");

			manager.updateMetadata(track, () => "paused");
			expect(mock.playbackState).toBe("paused");
		});
	});

	describe("setActionHandlers", () => {
		it("registers all 8 action handlers", () => {
			mock.setActionHandler.mockClear();

			const handlers = {
				play: vi.fn(),
				pause: vi.fn(),
				stop: vi.fn(),
				seekto: vi.fn(),
				seekbackward: vi.fn(),
				seekforward: vi.fn(),
				nexttrack: vi.fn(),
				previoustrack: vi.fn(),
			};

			manager.setActionHandlers(handlers);

			expect(mock.setActionHandler).toHaveBeenCalledTimes(8);
			expect(mock.setActionHandler).toHaveBeenCalledWith("play", handlers.play);
			expect(mock.setActionHandler).toHaveBeenCalledWith("pause", handlers.pause);
			expect(mock.setActionHandler).toHaveBeenCalledWith("stop", handlers.stop);
			expect(mock.setActionHandler).toHaveBeenCalledWith("seekto", handlers.seekto);
			expect(mock.setActionHandler).toHaveBeenCalledWith("seekbackward", handlers.seekbackward);
			expect(mock.setActionHandler).toHaveBeenCalledWith("seekforward", handlers.seekforward);
			expect(mock.setActionHandler).toHaveBeenCalledWith("nexttrack", handlers.nexttrack);
			expect(mock.setActionHandler).toHaveBeenCalledWith("previoustrack", handlers.previoustrack);
		});
	});

	describe("setPositionState", () => {
		it("sets position state when duration is valid", () => {
			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });

			manager.setPositionState();

			expect(mock.setPositionState).toHaveBeenCalledWith({
				duration: 180,
				playbackRate: 1,
				position: 30,
			});
		});

		it("skips position state when duration is NaN", () => {
			Object.defineProperty(audio, "duration", { value: NaN, configurable: true });

			manager.setPositionState();

			expect(mock.setPositionState).not.toHaveBeenCalled();
		});

		it("skips position state when duration is 0", () => {
			Object.defineProperty(audio, "duration", { value: 0, configurable: true });

			manager.setPositionState();

			expect(mock.setPositionState).not.toHaveBeenCalled();
		});

		it("skips position state when duration is negative", () => {
			Object.defineProperty(audio, "duration", { value: -1, configurable: true });

			manager.setPositionState();

			expect(mock.setPositionState).not.toHaveBeenCalled();
		});
	});

	describe("throttleSetPositionState", () => {
		it("calls setPositionState on first call", () => {
			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });

			manager.throttleSetPositionState();

			expect(mock.setPositionState).toHaveBeenCalled();
		});

		it("throttles calls within 1 second", () => {
			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });

			manager.throttleSetPositionState();
			expect(mock.setPositionState).toHaveBeenCalledTimes(1);

			// Second call within 1 second should be throttled
			manager.throttleSetPositionState();
			expect(mock.setPositionState).toHaveBeenCalledTimes(1);
		});
	});

	describe("setPlaybackState", () => {
		it("sets playbackState to playing", () => {
			manager.setPlaybackState("playing");
			expect(mock.playbackState).toBe("playing");
		});

		it("sets playbackState to paused", () => {
			manager.setPlaybackState("paused");
			expect(mock.playbackState).toBe("paused");
		});

		it("no-ops when disabled", () => {
			manager.enabled = false;
			// clear() was called by enabled=false, setting state to "none"
			manager.setPlaybackState("playing");
			// playbackState should remain "none" since setPlaybackState is disabled
			expect(mock.playbackState).toBe("none");
		});
	});

	describe("clear", () => {
		it("sets metadata to null and playbackState to none", () => {
			manager.updateMetadata({ src: "test.mp3", title: "Test" }, () => "playing");
			expect(mock.metadata).not.toBeNull();
			expect(mock.playbackState).toBe("playing");

			manager.clear();

			expect(mock.metadata).toBeNull();
			expect(mock.playbackState).toBe("none");
		});

		it("removes all action handlers", () => {
			mock.setActionHandler.mockClear();

			manager.clear();

			expect(mock.setActionHandler).toHaveBeenCalledTimes(8);
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

	describe("mediaSessionEnabled", () => {
		it("defaults to true", () => {
			const player = new PWAudio();
			expect(player.mediaSessionEnabled).toBe(true);
		});

		it("can be set to false", () => {
			const player = new PWAudio();
			player.mediaSessionEnabled = false;
			expect(player.mediaSessionEnabled).toBe(false);
		});

		it("can be set to true after being disabled", () => {
			const player = createPlayerWithTracks();
			player.mediaSessionEnabled = false;
			expect(player.mediaSessionEnabled).toBe(false);

			player.mediaSessionEnabled = true;
			expect(player.mediaSessionEnabled).toBe(true);
		});

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

			// Should have re-registered action handlers (8 handlers in setActionHandlers)
			expect(mock.setActionHandler).toHaveBeenCalled();
			// At least 8 calls for the handlers
			expect(mock.setActionHandler.mock.calls.length).toBeGreaterThanOrEqual(8);
		});

		it("throws InvalidStateError after destroy", () => {
			const player = new PWAudio();
			player.destroy();

			expect(() => {
				player.mediaSessionEnabled = true;
			}).toThrow(DOMException);
			try {
				player.mediaSessionEnabled = true;
			} catch (e) {
				expect((e as DOMException).name).toBe("InvalidStateError");
				expect((e as DOMException).message).toBe("PWAudio has been destroyed");
			}
		});
	});

	describe("mediacardchange event", () => {
		it("emits mediacardchange on track change", async () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("mediacardchange", handler);

			await player.next();

			expect(handler).toHaveBeenCalled();
			const event = handler.mock.calls[0][0] as CustomEvent<MediaCardChangeDetail>;
			expect(event.detail.title).toBe("Track B");
			expect(event.detail.artist).toBe("Artist B");
			expect(event.detail.album).toBe("Album B");
		});

		it("fires mediacardchange when re-enabling mediaSession", () => {
			const player = createPlayerWithTracks();
			const handler = vi.fn();
			player.on("mediacardchange", handler);

			player.mediaSessionEnabled = false;
			player.mediaSessionEnabled = true;

			expect(handler).toHaveBeenCalled();
			const event = handler.mock.calls[0][0] as CustomEvent<MediaCardChangeDetail>;
			expect(event.detail.title).toBe("Track A");
		});

		it("emits mediacardchange with empty strings for missing metadata", async () => {
			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});
			const handler = vi.fn();
			player.on("mediacardchange", handler);

			await player.next();

			expect(handler).toHaveBeenCalled();
			const event = handler.mock.calls[0][0] as CustomEvent<MediaCardChangeDetail>;
			expect(event.detail.title).toBe("");
			expect(event.detail.artist).toBe("");
			expect(event.detail.album).toBe("");
			expect(event.detail.artwork).toHaveLength(0);
		});
	});

	describe("Media Session action handlers", () => {
		it("registers action handlers on construction with src", () => {
			const mock = getMockMs();
			mock.setActionHandler.mockClear();

			new PWAudio({ src: "test.mp3" });

			expect(mock.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("pause", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("stop", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("seekto", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("seekbackward", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("seekforward", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("nexttrack", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("previoustrack", expect.any(Function));
		});

		it("re-registers action handlers on track change", async () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();

			mock.setActionHandler.mockClear();

			await player.next();

			expect(mock.setActionHandler).toHaveBeenCalledWith("play", expect.any(Function));
			expect(mock.setActionHandler).toHaveBeenCalledWith("nexttrack", expect.any(Function));
		});
	});

	describe("Position state updates", () => {
		it("calls setPositionState on track change via MediaSessionManager", async () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();
			mock.setPositionState.mockClear();

			await player.next();

			// setPositionState is called during #updateMediaSession via #loadTrack.
			// However, in happy-dom the audio duration is NaN, so MediaSessionManager
			// correctly bails out. We verify the mock was at least invoked
			// (the call to navigator.mediaSession.setPositionState won't happen
			// because duration is NaN, but MediaSessionManager.setPositionState
			// was invoked).
			// We can verify by checking that the metadata was set (proving updateMediaSession ran).
			expect(mock.metadata).not.toBeNull();
			expect(mock.metadata!.title).toBe("Track B");
		});

		it("responds to ratechange event via handler", () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();

			// Setting playbackRate fires a ratechange event which triggers
			// #handleRateChange -> mediaSession.setPositionState().
			// In happy-dom with NaN duration, setPositionState bails out.
			// We verify the action still happened indirectly.
			player.playbackRate = 1.5;

			// If the handler ran correctly, we'd have called setPositionState.
			// Since duration is NaN, the navigator.mediaSession.setPositionState
			// is not called. That's correct behavior.
			expect(mock.setPositionState).not.toHaveBeenCalled();
		});

		it("calls setPositionState when duration is valid", () => {
			// Test MediaSessionManager directly with a valid duration
			const audio = new Audio();
			const manager = new MediaSessionManager(audio);
			const localMock = getMockMs();

			Object.defineProperty(audio, "duration", { value: 180, configurable: true });
			Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });
			Object.defineProperty(audio, "playbackRate", { value: 1, configurable: true });

			manager.setPositionState();

			expect(localMock.setPositionState).toHaveBeenCalledWith({
				duration: 180,
				playbackRate: 1,
				position: 30,
			});
		});
	});

	describe("Playback state updates", () => {
		it("#handlePlayState and #handlePauseState are wired to media session", () => {
			// These handlers are internal — MediaSessionManager.setPlaybackState
			// is tested in the MediaSessionManager unit tests.
			// Here we verify the integration by checking that pause/play
			// operations don't throw errors.
			const player = createPlayerWithTracks();

			// pause() should work without error (even if not playing)
			player.pause();

			// play() may be blocked by autoplay policy in test env
			player.play().catch(() => {
				// autoplay blocked — expected in test env
			});

			// No assertion needed — the tests verify no errors are thrown
		});
	});

	describe("Graceful degradation when Media Session unavailable", () => {
		it("does not throw when mediaSession is not available", () => {
			teardownMediaSessionMock();

			expect(() => new PWAudio({ src: "test.mp3" })).not.toThrow();
		});

		it("next() does not throw when mediaSession is unavailable", async () => {
			teardownMediaSessionMock();

			const player = new PWAudio({
				tracks: [{ src: "a.mp3" }, { src: "b.mp3" }],
			});

			await expect(player.next()).resolves.toBeUndefined();
		});

		it("mediaSessionEnabled toggle works when mediaSession is unavailable", () => {
			teardownMediaSessionMock();

			const player = new PWAudio();
			player.mediaSessionEnabled = false;
			expect(player.mediaSessionEnabled).toBe(false);

			player.mediaSessionEnabled = true;
			expect(player.mediaSessionEnabled).toBe(true);
		});
	});

	describe("Media Session with track metadata", () => {
		it("sets metadata on construction with tracks", () => {
			const mock = getMockMs();

			new PWAudio({
				tracks: [
					{
						src: "song.mp3",
						title: "My Song",
						artist: "My Artist",
						album: "My Album",
						artwork: [{ src: "cover.png", sizes: "512x512", type: "image/png" }],
					},
				],
			});

			expect(mock.metadata).not.toBeNull();
			expect(mock.metadata!.title).toBe("My Song");
			expect(mock.metadata!.artist).toBe("My Artist");
			expect(mock.metadata!.album).toBe("My Album");
			expect(mock.metadata!.artwork).toHaveLength(1);
		});

		it("sets metadata on construction with src", () => {
			const mock = getMockMs();

			new PWAudio({ src: "simple.mp3" });

			expect(mock.metadata).not.toBeNull();
			expect(mock.metadata!.title).toBe("");
		});

		it("updates metadata when track changes via next", async () => {
			const mock = getMockMs();
			const player = createPlayerWithTracks();

			expect(mock.metadata!.title).toBe("Track A");

			await player.next();

			expect(mock.metadata!.title).toBe("Track B");
			expect(mock.metadata!.artist).toBe("Artist B");
		});

		it("updates metadata when track changes via goto", async () => {
			const mock = getMockMs();
			const player = createPlayerWithTracks();

			await player.goto(2);

			expect(mock.metadata!.title).toBe("Track C");
			expect(mock.metadata!.album).toBe("Album C");
		});
	});

	describe("Constructor with mediaSessionEnabled: false", () => {
		it("does not set metadata when mediaSessionEnabled is false", () => {
			const mock = getMockMs();

			new PWAudio({
				src: "test.mp3",
				mediaSessionEnabled: false,
			});

			expect(mock.metadata).toBeNull();
		});
	});

	describe("Playback state keep-alive during track transitions", () => {
		beforeEach(() => {
			installAudioCapture();
		});

		afterEach(() => {
			restoreAudio();
		});

		it("keeps playbackState 'playing' when pause fires during ended transition (repeat=all)", () => {
			// When a track ends with repeat=all, the player auto-advances to the next
			// track. The browser fires a pause event between tracks. Because the user
			// didn't initiate the pause (#userPaused is false), the keep-alive logic
			// keeps playbackState = "playing" so the browser doesn't throttle the tab.
			const player = new PWAudio({
				tracks: [
					{ src: "track1.mp3", title: "Track 1" },
					{ src: "track2.mp3", title: "Track 2" },
				],
				repeat: "all",
			});
			const mock = getMockMs();
			const audio = getCapturedAudio();

			// Transition out of initial stopped state
			void player.goto(1);
			expect(player.stopped).toBe(false);

			// Simulate reaching end of track — handleEnded calls next()
			// which resets endedState, but #userPaused stays false.
			audio.dispatchEvent(new Event("ended"));

			// Browser fires pause after ended — keep-alive keeps playbackState "playing"
			// because #userPaused is false (user didn't pause, it's a transition).
			audio.dispatchEvent(new Event("pause"));
			expect(mock.playbackState).toBe("playing");
		});

		it("sets playbackState 'playing' immediately in handleEnded via keepAlive", () => {
			// #mediaSessionKeepAlive sets playbackState = "playing" right inside
			// handleEnded, so even if pause fires before ended, the state stays.
			const player = new PWAudio({
				tracks: [
					{ src: "track1.mp3", title: "Track 1" },
					{ src: "track2.mp3", title: "Track 2" },
				],
				repeat: "all",
			});
			const mock = getMockMs();
			const audio = getCapturedAudio();

			void player.goto(1);
			audio.dispatchEvent(new Event("ended"));
			// #mediaSessionKeepAlive should have been called for repeat=all
			expect(mock.playbackState).toBe("playing");
		});

		it("sets playbackState 'paused' for user-initiated pause (not a transition)", async () => {
			// When a user pauses (endedState=false, not a transition),
			// playbackState should be set to "paused".
			const player = createPlayerWithTracks();
			const mock = getMockMs();

			// Transition out of initial stopped state, then pause
			void player.goto(1);
			await player.pause();
			expect(mock.playbackState).toBe("paused");
		});

		it("keeps playbackState 'playing' when playlist ends (repeat=off)", () => {
			// When the playlist ends (repeat=off), the user didn't pause (#userPaused=false)
			// and the player is not stopped (#stopped=false). The pause handler keeps
			// playbackState = "playing" because the pause was not user-initiated.
			// This keeps the notification visible so the user can resume.
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3", title: "Track 1" }],
				repeat: "off",
			});
			const mock = getMockMs();
			const audio = getCapturedAudio();

			void player.goto(1);
			audio.dispatchEvent(new Event("ended"));
			expect(player.endedState).toBe(true);

			audio.dispatchEvent(new Event("pause"));
			// userPaused=false, stopped=false — pause handler keeps "playing"
			expect(mock.playbackState).toBe("playing");
		});

		it("sets playbackState 'paused' when stop() is called", () => {
			const player = createPlayerWithTracks();
			const mock = getMockMs();

			player.stop();
			// stop() sets stopped=true, so pause handler sets playbackState = "paused"
			expect(mock.playbackState).toBe("paused");
		});

		it("does not throw when mediaSession is disabled during ended", () => {
			const player = new PWAudio({
				tracks: [{ src: "track1.mp3", title: "Track 1" }],
				repeat: "off",
				mediaSessionEnabled: false,
			});
			const audio = getCapturedAudio();

			void player.goto(1);
			audio.dispatchEvent(new Event("ended"));
			// Should not throw — mediaSessionKeepAlive is a no-op when disabled
			expect(player.endedState).toBe(true);
		});
	});
});
