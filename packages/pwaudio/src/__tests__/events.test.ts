import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventManager } from "../events";
import type { NativeEventDetail, TrackChangeDetail } from "../types";

/** Create a minimal EventTarget for testing. */
function createTarget(): EventTarget {
	return new EventTarget();
}

/** Create a minimal HTMLAudioElement mock for native proxy tests. */
function createAudioMock(): HTMLAudioElement & { _listeners: Map<string, Set<EventListener>> } {
	const listeners = new Map<string, Set<EventListener>>();

	const audio = {
		_listeners: listeners,
		addEventListener: vi.fn((event: string, handler: EventListener) => {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(handler);
		}),
		removeEventListener: vi.fn((event: string, handler: EventListener) => {
			const set = listeners.get(event);
			if (set) {
				set.delete(handler);
			}
		}),
	} as unknown as HTMLAudioElement & { _listeners: Map<string, Set<EventListener>> };

	Object.defineProperty(audio, "_listeners", { value: listeners });

	return audio;
}

/** Simulate a native event being dispatched on the audio mock. */
function simulateNativeEvent(
	audio: HTMLAudioElement & { _listeners: Map<string, Set<EventListener>> },
	eventName: string,
	nativeEvent?: Event,
): void {
	const set = audio._listeners.get(eventName);
	if (!set) return;
	const event = nativeEvent ?? new Event(eventName);
	for (const handler of set) {
		handler(event);
	}
}

describe("EventManager", () => {
	let target: EventTarget;
	let manager: EventManager;

	beforeEach(() => {
		target = createTarget();
		manager = new EventManager(target);
	});

	describe("on()", () => {
		it("registers a handler for an event", () => {
			const handler = vi.fn();
			manager.on("play", handler);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("allows multiple handlers for the same event", () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			manager.on("play", handler1);
			manager.on("play", handler2);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler1).toHaveBeenCalledOnce();
			expect(handler2).toHaveBeenCalledOnce();
		});

		it("does not duplicate the same handler reference", () => {
			const handler = vi.fn();
			manager.on("play", handler);
			manager.on("play", handler);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce();
		});
	});

	describe("off()", () => {
		it("removes a specific handler from an event", () => {
			const handler = vi.fn();
			manager.on("play", handler);
			manager.off("play", handler);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).not.toHaveBeenCalled();
		});

		it("does nothing when removing a handler that was never added", () => {
			const handler = vi.fn();
			manager.off("play", handler);
		});
	});

	describe("once()", () => {
		it("fires the handler only once and then removes it", () => {
			const handler = vi.fn();
			manager.once("play", handler);

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce();

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce();
		});

		it("works for synthetic events with custom detail", () => {
			const handler = vi.fn();
			manager.once("trackchange", handler);

			const detail: TrackChangeDetail = {
				previousIndex: -1,
				currentIndex: 0,
				track: { src: "test.mp3" },
			};
			manager.emit("trackchange", detail);
			expect(handler).toHaveBeenCalledOnce();

			const event = handler.mock.calls[0][0] as CustomEvent<TrackChangeDetail>;
			expect(event.detail).toEqual(detail);

			manager.emit("trackchange", { previousIndex: 0, currentIndex: 1, track: null });
			expect(handler).toHaveBeenCalledOnce();
		});

		it("works with multiple once() handlers on the same event", () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			manager.once("play", handler1);
			manager.once("play", handler2);

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler1).toHaveBeenCalledOnce();
			expect(handler2).toHaveBeenCalledOnce();

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler1).toHaveBeenCalledOnce();
			expect(handler2).toHaveBeenCalledOnce();
		});

		it("can be combined with on() handlers on the same event", () => {
			const onceHandler = vi.fn();
			const onHandler = vi.fn();
			manager.once("play", onceHandler);
			manager.on("play", onHandler);

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(onceHandler).toHaveBeenCalledOnce();
			expect(onHandler).toHaveBeenCalledOnce();

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(onceHandler).toHaveBeenCalledOnce();
			expect(onHandler).toHaveBeenCalledTimes(2);
		});

		it("once()-registered handler can be removed with off() before it fires", () => {
			const handler = vi.fn();
			manager.once("play", handler);
			manager.off("play", handler);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).not.toHaveBeenCalled();
		});

		it("off() removes once()-registered handler for native-proxied events", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const handler = vi.fn();
			manager.once("play", handler);
			manager.off("play", handler);

			simulateNativeEvent(audio, "play", new Event("play"));
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("emit()", () => {
		it("creates a CustomEvent with the correct type and detail", () => {
			const handler = vi.fn();
			manager.on("trackchange", handler);
			const detail = {
				previousIndex: -1,
				currentIndex: 0,
				track: { src: "test.mp3" },
			};
			manager.emit("trackchange", detail);
			const event = handler.mock.calls[0][0] as CustomEvent;
			expect(event.type).toBe("trackchange");
			expect(event.detail).toEqual(detail);
		});

		it("creates a CustomEvent without detail when not provided", () => {
			const handler = vi.fn();
			manager.on("stop", handler);
			manager.emit("stop");
			const event = handler.mock.calls[0][0] as CustomEvent;
			expect(event.detail).toBeNull();
		});

		it("does nothing when emitting an event with no listeners", () => {
			manager.emit("trackchange", { previousIndex: -1, currentIndex: 0, track: null });
		});

		it("delivers events to all registered handlers in order", () => {
			const order: number[] = [];
			const handler1 = vi.fn(() => order.push(1));
			const handler2 = vi.fn(() => order.push(2));
			const handler3 = vi.fn(() => order.push(3));

			manager.on("play", handler1);
			manager.on("play", handler2);
			manager.on("play", handler3);

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(order).toEqual([1, 2, 3]);
		});

		it("proxies native event detail correctly", () => {
			const handler = vi.fn();
			manager.on("play", handler);
			const nativeEvent = new Event("play");
			manager.emit("play", { nativeEvent } as NativeEventDetail);

			const event = handler.mock.calls[0][0] as CustomEvent<NativeEventDetail>;
			expect(event.detail.nativeEvent).toBe(nativeEvent);
		});
	});

	describe("native event proxying", () => {
		it("attaches listeners for all proxied native events", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			for (const eventName of [
				"play",
				"pause",
				"ended",
				"timeupdate",
				"durationchange",
				"volumechange",
				"ratechange",
				"seeking",
				"seeked",
				"waiting",
				"canplay",
				"error",
				"progress",
				"loadedmetadata",
			]) {
				expect(audio._listeners.has(eventName)).toBe(true);
			}
		});

		it("proxies native events as CustomEvent with NativeEventDetail", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const playHandler = vi.fn();
			manager.on("play", playHandler);

			const nativeEvent = new Event("play");
			simulateNativeEvent(audio, "play", nativeEvent);

			expect(playHandler).toHaveBeenCalledOnce();
			const customEvent = playHandler.mock.calls[0][0] as CustomEvent<NativeEventDetail>;
			expect(customEvent.type).toBe("play");
			expect(customEvent.detail.nativeEvent).toBe(nativeEvent);
		});

		it("no longer proxies events after detachNativeProxies", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const playHandler = vi.fn();
			manager.on("play", playHandler);

			manager.detachNativeProxies(audio);
			simulateNativeEvent(audio, "play", new Event("play"));

			expect(playHandler).not.toHaveBeenCalled();
		});
	});

	describe("removeAllListeners()", () => {
		it("removes all synthetic listeners", () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			manager.on("play", handler1);
			manager.on("trackchange", handler2);

			manager.removeAllListeners();

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			manager.emit("trackchange", { previousIndex: -1, currentIndex: 0, track: null });
			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});

		it("allows re-registering listeners after removal", () => {
			const handler = vi.fn();
			manager.on("play", handler);
			manager.removeAllListeners();
			manager.on("play", handler);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce();
		});
	});

	describe("full lifecycle", () => {
		it("attach → emit native proxy → detach → emit → no calls", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const playHandler = vi.fn();
			manager.on("play", playHandler);

			simulateNativeEvent(audio, "play", new Event("play"));
			expect(playHandler).toHaveBeenCalledOnce();

			manager.detachNativeProxies(audio);
			simulateNativeEvent(audio, "play", new Event("play"));
			expect(playHandler).toHaveBeenCalledOnce();
		});

		it("synthetic events still work after native proxy detach", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);
			manager.detachNativeProxies(audio);

			const handler = vi.fn();
			manager.on("stop", handler);
			manager.emit("stop");
			expect(handler).toHaveBeenCalledOnce();
		});

		it("clean teardown: detach + removeAllListeners", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const handler1 = vi.fn();
			const handler2 = vi.fn();
			manager.on("play", handler1);
			manager.on("trackchange", handler2);

			manager.detachNativeProxies(audio);
			manager.removeAllListeners();

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			manager.emit("trackchange", { previousIndex: -1, currentIndex: 0, track: null });
			simulateNativeEvent(audio, "play");

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});
});
