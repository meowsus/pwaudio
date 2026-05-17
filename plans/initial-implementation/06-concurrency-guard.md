# Plan 06: Concurrency Guard

## Objective

Implement the `#playGeneration` concurrency guard to prevent race conditions when `play()`, `next()`, `goto()`, or `stop()` are called in rapid succession. This ensures that stale `play()` Promises from superseded track loads resolve silently without side effects.

## Problem Statement

`play()` is asynchronous — it returns a `Promise<void>` that resolves when the browser begins playback or rejects with `NotAllowedError`. If a user calls `next()` before a pending `play()` resolves, two problems arise:

1. The old `play()` Promise might reject after the new track has already started, incorrectly surfacing an error.
2. An `ended` event from a previous track might fire after a new track is loaded, causing a ghost advancement.

## Solution: Play-Generation Counter

Every call to `#loadTrack()` increments a `#playGeneration` counter. Before `play()` awaits the native `audio.play()`, it captures the current generation. When the Promise settles, it checks whether the generation still matches. If not (another track was loaded in the meantime), the result is discarded.

## Modifications to `packages/pwaudio/src/PWAudio.ts`

### The `#playGeneration` field already exists from Plan 03. Add the guard logic:

### Update `play()`:

```ts
async play(): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }

  if (this.#tracks.length === 0) {
    return Promise.reject(new Error("No track loaded"));
  }

  // If ended, restart from beginning
  if (this.#endedState) {
    this.#audio.currentTime = 0;
  }

  this.#endedState = false;
  this.#stopped = false;

  // Capture generation before awaiting
  const generation = this.#playGeneration;

  try {
    await this.#audio.play();
  } catch (error) {
    // If another track was loaded while we were waiting, discard the error
    if (this.#playGeneration !== generation) {
      return; // stale generation — silently discard
    }
    throw error;
  }

  // If another track was loaded while we were playing, discard the success
  if (this.#playGeneration !== generation) {
    return; // stale generation — silently discard
  }
}
```

### `#loadTrack()` already increments `#playGeneration` (from Plan 04). Verify the increment:

```ts
#loadTrack(track: Track): void {
  this.#playGeneration++;  // ← This is the key increment
  this.#stopped = false;
  this.#endedState = false;
  this.#audio.src = track.src;
  this.#audio.preload = this.#preloadStrategy;
}
```

### Update `#handleEnded` to check generation:

```ts
#handleEnded = (): void => {
  // Stale ended event — track was already changed
  if (this.#tracks.length === 0) return;

  this.#endedState = true;

  // Capture generation to detect if another operation supersedes us
  const generation = this.#playGeneration;

  if (this.#repeat === "one") {
    this.#endedState = false;
    this.#audio.currentTime = 0;
    this.#audio.play();
    return;
  }

  if (this.#repeat === "all" && this.#tracks.length === 1) {
    this.#endedState = false;
    this.#audio.currentTime = 0;
    this.#audio.play();
    return;
  }

  if (this.#repeat === "all") {
    this.next();
    return;
  }

  if (this.#currentIndex < this.#tracks.length - 1 || this.#shuffle === "on") {
    this.next();
    return;
  }

  // repeat=off, at the end — stay in endedState
};
```

### Update `#handleError` (stub, full implementation in Plan 08) to check generation:

```ts
#handleError = (): void => {
  if (this.#playGeneration !== this.#playGeneration) {
    // Guard: this will be properly implemented in Plan 08
    // For now, just emit the trackerror event
  }
  // Full implementation in Plan 08
};
```

### Ensure `next()`, `previous()`, and `goto()` all call `#loadTrack()` which increments generation:

These methods already call `#loadTrack()`, so the generation increment happens automatically. Verify that:

1. `next()` increments generation via `#loadTrack()`.
2. `previous()` increments generation via `#loadTrack()`.
3. `goto()` increments generation via `#loadTrack()`.
4. `stop()` does NOT need to increment generation (it doesn't load a new track).

### `stop()` behavior with in-flight `play()`:

If `stop()` is called while a `play()` Promise is pending:

- `stop()` calls `audio.pause()` immediately, which will cause the pending `play()` Promise to reject.
- The `play()` Promise's generation check will detect the mismatch and silently discard the rejection.

This is correct behavior — the consumer's `play()` Promise resolves silently, and `stop()` takes effect immediately.

## Edge Cases

1. **Rapid `next()` calls**: Each call increments the generation, so only the last call's `play()` takes effect. Previous Promises resolve silently.
2. **`next()` followed immediately by `stop()`**: `stop()` pauses the audio. The `next()` Promise resolves silently (generation mismatch after `stop` is a no-op because `stop` doesn't increment generation — but the `pause` from `stop` will cause `play()` to reject, which is caught by the generation check if a new track wasn't loaded).
3. **`play()` rejects with `NotAllowedError`**: If autoplay is blocked, the rejection propagates to the consumer (generation matches because no new track was loaded).
4. **`#handleEnded` fires on a stale track**: If `next()` was called before `ended` fires, the generation has already incremented, so `#handleEnded` should be a no-op. This is handled by checking if `currentIndex` still corresponds to a valid state, and by the fact that `#loadTrack()` has already changed `audio.src`, making the `ended` event irrelevant to the new track.

**Important**: The `#handleEnded` handler should NOT check `#playGeneration` directly to decide whether to advance, because `ended` is a native event on the HTMLAudioElement and may fire for the current track legitimately. Instead, the guard exists inside `play()` to prevent stale promises. The `ended` handler should always run its logic — if it calls `next()`, and `next()` loads a new track, the generation will naturally invalidate any stale pending `play()` from the previous track.

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. Rapid `next()` calls: only the last track plays; all intermediate `play()` Promises resolve silently.
3. `play()` after `next()`: if `next()` loaded a new track, the old `play()` Promise resolves silently.
4. `stop()` during pending `play()`: the Promise resolves silently, audio is paused.
5. `#handleEnded` on the last track with `repeat=off`: does not advance, player enters `endedState`.
6. `NotAllowedError` from autoplay policy: propagates to the consumer (not swallowed by generation check).
