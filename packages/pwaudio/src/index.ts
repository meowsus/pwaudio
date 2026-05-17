/**
 * pwaudio — A headless audio player library for Progressive Web Applications
 */

export class PWAudio {
	private audio: HTMLAudioElement;

	constructor(src?: string) {
		this.audio = new Audio();
		if (src) this.audio.src = src;
	}

	get src(): string {
		return this.audio.src;
	}

	set src(value: string) {
		this.audio.src = value;
	}

	play(): Promise<void> {
		return this.audio.play();
	}

	pause(): void {
		this.audio.pause();
	}

	get paused(): boolean {
		return this.audio.paused;
	}

	get duration(): number {
		return this.audio.duration;
	}

	get currentTime(): number {
		return this.audio.currentTime;
	}

	set currentTime(value: number) {
		this.audio.currentTime = value;
	}

	get volume(): number {
		return this.audio.volume;
	}

	set volume(value: number) {
		this.audio.volume = value;
	}

	get muted(): boolean {
		return this.audio.muted;
	}

	set muted(value: boolean) {
		this.audio.muted = value;
	}

	on(event: string, handler: EventListener): void {
		this.audio.addEventListener(event, handler);
	}

	off(event: string, handler: EventListener): void {
		this.audio.removeEventListener(event, handler);
	}
}
