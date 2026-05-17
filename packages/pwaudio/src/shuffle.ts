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
