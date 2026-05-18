import { PWAudio } from "pwaudio";
import "../shared/style.css";
import { el, label } from "../shared/dom";
import { formatTime } from "../shared/tracks";
import { registerSW } from "virtual:pwa-register";

registerSW({
	onNeedRefresh() {
		if (confirm("New content available. Reload?")) window.location.reload();
	},
});

const player = new PWAudio({
	src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
	preload: "auto",
	backgroundPlayback: true,
});

const app = document.getElementById("app")!;

// ─── Build UI ───

const backLink = el("a", { className: "back", href: "/pwaudio/", textContent: "← All demos" });
const h1 = el("h1", { textContent: "Single-Track Player" });
const subtitle = el("p", {
	className: "subtitle",
	textContent: "Basic play/pause/stop, volume, and seek — the simplest pwaudio usage.",
});

const playBtn = el("button", { id: "play", textContent: "▶ Play" });
const pauseBtn = el("button", { id: "pause", textContent: "⏸ Pause" });
const stopBtn = el("button", { id: "stop", textContent: "⏹ Stop" });
const controls = el("div", { className: "controls" }, playBtn, pauseBtn, stopBtn);

const volVal = el("span", { id: "vol-val", textContent: "1.00" });
const volumeInput = el("input", {
	id: "volume",
	type: "range",
	min: "0",
	max: "1",
	step: "0.01",
	value: "1",
});
const volumeField = el("div", { className: "field" }, label("Volume — ", volVal), volumeInput);

const muteBtn = el("button", { id: "mute", textContent: "Unmuted" });
const muteField = el("div", { className: "field" }, label("Mute"), muteBtn);

const timeDisplay = el("span", { id: "time-display", textContent: "0:00 / --:--" });
const seekInput = el("input", {
	id: "seek",
	type: "range",
	min: "0",
	max: "1000",
	step: "1",
	value: "0",
});
const seekField = el("div", { className: "field" }, label("Seek — ", timeDisplay), seekInput);

const statusEl = el("div", { id: "status", className: "status", textContent: "Idle" });

app.append(backLink, h1, subtitle, controls, volumeField, muteField, seekField, statusEl);

// ─── Wire controls ───

playBtn.addEventListener("click", () => {
	void player.play();
});
pauseBtn.addEventListener("click", () => {
	player.pause();
});
stopBtn.addEventListener("click", () => {
	player.stop();
});

volumeInput.addEventListener("input", () => {
	player.volume = parseFloat(volumeInput.value);
	volVal.textContent = player.volume.toFixed(2);
});

muteBtn.addEventListener("click", () => {
	player.muted = !player.muted;
	muteBtn.textContent = player.muted ? "Muted" : "Unmuted";
});

let seeking = false;
seekInput.addEventListener("mousedown", () => {
	seeking = true;
});
seekInput.addEventListener("mouseup", () => {
	seeking = false;
});
seekInput.addEventListener("input", () => {
	if (!isNaN(player.duration)) {
		player.currentTime = (parseFloat(seekInput.value) / 1000) * player.duration;
	}
});

function updateSeekBar() {
	if (seeking) return;
	if (!isNaN(player.duration) && player.duration > 0) {
		seekInput.value = String((player.currentTime / player.duration) * 1000);
	}
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
}

// ─── Events ───

player.on("timeupdate", () => {
	updateSeekBar();
	const state = player.playing
		? "Playing"
		: player.paused
			? "Paused"
			: player.stopped
				? "Stopped"
				: player.ended
					? "Ended"
					: "Idle";
	statusEl.textContent = `${state} | src: ${player.src.slice(-35)}`;
});

player.on("play", () => {
	statusEl.textContent = "Playing";
});
player.on("pause", () => {
	statusEl.textContent = "Paused";
});
player.on("stop", () => {
	statusEl.textContent = "Stopped";
	seekInput.value = "0";
	timeDisplay.textContent = `0:00 / ${formatTime(player.duration)}`;
});
player.on("ended", () => {
	statusEl.textContent = "Ended";
});
player.on("durationchange", () => {
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});
player.on("error", () => {
	statusEl.textContent = "Error loading audio";
});
player.on("trackerror", (e) => {
	statusEl.textContent = `Track error: ${e.detail.error?.message ?? "unknown"} (index ${e.detail.index})`;
});
