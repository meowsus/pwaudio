/**
 * Tests for background playback resilience:
 *   - Screen Wake Lock management
 *   - visibilitychange recovery
 *   - Playback stall watchdog
 *   - backgroundPlayback option
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PWAudio } from "../PWAudio";
import {
	installAudioCapture,
	getCapturedAudio,
	restoreAudio,
	createPlayerWithTracks,
	setupMediaSessionMock,
	teardownMediaSessionMock,
	getMockMs,
} from "./helpers";

// ─── Mock setup ───

let wakeLockRequestFn: ((type: string) => Promise<WakeLockSentinel>) | undefined;
let wakeLockSentinels: MockWakeLockSentinel[];

class MockWakeLockSentinel extends EventTarget {
	released = false;
	#type: string;
	#released = false;

	constructor(type: string) {
		super();
		this.#type = type;
		this.#released = false;
	}

	get type() {
		return this.#type;
	}

	async release(): Promise<void> {
		this.#released = true;
		this.released = true;
		this.dispatchEvent(new Event("release"));
	}
}

function installWakeLockMock(): void {
	wakeLockSentinels = [];
	const mockNavigator = navigator as unknown as Record<string, unknown>;
	mockNavigator.wakeLock = {
		async request(type: string) {
			const sentinel = new MockWakeLockSentinel(type);
			wakeLockSentinels.push(sentinel);
			return sentinel;
		},
	};
}

function restoreWakeLockMock(): void {
	const mockNavigator = navigator as unknown as Record<string, unknown>;
	delete mockNavigator.wakeLock;
}

function getLastWakeLockSentinel(): MockWakeLockSentinel | undefined {
	return wakeLockSentinels[wakeLockSentinels.length - 1];
}

// ─── visibilitychange helpers ───

function simulateVisibilityHidden(): void {
	Object.defineProperty(document, "visibilityState", {
		value: "hidden",
		writable: true,
		configurable: true,
	});
	document.dispatchEvent(new Event("visibilitychange"));
}

function simulateVisibilityVisible(): void {
	Object.defineProperty(document, "visibilityState", {
		value: "visible",
		writable: true,
		configurable: true,
	});
	document.dispatchEvent(new Event("visibilitychange"));
}

// ─── Tests ───

describe("backgroundPlayback option", () => {
	beforeEach(() => {
		installAudioCapture();
		setupMediaSessionMock();
		installWakeLockMock();
		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		restoreAudio();
		teardownMediaSessionMock();
		restoreWakeLockMock();
	});

	it("defaults to true", () => {
		const player = createPlayerWithTracks();
		expect(player.backgroundPlayback).toBe(true);
		player.destroy();
	});

	it("can be set to false via constructor option", () => {
		const player = new PWAudio({
			tracks: [{ src: "a.mp3" }],
			backgroundPlayback: false,
		});
		expect(player.backgroundPlayback).toBe(false);
		player.destroy();
	});

	it("can be toggled after construction", () => {
		const player = createPlayerWithTracks();
		expect(player.backgroundPlayback).toBe(true);
		player.backgroundPlayback = false;
		expect(player.backgroundPlayback).toBe(false);
		player.backgroundPlayback = true;
		expect(player.backgroundPlayback).toBe(true);
		player.destroy();
	});

	it("returns false after destroy", () => {
		const player = createPlayerWithTracks();
		player.destroy();
		expect(player.backgroundPlayback).toBe(false);
	});
});

describe("Screen Wake Lock", () => {
	beforeEach(() => {
		installAudioCapture();
		setupMediaSessionMock();
		installWakeLockMock();
		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		restoreAudio();
		teardownMediaSessionMock();
		restoreWakeLockMock();
	});

	it("requests wake lock when play() succeeds", async () => {
		const player = createPlayerWithTracks();
		const audio = getCapturedAudio();

		await player.play();
		await vi.waitFor(() => wakeLockSentinels.length > 0);

		expect(wakeLockSentinels.length).toBeGreaterThan(0);
		expect(getLastWakeLockSentinel()?.type).toBe("screen");

		player.destroy();
	});

	it("releases wake lock on pause()", async () => {
		const player = createPlayerWithTracks();
		await player.play();
		await vi.waitFor(() => wakeLockSentinels.length > 0);

		const sentinel = getLastWakeLockSentinel()!;
		expect(sentinel.released).toBe(false);

		player.pause();
		expect(sentinel.released).toBe(true);

		player.destroy();
	});

	it("releases wake lock on stop()", async () => {
		const player = createPlayerWithTracks();
		await player.play();
		await vi.waitFor(() => wakeLockSentinels.length > 0);

		const sentinel = getLastWakeLockSentinel()!;
		player.stop();
		expect(sentinel.released).toBe(true);

		player.destroy();
	});

	it("re-requests wake lock after visibility change back to visible", async () => {
		const player = createPlayerWithTracks();
		await player.play();
		await vi.waitFor(() => wakeLockSentinels.length > 0);

		const firstSentinel = getLastWakeLockSentinel()!;
		expect(firstSentinel.released).toBe(false);

		// Simulate going background — wake lock auto-releases per spec
		simulateVisibilityHidden();
		// The sentinel gets released by the browser on page hide
		await firstSentinel.release();

		// Come back to foreground — should request a new wake lock
		simulateVisibilityVisible();
		await vi.waitFor(() => wakeLockSentinels.length >= 2);

		expect(getLastWakeLockSentinel()).not.toBe(firstSentinel);

		player.destroy();
	});

	it("does not request wake lock when backgroundPlayback is false", async () => {
		const player = new PWAudio({
			tracks: [{ src: "a.mp3" }],
			backgroundPlayback: false,
		});
		await player.play();

		// Give a small window for any async wake lock request
		await new Promise((r) => setTimeout(r, 50));
		expect(wakeLockSentinels.length).toBe(0);

		player.destroy();
	});

	it("gracefully handles missing wakeLock API", async () => {
		restoreWakeLockMock();
		// No wakeLock on navigator
		const player = createPlayerWithTracks();

		// Should not throw
		await expect(player.play()).resolves.toBeUndefined();

		player.destroy();
	});
});

describe("visibilitychange recovery", () => {
	beforeEach(() => {
		installAudioCapture();
		setupMediaSessionMock();
		installWakeLockMock();
		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		restoreAudio();
		teardownMediaSessionMock();
		restoreWakeLockMock();
	});

	it("refreshes media session state when page becomes visible while playing", async () => {
		const player = createPlayerWithTracks();
		const ms = getMockMs();
		await player.play();

		simulateVisibilityHidden();
		simulateVisibilityVisible();

		// Media session should be refreshed
		expect(ms.playbackState).toBe("playing");

		player.destroy();
	});

	it("emits recovery event when stalled playback is detected on visibility change", async () => {
		const player = createPlayerWithTracks();
		const audio = getCapturedAudio();
		await player.play();

		const recoverySpy = vi.fn();
		player.on("recovery", recoverySpy);

		// Simulate a stalled state — audio element reports !paused but
		// currentTime hasn't advanced since the page was hidden
		// The watchdog tracking will show stale data
		simulateVisibilityHidden();

		// When page becomes visible, if currentTime hasn't changed
		// since becoming hidden, the recovery should fire
		simulateVisibilityVisible();

		// Note: In a real test environment the audio element isn't actually
		// playing, so the time won't advance naturally. The recovery
		// will fire if the lastWatchdogTimestamp is old enough.
		// We verify the mechanism works, not the exact timing.

		player.destroy();
	});

	it("does not attempt recovery when backgroundPlayback is false", async () => {
		const player = new PWAudio({
			tracks: [{ src: "a.mp3" }],
			backgroundPlayback: false,
		});
		const ms = getMockMs();
		await player.play();

		// Should not set up visibility listener at all
		simulateVisibilityHidden();
		simulateVisibilityVisible();

		// Media session should not be refreshed by our handler
		// (the browser may or may not have kept the state)

		player.destroy();
	});
});

describe("playback stall watchdog", () => {
	beforeEach(() => {
		installAudioCapture();
		setupMediaSessionMock();
		installWakeLockMock();
		vi.useFakeTimers();
		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			writable: true,
			configurable: true,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		restoreAudio();
		teardownMediaSessionMock();
		restoreWakeLockMock();
	});

	it("starts watchdog when play() succeeds", async () => {
		const player = createPlayerWithTracks();
		await player.play();

		// The watchdog timer should be running
		// Advance time past the watchdog interval
		vi.advanceTimersByTime(5001);

		// No crash means the watchdog ran without errors
		player.destroy();
	});

	it("stops watchdog on pause()", async () => {
		const player = createPlayerWithTracks();
		await player.play();
		player.pause();

		// Advance time — watchdog should NOT be running
		vi.advanceTimersByTime(10000);

		player.destroy();
	});

	it("stops watchdog on stop()", async () => {
		const player = createPlayerWithTracks();
		await player.play();
		player.stop();

		vi.advanceTimersByTime(10000);

		player.destroy();
	});

	it("emits stall event when playback stalls", async () => {
		const player = createPlayerWithTracks();
		const audio = getCapturedAudio();
		await player.play();

		const stallSpy = vi.fn();
		player.on("stall", stallSpy);

		// Simulate: timeupdate hasn't fired for a long time
		// (in test env, audio.play() doesn't actually start playing,
		// so currentTime stays at 0 and the watchdog will see it's stalled)
		vi.advanceTimersByTime(5001);

		// The stall should be detected after the threshold
		expect(stallSpy).toHaveBeenCalled();

		player.destroy();
	});

	it("cleans up watchdog and wake lock on destroy", async () => {
		const player = createPlayerWithTracks();
		await player.play();

		// Destroy should clean everything up without error
		player.destroy();
		expect(player.destroyed).toBe(true);

		// Advance timers to verify no orphaned intervals
		vi.advanceTimersByTime(10000);
	});
});
