# Plan 09: Platform Quirks

## Objective

Implement browser-specific behavior and workarounds that make `pwaudio` robust across all target platforms. These are small but critical adjustments scattered across `PWAudio.ts`.

## Quirks to Implement

### 9.1 `preservesPitch` / `webkitPreservesPitch` Prefix

Safari < 17 requires the `-webkit-` prefixed version of `preservesPitch`. Both properties should be set for maximum compatibility.

**Already implemented in Plan 03** via `#applyPreservesPitch(v: boolean)`. Verify it covers both:

```ts
#applyPreservesPitch(v: boolean): void {
  if ("preservesPitch" in this.#audio) {
    (this.#audio as any).preservesPitch = v;
  }
  if ("webkitPreservesPitch" in this.#audio) {
    (this.#audio as any).webkitPreservesPitch = v;
  }
}
```

The getter should also check both:

```ts
get preservesPitch(): boolean {
  if ("preservesPitch" in this.#audio) {
    return (this.#audio as any).preservesPitch;
  }
  if ("webkitPreservesPitch" in this.#audio) {
    return (this.#audio as any).webkitPreservesPitch;
  }
  return true; // default per spec
}
```

### 9.2 Volume Clamping

Volume is clamped to `[0, 1]`. Values outside this range are silently clamped, not thrown. This matches `HTMLAudioElement` behavior.

**Already implemented** via `clampVolume()` in `utils.ts` and the `volume` setter in `PWAudio.ts`.

### 9.3 Playback Rate Clamping

Playback rate is clamped to `[0.25, 4.0]`. Values outside are silently clamped.

**Already implemented** via `clampPlaybackRate()` in `utils.ts` and the `playbackRate` setter in `PWAudio.ts`.

### 9.4 Preload Strategy

The `preload` attribute must be set **before** `load()` for it to take effect. The library applies it:

1. On construction — set on the initial `HTMLAudioElement`.
2. On every `#loadTrack()` call — applied before the browser fetches.
3. When the consumer changes `preload` via the setter — applied immediately, but only takes full effect on the next `#loadTrack()`.

The setter already exists from Plan 03. Verify `#loadTrack()` applies it:

```ts
#loadTrack(track: Track): void {
  this.#playGeneration++;
  this.#stopped = false;
  this.#endedState = false;
  this.#audio.src = track.src;
  this.#audio.preload = this.#preloadStrategy; // ← Must be set after src
  this.#updateMediaSession();
}
```

**Note**: Setting `preload` after `src` is correct because the browser doesn't start fetching until the event loop yields. Setting `src` triggers an implicit `load()`, but `preload` set synchronously after `src` will be respected before the first byte is fetched.

### 9.5 Volume Setter on Mobile

Programmatic volume control is disabled on many mobile browsers (iOS Safari, Android Chrome). The setter will not throw, but the value may be ignored. This is an OS-level constraint, not a library bug.

**No code change needed** — `HTMLAudioElement.volume` already handles this gracefully. The getter returns the actual (possibly unchanged) value.

Documentation should note this in JSDoc comments on the `volume` setter:

```ts
/**
 * Volume level, clamped to 0–1. Values outside this range are
 * clamped rather than thrown.
 *
 * Note: Programmatic volume control is disabled on many mobile
 * browsers (iOS Safari, Android Chrome). The setter will not throw,
 * but the value may be ignored by the OS.
 */
get volume(): number;
set volume(v: number);
```

### 9.6 Media Session Graceful Degradation

When `navigator.mediaSession` is unavailable, all Media Session operations silently no-op. This is already implemented via the `isAvailable` check in `MediaSessionManager`.

**No additional code change needed.**

### 9.7 `isFiniteDuration` Helper

A utility function to check if a duration value is usable for position state:

**Already implemented** in `utils.ts`:

```ts
export function isFiniteDuration(duration: number): boolean {
	return Number.isFinite(duration) && duration > 0;
}
```

Use in `setPositionState()` to guard against `NaN` and `Infinity`:

```ts
setPositionState(): void {
  if (!this.#enabled || !this.isAvailable) return;
  const duration = this.#audio.duration;
  if (isFiniteDuration(duration)) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.#audio.playbackRate,
        position: Math.max(0, Math.min(this.#audio.currentTime, duration)),
      });
    } catch {
      // Silently ignore invalid position state
    }
  }
}
```

**Note:** The `position` should be clamped to `[0, duration]` because `setPositionState()` throws if `position > duration` or `position < 0`.

### 9.8 iOS Silent Switch

`HTMLAudioElement` routes through the **media channel** and is **not affected** by the physical silent switch. This is a key reason for choosing `HTMLAudioElement` over Web Audio API.

**No code change needed** — this is a documentation point.

### 9.9 Multiple Instances and Media Session

`navigator.mediaSession` is a per-page singleton. If multiple `PWAudio` instances exist, the last instance to call `updateMediaSession()` wins. The library does **not** attempt to coordinate between instances.

**No code change needed** — this is a documented limitation.

### 9.10 The `src` Setter Destructive Behavior

Setting `src` directly replaces the entire playlist with a single entry. This is documented in JSDoc:

```ts
/**
 * Set audio source directly (single-track mode).
 * ⚠ Destructive: this clears the entire playlist and replaces it
 * with a single entry [{src: url}]. Any existing playlist state
 * (currentIndex, shuffle order, shuffle history) is lost.
 * Emits 'playlistchange' and 'trackchange'.
 *
 * If you need to change the playlist without losing it, use
 * player.tracks instead.
 */
set src(url: string);
```

### 9.11 `stop()` Event Cascade Documentation

Document that `stop()` fires `pause` (native), `seeking` (native), `seeked` (native), then `stop` (synthetic). Consumers should treat `stop` as the definitive signal.

### 9.12 `fastSeek` in Media Session `seekto` Handler

Use `audio.fastSeek()` when the browser supports it and the `fastSeek` flag is set in the `seekto` action details:

```ts
seekto: (details: MediaSessionActionDetails) => {
	if (details.fastSeek && "fastSeek" in this.#audio) {
		(this.#audio as any).fastSeek(details.seekTime);
	} else {
		this.#audio.currentTime = details.seekTime;
	}
};
```

This is already noted in Plan 07. Ensure it's implemented.

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. `preservesPitch` getter/setter works on both standard and `-webkit-` prefixed properties.
3. `volume` clamps values to [0, 1] silently (no throw).
4. `playbackRate` clamps values to [0.25, 4.0] silently.
5. Setting `volume` to 2.0 results in `volume` reading back as 1.
6. Setting `playbackRate` to 0.1 results in `playbackRate` reading back as 0.25.
7. Setting `playbackRate` to 10 results in `playbackRate` reading back as 4.
8. `preload` setter applies the strategy immediately and on the next `#loadTrack()`.
9. `setPositionState()` does not throw when duration is `NaN`, `Infinity`, or `0`.
10. All JSDoc comments are present on the relevant properties.
