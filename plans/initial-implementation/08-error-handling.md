# Plan 08: Error Handling

## Objective

Implement comprehensive error handling for the `PWAudio` class:

1. `trackerror` synthetic event — fires when the `HTMLAudioElement` errors during loading or playback.
2. Empty playlist rejection — `play()` rejects when no track is loaded.
3. `play()` autoplay policy handling — `NotAllowedError` propagates to the consumer.
4. Proper `#handleError()` implementation with generation guard.

## Error Events

When the `HTMLAudioElement` fires an `error` event, the library must:

1. **Proxy the native `error` event** to consumers as `CustomEvent<NativeEventDetail>` (already handled by the event system from Plan 02).
2. **Additionally emit a synthetic `trackerror` event** with a `TrackErrorDetail` payload:

   ```ts
   {
     error: MediaError | null,  // from audio.error
     track: Track | null,        // the current track
     index: number               // currentIndex
   }
   ```

3. **Do NOT auto-skip** to the next track. This decision is left to the consumer.

## Modifications to `packages/pwaudio/src/PWAudio.ts`

### Implement `#handleError`:

```ts
#handleError = (): void => {
  // Capture generation at the time of error
  const generation = this.#playGeneration;

  // Emit trackerror synthetic event
  this.#events.emit("trackerror", {
    error: this.#audio.error,
    track: this.#currentTrack(),
    index: this.#currentIndex,
  });
};
```

**Why no generation guard for the event itself?** The `trackerror` event should always fire — the consumer needs to know that a track failed to load, even if they've already navigated away. The generation guard is relevant for `play()` Promises (which are invalidated), not for events (which are informational).

However, there's a subtlety: if `next()` was called rapidly after an error and `#loadTrack()` already incremented the generation, the `trackerror` event might reference the wrong track. The implementation above uses `this.#currentTrack()` which returns the _current_ track (which may have already changed). To capture the track that actually errored, we need to capture it at the time of the error:

```ts
#handleError = (): void => {
  // Capture the current track at the time of error, before any generation checks
  const errorTrack = this.#currentTrack();
  const errorIndex = this.#currentIndex;

  this.#events.emit("trackerror", {
    error: this.#audio.error,
    track: errorTrack,
    index: errorIndex,
  });
};
```

This is correct because the `#handleError` listener is bound to the `HTMLAudioElement`'s `error` event, and at the point it fires, the audio element's `src` still points to the failed track (even if `#loadTrack()` has been called for a new track and incremented generation, the `error` event fires asynchronously for the old `src`). However, since `audio.src` may have already been changed by `#loadTrack()`, we should capture `errorTrack` before any async operations.

### Empty playlist rejection in `play()`:

Already implemented in Plan 03:

```ts
if (this.#tracks.length === 0) {
	return Promise.reject(new Error("No track loaded"));
}
```

### `play()` autoplay rejection:

The `NotAllowedError` from `audio.play()` already propagates naturally through the `await` in `play()`. The generation guard ensures that if a new track was loaded while the `play()` was pending, the rejection is silently discarded (since the new track's `play()` will handle its own outcome).

### Autoplay policy documentation (no code change needed):

The library does **not** auto-retry or auto-unmute on autoplay block. Consumers must:

1. Call `play()` from a user gesture handler (click, keypress, touch).
2. Catch `NotAllowedError` and show appropriate UI.

## Error Flow Diagram

```
HTMLAudioElement fires "error"
  │
  ├─→ Native "error" event proxied to consumers
  │   (CustomEvent<NativeEventDetail> with original Event in detail.nativeEvent)
  │
  └─→ #handleError() fires
        │
        └─→ "trackerror" synthetic event emitted
            (CustomEvent<TrackErrorDetail> with error, track, index)
```

## Consumer Usage Patterns

### Basic error logging:

```ts
player.on("trackerror", (e) => {
	console.error(`Track ${e.detail.index} failed:`, e.detail.error);
});
```

### Skip to next on error:

```ts
player.on("trackerror", (e) => {
	console.error(`Track ${e.detail.index} failed`, e.detail.track);
	void player.next();
});
```

### Autoplay handling:

```ts
playButton.addEventListener("click", async () => {
	try {
		await player.play();
	} catch (err) {
		if (err instanceof DOMException && err.name === "NotAllowedError") {
			showAutoplayBlockedMessage();
		}
	}
});
```

## Edge Cases

1. **Multiple rapid errors**: If two tracks error in quick succession, two `trackerror` events fire. Each carries the track and index of the track that failed.

2. **Error during `next()`**: If `next()` is called while a track is loading and that track errors, the `trackerror` event fires for the failed track. The `playGeneration` guard prevents the stale error from interfering with the new track's `play()`.

3. **Error with empty playlist**: `this.#audio.error` may be null if the error was caused by an empty `src`. The `trackerror` event still fires with `error: null` and `track: null`.

4. **`audio.error` is a `MediaError` object**: It has `code` (numeric) and `message` (string) properties. `MEDIA_ERR_ABORTED` (1), `MEDIA_ERR_NETWORK` (2), `MEDIA_ERR_DECODE` (3), `MEDIA_ERR_SRC_NOT_SUPPORTED` (4).

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. When `HTMLAudioElement` fires `error`, both the native proxied event and the synthetic `trackerror` event are emitted.
3. `trackerror` detail contains `{ error, track, index }` with the correct values.
4. `play()` on empty playlist rejects with an Error (message: "No track loaded").
5. `play()` rejection with `NotAllowedError` propagates to the consumer.
6. Stale `play()` Promise rejections (from rapid `next()` calls) are silently discarded by the generation guard.
7. Setting `audio.src` to an invalid URL and calling `play()` results in a `trackerror` event.
8. The library does NOT auto-skip to the next track on error.
