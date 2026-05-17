# Plan 05: Shuffle & Repeat

## Objective

Implement the Fisher-Yates shuffle algorithm with history tracking, and integrate shuffle and repeat modes into the playlist navigation methods (`next()`, `previous()`, `#handleEnded()`).

## File to Create

### `packages/pwaudio/src/shuffle.ts`

```ts
/**
 * Manages Fisher-Yates shuffle order and navigation history.
 *
 * The shuffle order is an array of track indices in random order.
 * The current track is always placed at position 0 to avoid skipping
 * when shuffle is first enabled mid-playlist.
 *
 * shuffleHistory records the actual order the user has traversed,
 * so previous() can go back through the real sequence.
 */
export class ShuffleManager {
	/** Permutation of track indices in shuffled order */
	#order: number[] = [];

	/** Actual traversal history — every index the user visited in order */
	#history: number[] = [];

	/** Current position in shuffleHistory (-1 if no history yet) */
	#historyPosition: number = -1;

	/**
	 * Generate a new shuffle order.
	 * Places the current track at position 0 to avoid skipping.
	 *
	 * @param trackCount Total number of tracks in the playlist
	 * @param currentIndex The currently playing track index
	 */
	generate(trackCount: number, currentIndex: number): void {
		if (trackCount <= 0) {
			this.#order = [];
			this.#history = [currentIndex];
			this.#historyPosition = 0;
			return;
		}

		// Create array of indices [0, 1, ..., trackCount-1]
		const indices = Array.from({ length: trackCount }, (_, i) => i);

		// Fisher-Yates shuffle
		for (let i = indices.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}

		// Place current track at position 0
		if (currentIndex >= 0 && currentIndex < trackCount) {
			const currentPos = indices.indexOf(currentIndex);
			if (currentPos !== 0) {
				[indices[0], indices[currentPos]] = [indices[currentPos], indices[0]];
			}
		}

		this.#order = indices;

		// Reset history — the current position is the starting point
		this.#history = [currentIndex >= 0 ? currentIndex : 0];
		this.#historyPosition = 0;
	}

	/**
	 * Get the next track index in the shuffle order.
	 * Records the new position in shuffleHistory.
	 *
	 * @param repeatAll Whether repeat=all is enabled
	 * @returns The next track index, or -1 if at the end with repeat=off
	 */
	next(repeatAll: boolean): number {
		const nextPos = this.#historyPosition + 1;

		if (nextPos < this.#order.length) {
			// We still have unvisited shuffled tracks ahead
			const nextIndex = this.#order[nextPos];
			this.#history.push(nextIndex);
			this.#historyPosition = nextPos;
			return nextIndex;
		}

		// We've exhausted the shuffle order
		if (repeatAll) {
			// Regenerate and start over
			// Note: The caller must call generate() again with the current track
			// For now, return -1 to signal that regeneration is needed
			return -1;
		}

		// repeat=off, at the end
		return -1;
	}

	/**
	 * Get the previous track index from shuffle history.
	 *
	 * @returns The previous track index, or -1 if at the beginning of history
	 */
	previous(): number {
		if (this.#historyPosition > 0) {
			this.#historyPosition--;
			return this.#history[this.#historyPosition];
		}

		// At the beginning of history, no previous track
		return -1;
	}

	/**
	 * Get the current position in shuffle history.
	 */
	get historyPosition(): number {
		return this.#historyPosition;
	}

	/**
	 * Get the current shuffle order (read-only copy).
	 */
	get order(): readonly number[] {
		return [...this.#order];
	}

	/**
	 * Get the current track index from history.
	 */
	get current(): number {
		if (this.#historyPosition >= 0 && this.#historyPosition < this.#history.length) {
			return this.#history[this.#historyPosition];
		}
		return -1;
	}

	/**
	 * Push a track index onto history (used when navigating by goto).
	 */
	pushToHistory(index: number): void {
		// Remove any forward history (like browser history)
		this.#history = this.#history.slice(0, this.#historyPosition + 1);
		this.#history.push(index);
		this.#historyPosition = this.#history.length - 1;
	}

	/**
	 * Update the current position in history (used when playlist is replaced
	 * and currentIndex changes externally).
	 */
	setCurrent(index: number): void {
		this.#history = [index];
		this.#historyPosition = 0;
	}

	/**
	 * Clear all shuffle state.
	 */
	clear(): void {
		this.#order = [];
		this.#history = [];
		this.#historyPosition = -1;
	}
}
```

## Modifications to `packages/pwaudio/src/PWAudio.ts`

### Add the `#shuffleManager` private field:

```ts
import { ShuffleManager } from "./shuffle";

// In the class body:
#shuffleManager = new ShuffleManager();
```

### Update the `shuffle` setter to generate/regenerate/clear shuffle order:

```ts
set shuffle(mode: ShuffleMode) {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }
  if (this.#shuffle === mode) return; // no change

  this.#shuffle = mode;

  if (mode === "on") {
    // Generate shuffle order with current track at position 0
    this.#shuffleManager.generate(
      this.#tracks.length,
      this.#currentIndex,
    );
  } else {
    // Clear shuffle state — currentIndex stays on the current track
    this.#shuffleManager.clear();
  }
}
```

### Update `next()` to use shuffle:

```ts
async next(): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }

  if (this.#tracks.length === 0) {
    return;
  }

  const previousIndex = this.#currentIndex;
  let nextIndex: number;

  if (this.#shuffle === "on") {
    const shuffledNext = this.#shuffleManager.next(this.#repeat === "all");
    if (shuffledNext === -1) {
      if (this.#repeat === "all") {
        // Regenerate shuffle order and start from the beginning
        this.#shuffleManager.generate(this.#tracks.length, this.#currentIndex);
        nextIndex = this.#shuffleManager.next(true);
        if (nextIndex === -1) return; // shouldn't happen but guard
      } else {
        // At the end with repeat=off
        return;
      }
    } else {
      nextIndex = shuffledNext;
    }
  } else {
    nextIndex = this.#currentIndex + 1;
    if (nextIndex >= this.#tracks.length) {
      if (this.#repeat === "all") {
        nextIndex = 0;
      } else {
        return; // repeat=off, at the end
      }
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
```

### Update `previous()` to use shuffle history:

```ts
async previous(): Promise<void> {
  if (this.#destroyed) {
    throw new DOMException("PWAudio has been destroyed", "InvalidStateError");
  }

  if (this.#tracks.length === 0) {
    return;
  }

  // If beyond threshold, restart current track
  if (this.#audio.currentTime > this.#previousRestartThreshold) {
    this.#audio.currentTime = 0;
    this.#endedState = false;
    if (!this.#audio.paused) return;
    return this.play();
  }

  const previousIndex = this.#currentIndex;
  let prevIndex: number;

  if (this.#shuffle === "on") {
    const shuffledPrev = this.#shuffleManager.previous();
    if (shuffledPrev === -1) {
      // No history — restart current track
      this.#audio.currentTime = 0;
      this.#endedState = false;
      if (!this.#audio.paused) return;
      return this.play();
    }
    prevIndex = shuffledPrev;
  } else {
    prevIndex = this.#currentIndex - 1;
    if (prevIndex < 0) {
      if (this.#repeat === "all") {
        prevIndex = this.#tracks.length - 1;
      } else {
        prevIndex = 0; // clamp to first
      }
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
```

### Update `goto()` to record in shuffle history:

```ts
async goto(index: number): Promise<void> {
  // ... (same as Plan 04, but add shuffle history tracking)

  this.#currentIndex = clampedIndex;
  this.#endedState = false;

  if (this.#shuffle === "on") {
    this.#shuffleManager.pushToHistory(clampedIndex);
  }

  // ... rest is same
}
```

### Update `#handleEnded` with full repeat/shuffle logic:

```ts
#handleEnded = (): void => {
  this.#endedState = true;

  if (this.#repeat === "one") {
    this.#endedState = false;
    this.#audio.currentTime = 0;
    this.#audio.play();
    return;
  }

  // Single-track with repeat=all is equivalent to repeat=one
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

  // Not at the end — advance
  if (this.#currentIndex < this.#tracks.length - 1 || this.#shuffle === "on") {
    this.next();
    return;
  }

  // repeat=off, at the end — stay in endedState
};
```

### Update `tracks` setter to regenerate shuffle on playlist mutation:

When `tracks` is replaced while shuffle is on, the shuffle order and history must be regenerated:

```ts
set tracks(newTracks: Track[]) {
  // ... (existing logic from Plan 03)

  // Regenerate shuffle order if shuffle is on
  if (this.#shuffle === "on" && newTracks.length > 0) {
    this.#shuffleManager.generate(newTracks.length, this.#currentIndex);
  }

  // ... (rest of existing logic)
}
```

## Shuffle State Mutations Summary

| Scenario                           | Shuffle behavior                                                            |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Shuffle toggled ON                 | Generate Fisher-Yates order with current track at position 0, reset history |
| Shuffle toggled OFF                | Clear shuffle state, keep `currentIndex` on current track                   |
| Playlist replaced while shuffle ON | Regenerate shuffle order, reset history, place current track at position 0  |
| Current track not in new playlist  | `currentIndex` resets to 0, shuffle regenerated                             |
| `next()` with shuffle              | Advance through shuffle order                                               |
| `previous()` with shuffle          | Retreat through shuffle history                                             |
| `goto()` with shuffle              | Push target index onto shuffle history                                      |

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. Enabling shuffle generates a permutation where the current track is at position 0.
3. `next()` in shuffle mode advances through the shuffle order.
4. `previous()` in shuffle mode retreats through shuffle history.
5. `previous()` in shuffle mode with no history restarts the current track.
6. Setting `repeat = 'one'` causes a track to loop on `ended`.
7. Setting `repeat = 'all'` wraps from last track to first.
8. Setting `repeat = 'off'` stops at the last track.
9. Single track with `repeat = 'all'` loops indefinitely (equivalent to `repeat = 'one'`).
10. Replacing `tracks` while shuffle is ON regenerates the shuffle order.
11. Toggling shuffle OFF preserves the current track position.
12. Shuffle order covers all track indices exactly once (no duplicates, no gaps).
