import { PWAudio } from "pwaudio";

const player = new PWAudio(
	"https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
);

const playBtn = document.getElementById("play")!;
const pauseBtn = document.getElementById("pause")!;
const volumeInput = document.getElementById("volume") as HTMLInputElement;
const seekInput = document.getElementById("seek") as HTMLInputElement;
const statusEl = document.getElementById("status")!;

playBtn.addEventListener("click", async () => {
	await player.play();
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
