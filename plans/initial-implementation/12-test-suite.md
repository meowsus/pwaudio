# Plan 12: Test Suite

## Objective

Create a comprehensive test suite covering all PWAudio functionality. Tests use `vitest` with `happy-dom` environment. The existing stub test file (`packages/pwaudio/src/index.test.ts`) should be replaced with a full test suite organized by feature area.

## Test Files to Create

All test files go under `packages/pwaudio/src/__tests__/`.

### Files

```
packages/pwaudio/src/__tests__/
├── PWAudio.test.ts          # Constructor, basic playback, properties
├── playlist.test.ts         # tracks, currentIndex, next, prev, goto
├── shuffle.test.ts          # Fisher-Yates, shuffle history, toggle
├── repeat.test.ts           # Repeat modes (off, one, all)
├── events.test.ts           # Event system (on/off/once, proxy, synthetic)
├── media-session.test.ts    # Media Session (mocked navigator.mediaSession)
├── concurrency.test.ts      # Play-generation guard, rapid next/goto
├── error-recovery.test.ts   # trackerror, empty-playlist rejection, autoplay
├── destroy.test.ts          # destroy() lifecycle, post-destroy throws
└── edge-cases.test.ts       # preservesPitch, clamping, preload, state matrix
```

## Testing Strategy

### HTMLAudioElement Mocking

Since `happy-dom` provides a minimal `HTMLAudioElement`, many methods (`play`, `pause`, `load`, etc.) are stubs. For tests that need to verify audio element interactions, mock the `Audio` constructor:

```ts
// In a test file:
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockPause = vi.fn();
const mockLoad = vi.fn();

vi.stubGlobal("Audio", () => ({
	play: mockPlay,
	pause: mockPause,
	load: mockLoad,
	// ... other needed properties
}));
```

However, prefer testing at the `PWAudio` API level rather than mocking internals. Use `happy-dom`'s `Audio` element where possible — it supports most basic operations.

### Media Session Mocking

`navigator.mediaSession` is not available in `happy-dom`. Mock it:

```ts
beforeEach(() => {
	const mockSetActionHandler = vi.fn();
	const mockSetPositionState = vi.fn();
	Object.defineProperty(navigator, "mediaSession", {
		value: {
			metadata: null,
			playbackState: "none",
			setActionHandler: mockSetActionHandler,
			setPositionState: mockSetPositionState,
		},
		writable: true,
		configurable: true,
	});
});
```

### Native Event Simulation

To test proxied events, dispatch events on the internal `HTMLAudioElement`:

```ts
// Access the internal audio element via src (or expose for testing)
const audio = player.audio; // If exposed, or use another method
audio.dispatchEvent(new Event("play"));
```

Since the `#audio` element is private, tests should verify behavior through the public API and event handlers rather than reaching into internals. To dispatch native events, create a standalone `Audio` element, attach it to the `document`, and let `happy-dom` handle event dispatch.

## Test Coverage by File

### `PWAudio.test.ts` — Core playback & properties

```ts
describe("PWAudio", () => {
	describe("constructor", () => {
		it("creates instance with no options");
		it("creates instance with src option");
		it("creates instance with tracks option");
		it("tracks option takes precedence over src");
		it("applies volume option");
		it("applies playbackRate option");
		it("applies repeat option");
		it("applies shuffle option");
		it("applies preload option");
		it("applies mediaSessionEnabled option");
		it("applies previousRestartThreshold option");
		it("defaults all options correctly");
	});

	describe("play", () => {
		it("starts playback and returns resolved promise");
		it("rejects with error on empty playlist");
		it("restarts track if called after ended state");
		it("clears endedState on play");
		it("clears stopped state on play");
	});

	describe("pause", () => {
		it("pauses playback");
		it("sets paused to true");
	});

	describe("stop", () => {
		it("pauses and seeks to 0");
		it("emits stop synthetic event");
		it("sets stopped to true");
		it("clears endedState");
	});

	describe("playing getter", () => {
		it("returns true when playing");
		it("returns false when paused");
		it("returns false when stopped");
	});

	describe("paused getter", () => {
		it("state matrix: false when playing");
		it("state matrix: true when user-paused");
		it("state matrix: false when stopped");
		it("state matrix: false when ended");
	});

	describe("stopped getter", () => {
		it("returns true initially");
		it("returns true after stop()");
		it("returns false after play()");
	});

	describe("endedState getter", () => {
		it("returns true after track ends naturally (repeat=off, last track)");
		it("returns false after play()");
		it("returns false after next()");
		it("returns false after stop()");
	});

	describe("volume", () => {
		it("defaults to 1");
		it("clamps to [0, 1]");
		it("clamps negative values to 0");
		it("clamps values > 1 to 1");
	});

	describe("muted", () => {
		it("defaults to false");
		it("toggles correctly");
	});

	describe("playbackRate", () => {
		it("defaults to 1");
		it("clamps to [0.25, 4.0]");
		it("clamps sub-0.25 to 0.25");
		it("clamps values > 4.0 to 4.0");
	});

	describe("src", () => {
		it("returns current audio source");
		it("setter replaces entire playlist");
		it("setter emits playlistchange event");
		it("setter emits trackchange event");
	});

	describe("currentTime / duration / buffered / seeking", () => {
		it("currentTime defaults to 0");
		it("currentTime setter seeks to position");
		it("duration returns NaN before loaded metadata");
		it("seeking returns false when not seeking");
	});
});
```

### `playlist.test.ts` — Playlist management

```ts
describe("Playlist", () => {
	describe("tracks getter/setter", () => {
		it("returns empty array initially");
		it("sets tracks");
		it("preserves current track position when src exists in new list");
		it("resets currentIndex to 0 when current track not in new list");
		it("emits playlistchange event");
		it("emits trackchange if index changes");
	});

	describe("currentIndex", () => {
		it("returns -1 for empty playlist");
		it("returns 0 for single-track playlist");
		it("returns current index after next()");
	});

	describe("currentTrack", () => {
		it("returns null for empty playlist");
		it("returns current track object");
	});

	describe("next()", () => {
		it("advances to next track");
		it("wraps to first track with repeat=all");
		it("stops at last track with repeat=off");
		it("is a no-op on empty playlist");
		it("emits trackchange event");
		it("begins playback of new track");
	});

	describe("previous()", () => {
		it("restarts current track when currentTime > threshold");
		it("goes to previous track when currentTime <= threshold");
		it("wraps to last track with repeat=all");
		it("stays at first track with repeat=off");
		it("is a no-op on empty playlist");
	});

	describe("goto()", () => {
		it("jumps to specified index");
		it("clamps negative indices to 0");
		it("clamps excessive indices to last track");
		it("is a no-op on empty playlist");
		it("restarts and plays from beginning if same index");
	});
});
```

### `shuffle.test.ts` — Shuffle behavior

```ts
describe("Shuffle", () => {
	describe("ShuffleManager", () => {
		it("generates a permutation containing all indices exactly once");
		it("places current track at position 0");
		it("handles single-track playlist");
		it("handles empty playlist");
	});

	describe("shuffle toggle", () => {
		it("enabling shuffle generates order with current track at position 0");
		it("disabling shuffle preserves current track position");
		it("enabling shuffle when already on is a no-op");
	});

	describe("next() with shuffle", () => {
		it("follows shuffle order");
		it("wraps and regenerates with repeat=all");
		it("does nothing at end with repeat=off");
	});

	describe("previous() with shuffle", () => {
		it("retreats through shuffle history");
		it("restarts current track when history is empty");
	});

	describe("playlist replacement while shuffle on", () => {
		it("regenerates shuffle order");
		it("places current track at position 0 if it exists in new list");
		it("resets to index 0 if current track not in new list");
	});

	describe("goto() with shuffle", () => {
		it("pushes target index onto shuffle history");
	});
});
```

### `repeat.test.ts` — Repeat modes

```ts
describe("Repeat", () => {
	describe("repeat=off", () => {
		it("stops at last track on ended");
		it("enters endedState on last track");
	});

	describe("repeat=one", () => {
		it("replays current track on ended");
		it("clears endedState and plays again");
	});

	describe("repeat=all", () => {
		it("wraps to first track on ended");
		it("loops single track indefinitely (equivalent to repeat=one)");
	});
});
```

### `events.test.ts` — Event system

```ts
describe("Events", () => {
	describe("on/off/once", () => {
		it("subscribes to events with on()");
		it("removes handler with off()");
		it("auto-removes after first call with once()");
		it("supports multiple handlers for same event");
		it("off() with unregistered handler is a no-op");
	});

	describe("native event proxying", () => {
		it("proxies play event as CustomEvent<NativeEventDetail>");
		it("proxies pause event");
		it("proxies ended event");
		it("proxies timeupdate event");
		it("proxies all 14 events in PROXIED_NATIVE_EVENTS");
		it("does NOT proxy loadstart, emptied, stalled, etc.");
	});

	describe("synthetic events", () => {
		it("emits trackchange with TrackChangeDetail");
		it("emits playlistchange with PlaylistChangeDetail");
		it("emits trackerror with TrackErrorDetail");
		it("emits stop event (no detail)");
		it("emits mediacardchange with MediaCardChangeDetail");
	});

	describe("event.target", () => {
		it("CustomEvent.target is NOT the PWAudio instance (EventTarget not base class)");
		// Note: Since PWAudio doesn't extend EventTarget, event.target won't be PWAudio.
		// This is intentional — events are dispatched via EventManager's direct call mechanism.
	});
});
```

### `media-session.test.ts` — Media Session

```ts
describe("Media Session", () => {
	beforeEach(() => {
		// Mock navigator.mediaSession
	});

	it("sets metadata on track change");
	it("sets playback state on play/pause");
	it("registers action handlers on track change");
	it("updates position state on track change");
	it("throttles position state updates on timeupdate");
	it("updates position state on ratechange");
	it("clears metadata and handlers when disabled");
	it("re-registers when re-enabled");
	it("is a no-op when navigator.mediaSession is unavailable");
	it("uses fastSeek when available in seekto handler");
	it("emits mediacardchange event on metadata update");
});
```

### `concurrency.test.ts` — Play-generation guard

```ts
describe("Concurrency", () => {
	it("rapid next() calls — only last track plays");
	it("stale play() Promise resolves silently after next()");
	it("stale play() Promise resolves silently after destroy()");
	it("stale ended event is ignored after next()");
	it("play() rejection propagates (NotAllowedError) when not stale");
	it("stop() during pending play() — resolves silently");
	it("goto() invalidates previous play() Promise");
});
```

### `error-recovery.test.ts` — Error handling

```ts
describe("Error handling", () => {
	it("emits trackerror on audio error");
	it("trackerror detail contains error, track, and index");
	it("does not auto-skip to next track on error");
	it("play() on empty playlist rejects with 'No track loaded'");
	it("play() rejection with NotAllowedError propagates to consumer");
	it("proxies native error event AND emits trackerror");
	it("consumer can call next() in trackerror handler manually");
});
```

### `destroy.test.ts` — Lifecycle

```ts
describe("destroy()", () => {
	it("pauses playback on destroy");
	it("removes all native proxy listeners");
	it("removes all synthetic listeners");
	it("clears Media Session metadata and handlers");
	it("sets audio.src to empty string");
	it("calls audio.load() to abort network requests");
	it("removes src attribute");
	it("sets destroyed flag");

	describe("post-destroy behavior", () => {
		it("play() throws InvalidStateError");
		it("pause() throws InvalidStateError");
		it("stop() throws InvalidStateError");
		it("next() throws InvalidStateError");
		it("previous() throws InvalidStateError");
		it("goto() throws InvalidStateError");
		it("volume setter throws InvalidStateError");
		it("muted setter throws InvalidStateError");
		it("playbackRate setter throws InvalidStateError");
		it("src setter throws InvalidStateError");
		it("tracks setter throws InvalidStateError");
		it("repeat setter throws InvalidStateError");
		it("shuffle setter throws InvalidStateError");
		it("preload setter throws InvalidStateError");
		it("mediaSessionEnabled setter throws InvalidStateError");

		it("playing returns false after destroy");
		it("paused returns true after destroy");
		it("stopped returns true after destroy");
		it("currentTime returns 0 after destroy");
		it("duration returns NaN after destroy");
		it("volume returns 0 after destroy");
		it("tracks returns empty array after destroy");
		it("currentIndex returns -1 after destroy");
		it("currentTrack returns null after destroy");
	});

	it("destroy() is idempotent");
	it("in-flight play() Promise resolves silently after destroy");
});
```

### `edge-cases.test.ts` — Platform quirks & edge cases

```ts
describe("Edge cases", () => {
	describe("preservesPitch", () => {
		it("defaults to true");
		it("sets both preservesPitch and webkitPreservesPitch");
		it("getter reads from whichever property exists");
	});

	describe("preload", () => {
		it("defaults to 'metadata'");
		it("applies to HTMLAudioElement on construction");
		it("applies immediately on setter change");
		it("takes full effect on next loadTrack()");
	});

	describe("volume on mobile", () => {
		it("setter does not throw (may be ignored by OS)");
	});

	describe("state matrix", () => {
		it("initial: playing=false, paused=false, stopped=true, endedState=false");
		it("playing: playing=true, paused=false, stopped=false, endedState=false");
		it("user-paused: playing=false, paused=true, stopped=false, endedState=false");
		it("after stop(): playing=false, paused=false, stopped=true, endedState=false");
		it("after ended: playing=false, paused=false, stopped=false, endedState=true");
	});

	describe("duplicate src in playlist", () => {
		it("treats duplicate entries as distinct tracks");
		it("first occurrence wins when searching for current track");
	});

	describe("single track with repeat=all", () => {
		it("loops indefinitely (equivalent to repeat=one)");
	});

	describe("empty playlist", () => {
		it("next() resolves as no-op");
		it("previous() resolves as no-op");
		it("goto() resolves as no-op");
		it("play() rejects with 'No track loaded'");
		it("currentIndex is -1");
		it("currentTrack is null");
	});

	describe("stop() event cascade", () => {
		it("fires pause, seeking, seeked (native), then stop (synthetic)");
	});
});
```

## Deleting the Old Test

Remove `packages/pwaudio/src/index.test.ts` — it tests the old stub and is replaced by the comprehensive suite above.

## Running Tests

```bash
# Run all tests
pnpm -C packages/pwaudio test

# Run in watch mode
pnpm -C packages/pwaudio test:watch

# Run a specific test file
pnpm -C packages/pwaudio test -- src/__tests__/shuffle.test.ts
```

## Verification

1. All test files pass: `pnpm -C packages/pwaudio test`
2. Type checking passes: `pnpm -C packages/pwaudio typecheck`
3. Build succeeds: `pnpm -C packages/pwaudio build`
4. Every public method and property has at least one test.
5. Edge cases (empty playlist, destroyed state, mobile quirks) are covered.
6. Event types are verified (synthetic events carry correct detail payloads).
7. Concurrency tests verify stale Promise resolution.
8. No test reaches into private `#` fields — all testing is via the public API.
