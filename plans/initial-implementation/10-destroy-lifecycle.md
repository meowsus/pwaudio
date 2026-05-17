# Plan 10: Destroy & Lifecycle

## Objective

Implement the `destroy()` method that tears down the `PWAudio` instance completely, and add post-destroy guards to all public methods that throw `DOMException` with name `"InvalidStateError"` after the instance has been destroyed.

## `destroy()` Specification (from DESIGN.md §5)

When `destroy()` is called:

1. **Pause playback**: `this.#audio.pause()`
2. **Remove all event listeners** (both native proxies and synthetic)
3. **Clear Media Session metadata and action handlers**
4. **Set `audio.src = ''` and call `audio.load()`** to abort any in-flight network request
5. **Remove the `src` attribute**: `this.#audio.removeAttribute('src')`
6. **Set the `#destroyed` flag**

After `destroy()`, any method call throws `DOMException` with name `"InvalidStateError"` and message `"PWAudio has been destroyed"`.

If a `play()` Promise is in-flight at the time of `destroy()`, it resolves silently (consistent with stale-generation behavior — `#loadTrack()` or `destroy()` changes the state, making the pending result irrelevant).

## Modifications to `packages/pwaudio/src/PWAudio.ts`

### Implement `destroy()`:

```ts
destroy(): void {
  if (this.#destroyed) return; // Idempotent

  // 1. Pause playback
  this.#audio.pause();

  // 2. Remove all event listeners
  this.#events.detachNativeProxies(this.#audio);
  this.#events.removeAllListeners();

  // Remove internal native handlers
  this.#audio.removeEventListener("ended", this.#handleEnded);
  this.#audio.removeEventListener("error", this.#handleError);
  this.#audio.removeEventListener("timeupdate", this.#timeUpdateHandler);
  this.#audio.removeEventListener("ratechange", this.#rateChangeHandler);
  this.#audio.removeEventListener("play", this.#playStateHandler);
  this.#audio.removeEventListener("pause", this.#pauseStateHandler);

  // 3. Clear Media Session metadata and action handlers
  this.#mediaSession.clear();

  // 4. Abort any in-flight network request
  this.#audio.src = "";
  this.#audio.load();

  // 5. Remove src attribute
  this.#audio.removeAttribute("src");

  // 6. Set destroyed flag
  this.#destroyed = true;
}
```

### Post-destroy guards on all public methods:

Every public property setter and method should check `#destroyed` and throw `DOMException` if true. The getters should return safe defaults:

```ts
// Getters that return safe defaults after destroy:
get playing(): boolean { if (this.#destroyed) return false; /* ... */ }
get paused(): boolean { if (this.#destroyed) return true; /* ... */ }
get stopped(): boolean { if (this.#destroyed) return true; /* ... */ }
get currentTime(): number { if (this.#destroyed) return 0; /* ... */ }
get duration(): number { if (this.#destroyed) return NaN; /* ... */ }
get buffered(): TimeRanges { /* TimeRanges can't be null, return empty */ /* ... */ }
get seeking(): boolean { if (this.#destroyed) return false; /* ... */ }
get volume(): number { if (this.#destroyed) return 0; /* ... */ }
get muted(): boolean { if (this.#destroyed) return false; /* ... */ }
get playbackRate(): number { if (this.#destroyed) return 1; /* ... */ }
get preservesPitch(): boolean { if (this.#destroyed) return true; /* ... */ }
get src(): string { if (this.#destroyed) return ""; /* ... */ }
get tracks(): readonly Track[] { if (this.#destroyed) return []; /* ... */ }
get currentIndex(): number { if (this.#destroyed) return -1; /* ... */ }
get currentTrack(): Track | null { if (this.#destroyed) return null; /* ... */ }
get repeat(): RepeatMode { if (this.#destroyed) return "off"; /* ... */ }
get shuffle(): ShuffleMode { if (this.#destroyed) return "off"; /* ... */ }
get mediaSessionEnabled(): boolean { if (this.#destroyed) return false; /* ... */ }
get preload(): PreloadStrategy { if (this.#destroyed) return "none"; /* ... */ }
get previousRestartThreshold(): number { if (this.#destroyed) return 0; /* ... */ }
get endedState(): boolean { if (this.#destroyed) return false; /* ... */ }

// Setters and methods that throw:
// All setters and methods (play, pause, stop, next, previous, goto, destroy)
// should throw DOMException("PWAudio has been destroyed", "InvalidStateError")
// when called after destroy.
```

### Helper method for throwing after destroy:

```ts
#throwIfDestroyed(): void {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }
}
```

Then use `this.#throwIfDestroyed()` at the top of each public setter and mutating method.

### `play()` after destroy:

```ts
async play(): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }
  // ... rest of implementation
}
```

If `destroy()` is called while `play()` is pending, the generation guard handles it — the pending Promise resolves silently because `#destroyed` is set. The `play()` Promise doesn't reject; it just resolves without effect.

### `destroy()` is idempotent:

Calling `destroy()` multiple times is safe. The first call tears down everything; subsequent calls return immediately due to the `#destroyed` flag check.

### Event listener cleanup:

The constructor registers several native event listeners that must be removed in `destroy()`:

1. **Proxied native events** — handled by `EventManager.detachNativeProxies()`
2. **Internal handlers** (ended, error, timeupdate, ratechange, play, pause) — must be individually removed
3. **Synthetic event listeners** — handled by `EventManager.removeAllListeners()`

### Internal handler references:

The constructor must store references to handler functions so they can be removed in `destroy()`. Use arrow function properties (already done for `#handleEnded` and `#handleError`):

```ts
// In constructor:
this.#audio.addEventListener("timeupdate", this.#timeUpdateHandler);
this.#audio.addEventListener("ratechange", this.#rateChangeHandler);
this.#audio.addEventListener("play", this.#playStateHandler);
this.#audio.addEventListener("pause", this.#pauseStateHandler);

// As class fields:
#timeUpdateHandler = (): void => {
  this.#mediaSession.throttleSetPositionState();
};

#rateChangeHandler = (): void => {
  this.#mediaSession.setPositionState();
};

#playStateHandler = (): void => {
  if (this.#destroyed) return;
  if ("mediaSession" in navigator && this.#mediaSession.enabled) {
    navigator.mediaSession.playbackState = "playing";
  }
};

#pauseStateHandler = (): void => {
  if (this.#destroyed) return;
  if ("mediaSession" in navigator && this.#mediaSession.enabled) {
    navigator.mediaSession.playbackState = "paused";
  }
};
```

## Getters After Destroy — Safe Defaults

| Getter                     | Value after destroy | Rationale                        |
| -------------------------- | ------------------- | -------------------------------- |
| `playing`                  | `false`             | Nothing is playing               |
| `paused`                   | `true`              | Is paused (semantically correct) |
| `stopped`                  | `true`              | Is stopped                       |
| `endedState`               | `false`             | Not in ended state               |
| `currentTime`              | `0`                 | Reset position                   |
| `duration`                 | `NaN`               | No duration available            |
| `buffered`                 | empty `TimeRanges`  | No buffered data                 |
| `seeking`                  | `false`             | Not seeking                      |
| `volume`                   | `0`                 | Reset                            |
| `muted`                    | `false`             | Reset                            |
| `playbackRate`             | `1`                 | Reset                            |
| `preservesPitch`           | `true`              | Default per spec                 |
| `src`                      | `""`                | No source                        |
| `tracks`                   | `[]`                | No tracks                        |
| `currentIndex`             | `-1`                | No track selected                |
| `currentTrack`             | `null`              | No track                         |
| `repeat`                   | `"off"`             | Default                          |
| `shuffle`                  | `"off"`             | Default                          |
| `mediaSessionEnabled`      | `false`             | Disabled                         |
| `preload`                  | `"none"`            | No preloading                    |
| `previousRestartThreshold` | `0`                 | Reset                            |

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. `destroy()` pauses playback, clears src, removes all listeners, clears Media Session.
3. After `destroy()`, all setters throw `DOMException` with name `"InvalidStateError"`.
4. After `destroy()`, all methods (`play`, `pause`, `stop`, `next`, `previous`, `goto`) throw `DOMException`.
5. After `destroy()`, all getters return safe defaults (see table above).
6. `destroy()` is idempotent — calling it twice does not throw or cause errors.
7. If `play()` Promise is in-flight when `destroy()` is called, it resolves silently (no rejection).
8. No event listeners leak after `destroy()` — the `HTMLAudioElement` has no remaining handlers.
9. Media Session metadata and action handlers are cleared.
10. `audio.src` is `""` and `audio` has no `src` attribute after destroy.
