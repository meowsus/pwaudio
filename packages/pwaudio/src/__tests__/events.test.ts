import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventManager } from "../events";
import type { NativeEventDetail, TrackChangeDetail } from "../types";

// ─── Helpers ───

/** Create a minimal EventTarget-like object for testing. */
function createTarget(): EventTarget {
	// In happy-dom, EventTarget is available globally.
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

	// Attach the mock listener registry so tests can inspect it
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

// ─── Tests ───

describe("EventManager", () => {
	let target: EventTarget;
	let manager: EventManager;

	beforeEach(() => {
		target = createTarget();
		manager = new EventManager(target);
	});

	// ─── on() / off() ───

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
			manager.on("play", handler); // register same handler twice
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce(); // should fire only once
		});

		it("registers handlers for different events independently", () => {
			const playHandler = vi.fn();
			const pauseHandler = vi.fn();
			manager.on("play", playHandler);
			manager.on("pause", pauseHandler);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(playHandler).toHaveBeenCalledOnce();
			expect(pauseHandler).not.toHaveBeenCalled();
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

		it("removes only the specified handler, keeping others", () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			manager.on("play", handler1);
			manager.on("play", handler2);
			manager.off("play", handler1);
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).toHaveBeenCalledOnce();
		});

		it("does nothing when removing a handler that was never added", () => {
			const handler = vi.fn();
			// Should not throw
			manager.off("play", handler);
		});

		it("cleans up empty handler sets from the listeners map", () => {
			const handler = vi.fn();
			manager.on("play", handler);
			manager.off("play", handler);
			// Emit should not throw or error — there are no handlers
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("once()", () => {
		it("fires the handler only once and then removes it", () => {
			const handler = vi.fn();
			manager.once("play", handler);

			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce();

			// Second emit should not call the handler again
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			expect(handler).toHaveBeenCalledOnce(); // still only 1 call
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
			expect(event.type).toBe("trackchange");

			// Second emit should not fire handler
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

			// Neither should fire again
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
			expect(onceHandler).toHaveBeenCalledOnce(); // still 1
			expect(onHandler).toHaveBeenCalledTimes(2); // called again
		});
	});

	// ─── emit() ───

	describe("emit()", () => {
		it("creates a CustomEvent with the correct type", () => {
			const handler = vi.fn();
			manager.on("stop", handler);
			manager.emit("stop");
			expect(handler).toHaveBeenCalledOnce();
			const event = handler.mock.calls[0][0] as CustomEvent;
			expect(event.type).toBe("stop");
		});

		it("creates a CustomEvent with detail when provided", () => {
			const handler = vi.fn();
			manager.on("trackchange", handler);
			const detail = {
				previousIndex: -1,
				currentIndex: 0,
				track: { src: "test.mp3" },
			};
			manager.emit("trackchange", detail);
			const event = handler.mock.calls[0][0] as CustomEvent;
			expect(event.detail).toEqual(detail);
		});

		it("creates a CustomEvent without detail when not provided", () => {
			const handler = vi.fn();
			manager.on("stop", handler);
			manager.emit("stop");
			const event = handler.mock.calls[0][0] as CustomEvent;
			expect(event.detail).toBeNull(); // CustomEvent defaults detail to null
		});

		it("does nothing when emitting an event with no listeners", () => {
			// Should not throw
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

		it("proxies native event detail correctly via NativeEventDetail", () => {
			const handler = vi.fn();
			manager.on("play", handler);

			const nativeEvent = new Event("play");
			manager.emit("play", { nativeEvent } as NativeEventDetail);

			const event = handler.mock.calls[0][0] as CustomEvent<NativeEventDetail>;
			expect(event.detail.nativeEvent).toBe(nativeEvent);
		});
	});

	// ─── Native event proxying ───

	describe("attachNativeProxies()", () => {
		it("attaches listeners for all PROXIED_NATIVE_EVENTS", () => {
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

		it("creates exactly one handler per proxied event", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			for (const [, set] of audio._listeners) {
				expect(set.size).toBe(1);
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

		it("does not proxy events not in PROXIED_NATIVE_EVENTS", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			// 'loadstart' is not in the proxied list
			expect(audio._listeners.has("loadstart")).toBe(false);
			expect(audio._listeners.has("stalled")).toBe(false);
			expect(audio._listeners.has("emptied")).toBe(false);
		});
	});

	describe("detachNativeProxies()", () => {
		it("removes all native proxy listeners from the audio element", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			// Verify they were attached
			const eventCount = audio._listeners.size;
			expect(eventCount).toBeGreaterThan(0);

			manager.detachNativeProxies(audio);

			// All native listeners should be removed
			for (const [, set] of audio._listeners) {
				expect(set.size).toBe(0);
			}
		});

		it("calls removeEventListener for each proxied event with matching event name", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const addCalls = (audio.addEventListener as ReturnType<typeof vi.fn>).mock.calls;
			expect(addCalls.length).toBeGreaterThan(0);

			manager.detachNativeProxies(audio);

			const removeCalls = (audio.removeEventListener as ReturnType<typeof vi.fn>).mock.calls;
			expect(removeCalls.length).toBe(addCalls.length);

			// Each remove call should match an add call by event name
			const addedEventNames = addCalls.map((call: unknown[]) => call[0] as string);
			const removedEventNames = removeCalls.map((call: unknown[]) => call[0] as string);
			expect(removedEventNames.sort()).toEqual(addedEventNames.sort());
		});

		it("no longer proxies native events after detaching", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const playHandler = vi.fn();
			manager.on("play", playHandler);

			manager.detachNativeProxies(audio);

			// Simulate the native event — but the proxy is gone
			simulateNativeEvent(audio, "play");

			// The synthetic handler should not have been called because
			// the native proxy was removed before the event.
			// (The handler on 'play' was never called because audio mock
			// no longer has the proxy listener)
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

			// Emitting should not call any handlers
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

	// ─── Integration: full lifecycle ───

	describe("full lifecycle", () => {
		it("attach → emit native proxy → detach → emit → no calls", () => {
			const audio = createAudioMock();
			manager.attachNativeProxies(audio);

			const playHandler = vi.fn();
			manager.on("play", playHandler);

			// Fire native event
			simulateNativeEvent(audio, "play", new Event("play"));
			expect(playHandler).toHaveBeenCalledOnce();

			// Detach native proxies
			manager.detachNativeProxies(audio);

			// Fire native event again — should not propagate
			simulateNativeEvent(audio, "play", new Event("play"));
			expect(playHandler).toHaveBeenCalledOnce(); // still only 1
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

			// Nothing should fire
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			manager.emit("trackchange", { previousIndex: -1, currentIndex: 0, track: null });
			simulateNativeEvent(audio, "play");

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	// ─── Type safety ───

	describe("type safety", () => {
		it("ensures on() handler matches event type (compile-time check)", () => {
			// This test verifies the type signatures compile correctly
			// Runtime behavior is covered by the other tests
			const playHandler = vi.fn((_e: CustomEvent<NativeEventDetail>) => {});
			const trackChangeHandler = vi.fn((_e: CustomEvent<TrackChangeDetail>) => {});
			const stopHandler = vi.fn((_e: CustomEvent) => {});

			manager.on("play", playHandler);
			manager.on("trackchange", trackChangeHandler);
			manager.on("stop", stopHandler);

			// Verify handlers are registered (runtime check)
			manager.emit("play", { nativeEvent: new Event("play") } as NativeEventDetail);
			manager.emit("trackchange", {
				previousIndex: -1,
				currentIndex: 0,
				track: null,
			} as TrackChangeDetail);
			manager.emit("stop");

			expect(playHandler).toHaveBeenCalledOnce();
			expect(trackChangeHandler).toHaveBeenCalledOnce();
			expect(stopHandler).toHaveBeenCalledOnce();
		});
	});
});
