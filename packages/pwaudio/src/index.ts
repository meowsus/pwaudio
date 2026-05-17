/**
 * pwaudio — A headless audio player library for Progressive Web Applications
 */

export class PWAudio {
	private audio: HTMLAudioElement;

	constructor(src?: string) {
		this.audio = new Audio();
		if (src) this.audio.src = src;
	}

	public get src(): string {
		return this.audio.src;
	}

	public set src(value: string) {
		this.audio.src = value;
	}

	public play(): Promise<void> {
		return this.audio.play();
	}

	public pause(): void {
		this.audio.pause();
	}

	public get paused(): boolean {
		return this.audio.paused;
	}

	public get duration(): number {
		return this.audio.duration;
	}

	public get currentTime(): number {
		return this.audio.currentTime;
	}

	public set currentTime(value: number) {
		this.audio.currentTime = value;
	}

	public get volume(): number {
		return this.audio.volume;
	}

	public set volume(value: number) {
		this.audio.volume = value;
	}

	public get muted(): boolean {
		return this.audio.muted;
	}

	public set muted(value: boolean) {
		this.audio.muted = value;
	}

	public on(event: string, handler: EventListener): void {
		this.audio.addEventListener(event, handler);
	}

	public off(event: string, handler: EventListener): void {
		this.audio.removeEventListener(event, handler);
	}
}
