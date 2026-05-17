# Plan 02: Event System

## Objective

Create the event infrastructure that `PWAudio` uses to manage listeners and dispatch events. This module implements three concerns:

1. **Typed `on`/`off`/`once`** — Subscribe/unsubscribe with full type safety via `PlayerEventHandlerMap`.
2. **Synthetic event emission** — `#emit()` dispatches `CustomEvent` on the `PWAudio` instance.
3. **Native event proxying** — `#proxyNativeEvent()` wraps `HTMLAudioElement` events as `CustomEvent<NativeEventDetail>` and re-dispatches them on the `PWAudio` instance so consumers never interact with the underlying audio element.

## Design Decisions (from DESIGN.md)

- PWAudio does **not** extend `EventTarget`. Instead, it manages listeners via internal maps and dispatches `CustomEvent` through a lightweight mechanism. This avoids the quirks of native `EventTarget` (e.g., `addEventListener` requiring string casting) while keeping the `CustomEvent` pattern.
- All native events from the allowed list (`PROXIED_NATIVE_EVENTS`) are proxied. Others are **not** proxied — consumers who need them must access the underlying `HTMLAudioElement` directly (not part of the public API).
- `once()` removes the handler after the first invocation.
- `off()` must remove the exact same handler reference that was passed to `on()`.

## File to Create

### `packages/pwaudio/src/events.ts`

```ts
import type { PlayerEvent, PlayerEventHandlerMap, NativeEventDetail } from "./types";
import { PROXIED_NATIVE_EVENTS } from "./constants";

/**
 * Manages event subscription and dispatch for PWAudio.
 * Internally uses a Map<string, Set<EventListener>> for synthetic events
 * and a Map<string, EventListener> for native event proxies.
 */
export class EventManager {
	/** Synthetic event registry — maps event name to subscribed handlers */
	#listeners = new Map<string, Set<EventListener>>();

	/** Native event proxy registry — maps native event name to the bound proxy handler */
	#nativeListeners = new Map<string, EventListener>();

	/** The PWAudio instance to dispatch CustomEvents on */
	#target: EventTarget;

	constructor(target: EventTarget) {
		this.#target = target;
	}

	// ─── Typed subscription ───

	on<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		let handlers = this.#listeners.get(event);
		if (!handlers) {
			handlers = new Set();
			this.#listeners.set(event, handlers);
		}
		handlers.add(handler as EventListener);
	}

	once<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		const onceWrapper: PlayerEventHandlerMap[K] = ((e: any) => {
			handler(e);
			this.off(event, onceWrapper as PlayerEventHandlerMap[K]);
		}) as PlayerEventHandlerMap[K];

		this.on(event, onceWrapper);
	}

	off<K extends PlayerEvent>(event: K, handler: PlayerEventHandlerMap[K]): void {
		const handlers = this.#listeners.get(event);
		if (handlers) {
			handlers.delete(handler as EventListener);
			if (handlers.size === 0) {
				this.#listeners.delete(event);
			}
		}
	}

	// ─── Synthetic event emission ───

	emit(event: PlayerEvent, detail?: unknown): void {
		const customEvent =
			detail !== undefined ? new CustomEvent(event, { detail }) : new CustomEvent(event);

		const handlers = this.#listeners.get(event);
		if (handlers) {
			for (const handler of handlers) {
				handler(customEvent);
			}
		}
	}

	// ─── Native event proxying ───

	/**
	 * Attaches proxy listeners for all PROXIED_NATIVE_EVENTS on the given
	 * HTMLAudioElement. Each native event is wrapped in a
	 * CustomEvent<NativeEventDetail> and dispatched via emit().
	 */
	attachNativeProxies(audio: HTMLAudioElement): void {
		for (const eventName of PROXIED_NATIVE_EVENTS) {
			const handler = (nativeEvent: Event) => {
				this.emit(eventName as PlayerEvent, { nativeEvent } as NativeEventDetail);
			};
			this.#nativeListeners.set(eventName, handler);
			audio.addEventListener(eventName, handler);
		}
	}

	/**
	 * Removes all native proxy listeners from the given HTMLAudioElement.
	 * Called during destroy().
	 */
	detachNativeProxies(audio: HTMLAudioElement): void {
		for (const [eventName, handler] of this.#nativeListeners) {
			audio.removeEventListener(eventName, handler);
		}
		this.#nativeListeners.clear();
	}

	/**
	 * Removes all listeners (synthetic + native proxies).
	 * Called during destroy().
	 */
	removeAllListeners(): void {
		this.#listeners.clear();
	}
}
```

## Integration Notes for PWAudio.ts

The `PWAudio` class should:

1. Instantiate `EventManager` in its constructor: `this.#events = new EventManager(this);`
2. Call `this.#events.attachNativeProxies(this.#audio)` in the constructor.
3. Delegate `on()`, `off()`, `once()` to the `EventManager`.
4. Use `this.#events.emit("trackchange", { previousIndex, currentIndex, track })` for synthetic events.
5. Call `this.#events.detachNativeProxies(this.#audio)` and `this.#events.removeAllListeners()` in `destroy()`.

**Important:** `PWAudio` must itself be usable as an `EventTarget` for `once()` and `emit()` to work correctly. The simplest approach is to have `PWAudio` implement the `EventTarget` interface or, more simply, to manage listeners internally without actual `EventTarget` dispatch. The `EventManager` above dispatches by calling handlers directly (no `dispatchEvent`), which is more controlled and testable.

**Alternative decision:** If PWAudio should be an `EventTarget` (so that third-party code can use `player.addEventListener()` too), then the constructor should create an internal `EventTarget` and proxy through it. However, the DESIGN.md specifies `on`/`off`/`once` methods, not `addEventListener`/`removeEventListener`, so the direct-call approach in `EventManager` is correct.

## Verification

1. `pnpm -C packages/pwaudio typecheck` passes.
2. The `EventManager` correctly types `on`/`off`/`once` via `PlayerEventHandlerMap` — calling `on("trackchange", ...)` requires a handler matching `CustomEvent<TrackChangeDetail>`.
3. `once()` handlers fire exactly once and are removed.
4. `emit()` creates proper `CustomEvent` objects with `detail` for synthetic events and `NativeEventDetail` for proxied native events.
5. `attachNativeProxies` covers exactly the events in `PROXIED_NATIVE_EVENTS`.
6. `detachNativeProxies` removes exactly the handlers that were attached.
7. No `any` types (except the `once` wrapper's internal cast, which is unavoidable without over-engineering).
