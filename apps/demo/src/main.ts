import { PWAudio } from "pwaudio";
import { registerSW } from "virtual:pwa-register";

// Register service worker for PWA
const updateSW = registerSW({
	onNeedRefresh() {
		if (confirm("New content available. Reload to update?")) {
			void updateSW(true);
		}
	},
	onOfflineReady() {
		console.log("App ready to work offline");
	},
});

// Request persistent storage to protect cached audio from eviction
void navigator.storage.persist().then((granted) => {
	if (granted) {
		console.log("Persistent storage granted — cache protected from eviction");
	} else {
		console.log("Persistent storage denied — browser may evict cache under pressure");
	}
});

const player = new PWAudio({
	src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
});

const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const volumeInput = document.getElementById("volume") as HTMLInputElement | null;
const seekInput = document.getElementById("seek") as HTMLInputElement | null;
const statusEl = document.getElementById("status");

if (!playBtn || !pauseBtn || !volumeInput || !seekInput || !statusEl) {
	throw new Error("Required DOM elements not found");
}

playBtn.addEventListener("click", () => {
	void player.play();
	statusEl.textContent = "Playing";
});

pauseBtn.addEventListener("click", () => {
	player.pause();
	statusEl.textContent = "Paused";
});

volumeInput.addEventListener("input", () => {
	player.volume = parseFloat(volumeInput.value);
});

seekInput.addEventListener("input", () => {
	if (!isNaN(player.duration)) {
		player.currentTime = (parseFloat(seekInput.value) / 100) * player.duration;
	}
});

player.on("timeupdate", () => {
	if (!isNaN(player.duration)) {
		seekInput.value = String((player.currentTime / player.duration) * 100);
	}
});

player.on("ended", () => {
	statusEl.textContent = "Ended";
});

player.on("error", () => {
	statusEl.textContent = "Error loading audio";
});
