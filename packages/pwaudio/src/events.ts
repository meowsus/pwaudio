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

	/** The EventTarget to dispatch CustomEvents on */
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
		const onceWrapper: PlayerEventHandlerMap[K] = ((e: CustomEvent) => {
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
