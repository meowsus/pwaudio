# Plan 04: Playlist Engine

## Objective

Implement playlist navigation: `next()`, `previous()`, `goto()`, and the `#loadTrack()` internal method. These methods manage `currentIndex`, load the audio source, begin playback, and emit `trackchange` events. They are the foundation for shuffle (Plan 05) and the concurrency guard (Plan 06).

## Behavior Specification

### `next()`

- Respects repeat mode and shuffle (shuffle logic added in Plan 05).
- If at the last track with `repeat === 'off'`, does nothing (resolves without error).
- If at the last track with `repeat === 'all'`, wraps to index 0.
- If `repeat === 'one'`, the next track still advances (repeat=one only affects `ended` behavior).
- If shuffle is off, increments `currentIndex` by 1.
- If the playlist is empty, resolves immediately as a no-op.
- Emits `trackchange` if the index changes.
- Begins playback of the new track.
- Increments `#playGeneration`.

### `previous()`

- If `currentTime > previousRestartThreshold` (default 3s), restarts the current track from the beginning without changing the index.
- Otherwise, goes to the previous track. In shuffle mode, retreats through shuffle history (Plan 05).
- If at the first track (no shuffle), restarts from position 0 (wraps with `repeat === 'all'`).
- If the playlist is empty, resolves immediately as a no-op.
- Emits `trackchange` if the index changes.
- Begins playback of the new track.
- Increments `#playGeneration`.

### `goto(index)`

- Jumps to a specific track by index. Out-of-range indices are clamped.
- If the playlist is empty, resolves immediately as a no-op.
- Emits `trackchange` if the index changes.
- Begins playback of the new track.
- Increments `#playGeneration`.

### `#loadTrack(track)`

Internal method called by `next()`, `previous()`, `goto()`, and the `tracks` setter:

1. Sets `audio.src = track.src`
2. Applies `audio.preload = this.#preloadStrategy`
3. Increments `#playGeneration`
4. Clears `#stopped` and `#endedState`
5. Calls `#updateMediaSession()` (stub, filled in Plan 07)
6. Does NOT call `play()` — the caller is responsible for calling `play()` after `#loadTrack()`.

## Modifications to `packages/pwaudio/src/PWAudio.ts`

### Remove the placeholder stubs and add full implementations:

```ts
// ─── Playlist navigation ───

async next(): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }

  if (this.#tracks.length === 0) {
    return; // empty playlist — no-op
  }

  const previousIndex = this.#currentIndex;
  let nextIndex: number;

  if (this.#shuffle === "on") {
    // Shuffle logic added in Plan 05
    nextIndex = this.#currentIndex + 1; // fallback, replaced in Plan 05
  } else {
    nextIndex = this.#currentIndex + 1;
  }

  // Wrap around or stop based on repeat mode
  if (nextIndex >= this.#tracks.length) {
    if (this.#repeat === "all") {
      nextIndex = 0;
    } else {
      // repeat === 'off' or 'one' — at the end, do nothing
      return;
    }
  }

  this.#currentIndex = nextIndex;
  this.#endedState = false;

  const track = this.#currentTrack();
  if (!track) return;

  this.#loadTrack(track);
  this.#events.emit("trackchange", {
    previousIndex,
    currentIndex: this.#currentIndex,
    track,
  });

  return this.play();
}

async previous(): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }

  if (this.#tracks.length === 0) {
    return; // empty playlist — no-op
  }

  // If beyond threshold, restart current track
  if (this.#audio.currentTime > this.#previousRestartThreshold) {
    this.#audio.currentTime = 0;
    this.#endedState = false;
    if (!this.#audio.paused) return; // already playing, just seeked
    return this.play();
  }

  const previousIndex = this.#currentIndex;
  let prevIndex: number;

  if (this.#shuffle === "on") {
    // Shuffle logic added in Plan 05
    prevIndex = this.#currentIndex - 1; // fallback, replaced in Plan 05
  } else {
    prevIndex = this.#currentIndex - 1;
  }

  if (prevIndex < 0) {
    if (this.#repeat === "all") {
      prevIndex = this.#tracks.length - 1;
    } else {
      prevIndex = 0; // clamp to first track
    }
  }

  this.#currentIndex = prevIndex;
  this.#endedState = false;

  const track = this.#currentTrack();
  if (!track) return;

  this.#loadTrack(track);
  this.#events.emit("trackchange", {
    previousIndex,
    currentIndex: this.#currentIndex,
    track,
  });

  return this.play();
}

async goto(index: number): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }

  if (this.#tracks.length === 0) {
    return; // empty playlist — no-op
  }

  // Clamp index
  const clampedIndex = Math.max(0, Math.min(index, this.#tracks.length - 1));
  const previousIndex = this.#currentIndex;

  if (clampedIndex === previousIndex) {
    // Same track — just restart
    this.#audio.currentTime = 0;
    this.#endedState = false;
    if (!this.#audio.paused) return;
    return this.play();
  }

  this.#currentIndex = clampedIndex;
  this.#endedState = false;

  const track = this.#currentTrack();
  if (!track) return;

  this.#loadTrack(track);
  this.#events.emit("trackchange", {
    previousIndex,
    currentIndex: this.#currentIndex,
    track,
  });

  return this.play();
}

// ─── Internal ───

#loadTrack(track: Track): void {
  this.#playGeneration++;
  this.#stopped = false;
  this.#endedState = false;
  this.#audio.src = track.src;
  this.#audio.preload = this.#preloadStrategy;
  // Media Session update is added in Plan 07
}
```

### Update `#handleEnded` to include basic advancement logic:

```ts
#handleEnded = (): void => {
  this.#endedState = true;

  if (this.#repeat === "one") {
    // Repeat the current track
    this.#endedState = false;
    this.#audio.currentTime = 0;
    this.#audio.play();
    return;
  }

  if (this.#repeat === "all" && this.#currentIndex === this.#tracks.length - 1) {
    // Wrap to first track
    this.next();
    return;
  }

  if (this.#currentIndex < this.#tracks.length - 1) {
    // Advance to next track
    this.next();
    return;
  }

  // repeat === 'off', at the end — do nothing, stay in endedState
};
```

### Update `play()` to clear stopped/endedState and handle restart-after-end:

The `play()` method should also handle the case where `play()` is called after a track has ended (repeat=off, last track). Per DESIGN.md: "If called after a track has ended naturally (repeat=off, last track), restarts the current track from the beginning."

```ts
play(): Promise<void> {
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

  return this.#audio.play();
}
```

## Edge Cases

1. **Empty playlist**: `next()`, `previous()`, `goto()` all resolve immediately without error. `play()` rejects with `"No track loaded"`.
2. **`next()` at end with repeat=off**: Resolves as no-op. Does not wrap.
3. **`previous()` at beginning with repeat=off**: Restarts at index 0 (doesn't wrap or go to -1).
4. **`goto()` with clamped index**: `goto(-5)` → `goto(0)`, `goto(999)` → `goto(tracks.length - 1)`.
5. **`goto()` to same index**: Just seeks to 0 and plays (no `trackchange` needed... but we should still emit since the user explicitly navigated). Actually, per the implementation above, if `clampedIndex === previousIndex`, we just restart without emitting `trackchange`.
6. **Single track with repeat=all**: Equivalent to repeat=one — loops the same track.

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. `next()` advances `currentIndex` by 1.
3. `next()` at the last track with `repeat='off'` is a no-op.
4. `next()` at the last track with `repeat='all'` wraps to index 0.
5. `previous()` within threshold restarts the current track.
6. `previous()` beyond threshold goes back one track.
7. `previous()` at index 0 with `repeat='off'` stays at index 0.
8. `previous()` at index 0 with `repeat='all'` wraps to the last track.
9. `goto(2)` jumps to track at index 2.
10. `goto(-1)` clamps to index 0.
11. `goto(999)` clamps to the last index.
12. `trackchange` event fires with correct `previousIndex` and `currentIndex`.
13. All methods throw `DOMException("InvalidStateError")` after `destroy()`.
