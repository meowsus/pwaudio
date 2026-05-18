import { PWAudio } from "pwaudio";
import type { Track } from "pwaudio";
import "../shared/style.css";
import { el, span, label } from "../shared/dom";
import { pickRandom, formatTime } from "../shared/tracks";
import { registerSW } from "virtual:pwa-register";

const updateSW = registerSW({
	onNeedRefresh() {
		if (sessionStorage.getItem("pwaudio-update-dismissed")) return;
		if (confirm("New content available. Reload?")) {
			updateSW(true);
		} else {
			sessionStorage.setItem("pwaudio-update-dismissed", "1");
		}
	},
});

/** Generate a random radio session of 8 tracks */
function generateSession(): Track[] {
	return pickRandom(8);
}

const player = new PWAudio({
	tracks: generateSession(),
	preload: "auto",
	backgroundPlayback: true,
	repeat: "off",
});

const app = document.getElementById("app")!;

// ─── Build UI ───

const backLink = el("a", { className: "back", href: "/pwaudio/", textContent: "← All demos" });
const h1 = el("h1", { textContent: "Radio / Random Session" });
const subtitle = el("p", {
	className: "subtitle",
	textContent:
		"Each session is a random set of tracks. Auto-advances through them. Start a new session anytime.",
});

const npTitle = el("div", { className: "title", id: "np-title", textContent: "—" });
const npDetail = el("div", { className: "detail", id: "np-detail", textContent: "Waiting…" });
const nowPlaying = el("div", { className: "now-playing", id: "now-playing" }, npTitle, npDetail);

const playBtn = el("button", { id: "play", textContent: "▶ Play" });
const pauseBtn = el("button", { id: "pause", textContent: "⏸ Pause" });
const stopBtn = el("button", { id: "stop", textContent: "⏹ Stop" });
const playbackControls = el("div", { className: "controls" }, playBtn, pauseBtn, stopBtn);

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

const volumeInput = el("input", {
	id: "volume",
	type: "range",
	min: "0",
	max: "1",
	step: "0.01",
	value: "1",
});
const volumeField = el("div", { className: "field" }, label("Volume"), volumeInput);

const newSessionBtn = el("button", {
	id: "new-session",
	textContent: "🔄 New Session",
	style: "border-color:#e67e22;color:#e67e22;",
});
const sessionControls = el("div", { className: "controls" }, newSessionBtn);

const trackListTitle = el("h2", { className: "section-title", textContent: "Session Tracks" });
const note = el("p", {
	style: "font-size:0.8rem;color:#888;margin-bottom:0.5rem;",
	textContent: "Tracks are not cached — pure streaming each time.",
});
const trackListEl = el("ol", { className: "track-list", id: "track-list" });
const trackSection = el("div", { className: "section" }, trackListTitle, note, trackListEl);

const statusEl = el("div", { id: "status", className: "status", textContent: "Idle" });

app.append(
	backLink,
	h1,
	subtitle,
	nowPlaying,
	playbackControls,
	seekField,
	volumeField,
	sessionControls,
	trackSection,
	statusEl,
);

// ─── Render track list ───

function renderTrackList() {
	const tracks = player.tracks;
	const currentIdx = player.currentIndex;
	while (trackListEl.firstChild) trackListEl.removeChild(trackListEl.firstChild);

	for (let i = 0; i < tracks.length; i++) {
		const t = tracks[i];
		if (!t) continue;
		const li = el("li", {
			className: i === currentIdx ? "track-item active" : "track-item",
			dataset: { index: String(i) },
		});
		li.appendChild(span("track-title", `#${i + 1}: ${t.title ?? t.src}`));
		const idx = i;
		li.addEventListener("click", () => {
			void player.goto(idx);
		});
		trackListEl.appendChild(li);
	}
}

function updateNowPlaying() {
	const track = player.currentTrack;
	npTitle.textContent = track?.title ?? "—";
	npDetail.textContent = `Track ${player.currentIndex + 1} of ${player.tracks.length}`;
}

// ─── Wire controls ───

playBtn.addEventListener("click", () => void player.play());
pauseBtn.addEventListener("click", () => player.pause());
stopBtn.addEventListener("click", () => player.stop());

volumeInput.addEventListener("input", () => {
	player.volume = parseFloat(volumeInput.value);
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

newSessionBtn.addEventListener("click", () => {
	player.stop();
	player.tracks = generateSession();
	renderTrackList();
	updateNowPlaying();
	statusEl.textContent = "New session started — press Play";
});

// ─── Events ───

player.on("timeupdate", () => {
	if (seeking) return;
	if (!isNaN(player.duration) && player.duration > 0) {
		seekInput.value = String((player.currentTime / player.duration) * 1000);
	}
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});

player.on("trackchange", () => {
	renderTrackList();
	updateNowPlaying();
	statusEl.textContent = `Now playing track ${player.currentIndex + 1}`;
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
});
player.on("ended", () => {
	statusEl.textContent = "Session ended (last track, repeat=off)";
});
player.on("durationchange", () => {
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});
player.on("playlistchange", () => {
	renderTrackList();
	updateNowPlaying();
});

// First render
renderTrackList();
updateNowPlaying();
