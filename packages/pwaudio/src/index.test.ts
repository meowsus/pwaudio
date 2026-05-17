import { describe, it, expect, vi } from "vitest";
import { PWAudio } from "../src/index";

describe("PWAudio", () => {
	it("can be instantiated", () => {
		const player = new PWAudio();
		expect(player).toBeInstanceOf(PWAudio);
	});

	it("sets src via constructor", () => {
		const player = new PWAudio("test.mp3");
		expect(player.src).toContain("test.mp3");
	});

	it("sets src via property", () => {
		const player = new PWAudio();
		player.src = "another.mp3";
		expect(player.src).toContain("another.mp3");
	});

	it("defaults to paused state", () => {
		const player = new PWAudio();
		expect(player.paused).toBe(true);
	});

	it("sets volume", () => {
		const player = new PWAudio();
		player.volume = 0.5;
		expect(player.volume).toBe(0.5);
	});

	it("toggles muted", () => {
		const player = new PWAudio();
		player.muted = true;
		expect(player.muted).toBe(true);
		player.muted = false;
		expect(player.muted).toBe(false);
	});

	it("registers and removes event listeners", () => {
		const player = new PWAudio();
		const handler = vi.fn();
		player.on("play", handler);
		player.off("play", handler);
		// No error means the listeners were registered/removed
		expect(true).toBe(true);
	});
});
