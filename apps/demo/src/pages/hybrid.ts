import { PWAudio } from "pwaudio";
import type { Track } from "pwaudio";
import "../shared/style.css";
import { el, span, label } from "../shared/dom";
import { ALL_TRACKS, pickRandom, formatTime } from "../shared/tracks";
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

/** Library: curated tracks (simulating cached /library/ paths) */
const LIBRARY_TRACKS: Track[] = ALL_TRACKS.slice(0, 4).map((t, i) => ({
	...t,
	title: `Library Track ${i + 1}`,
}));

const player = new PWAudio({
	tracks: LIBRARY_TRACKS,
	preload: "auto",
	backgroundPlayback: true,
});

const app = document.getElementById("app")!;

// ─── State ───

type Mode = "library" | "radio";
let currentMode: Mode = "library";
let radioTracks: Track[] = [];
let sessionId = 0;

// ─── Build UI ───

const backLink = el("a", { className: "back", href: "/pwaudio/", textContent: "← All demos" });
const h1 = el("h1", { textContent: "Hybrid: Library + Radio" });
const subtitle = el("p", {
	className: "subtitle",
	textContent:
		"Switch between a curated library (stale-while-revalidate cached) and random radio sessions (uncached).",
});

const modeLibrary = el("button", {
	id: "mode-library",
	className: "active",
	textContent: "📚 Library",
});
const modeRadio = el("button", { id: "mode-radio", textContent: "📻 Radio" });
const modeControls = el(
	"div",
	{ className: "controls", style: "margin-bottom:1rem;" },
	modeLibrary,
	modeRadio,
);

const modeInfo = el("div", {
	id: "mode-info",
	className: "status",
	style: "font-size:0.8rem;margin-bottom:1rem;",
	textContent: "Library mode — tracks are cached with stale-while-revalidate for instant replay.",
});

const npTitle = el("div", { className: "title", id: "np-title", textContent: "—" });
const npDetail = el("div", {
	className: "detail",
	id: "np-detail",
	textContent: "No track loaded",
});
const nowPlaying = el("div", { className: "now-playing", id: "now-playing" }, npTitle, npDetail);

const prevBtn = el("button", { id: "prev", textContent: "⏮ Prev" });
const playBtn = el("button", { id: "play", textContent: "▶ Play" });
const pauseBtn = el("button", { id: "pause", textContent: "⏸ Pause" });
const stopBtn = el("button", { id: "stop", textContent: "⏹ Stop" });
const nextBtn = el("button", { id: "next", textContent: "⏭ Next" });
const playbackControls = el(
	"div",
	{ className: "controls" },
	prevBtn,
	playBtn,
	pauseBtn,
	stopBtn,
	nextBtn,
);

const timeDisplay = el("span", { id: "time-display", textContent: "0:00 / --:--" });
const seekInput = el("input", {
	id: "seek",
	type: "range",
	min: "0",
	max: "1000",
	step: "1",
	value: "0",
});
const seekField = el("div", { className: "field" }, label("", timeDisplay), seekInput);

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
	textContent: "🔄 New Radio Session",
	style: "border-color:#e67e22;color:#e67e22;",
});
const radioControls = el(
	"div",
	{ id: "radio-controls", className: "controls", style: "display:none;" },
	newSessionBtn,
);

const listTitle = el("h2", {
	className: "section-title",
	id: "list-title",
	textContent: "Library",
});
const trackListEl = el("ol", { className: "track-list", id: "track-list" });
const trackSection = el("div", { className: "section" }, listTitle, trackListEl);

const statusEl = el("div", { id: "status", className: "status", textContent: "Idle" });

app.append(
	backLink,
	h1,
	subtitle,
	modeControls,
	modeInfo,
	nowPlaying,
	playbackControls,
	seekField,
	volumeField,
	radioControls,
	trackSection,
	statusEl,
);

// ─── Mode switching ───

function switchMode(mode: Mode) {
	if (mode === currentMode) return;

	player.stop();
	currentMode = mode;

	if (mode === "library") {
		player.tracks = LIBRARY_TRACKS;
		modeLibrary.classList.add("active");
		modeRadio.classList.remove("active");
		radioControls.style.display = "none";
		modeInfo.textContent =
			"Library mode — tracks are cached with stale-while-revalidate for instant replay.";
		listTitle.textContent = "Library";
	} else {
		sessionId++;
		radioTracks = pickRandom(6).map((t, i) => ({ ...t, title: `Radio #${sessionId}-${i + 1}` }));
		player.tracks = radioTracks;
		modeRadio.classList.add("active");
		modeLibrary.classList.remove("active");
		radioControls.style.display = "";
		modeInfo.textContent = "Radio mode — tracks are NOT cached. Pure streaming each time.";
		listTitle.textContent = "Radio Session";
	}

	renderTrackList();
	updateNowPlaying();
	statusEl.textContent = `Switched to ${mode} mode`;
}

modeLibrary.addEventListener("click", () => switchMode("library"));
modeRadio.addEventListener("click", () => switchMode("radio"));

newSessionBtn.addEventListener("click", () => {
	if (currentMode !== "radio") return;
	player.stop();
	sessionId++;
	radioTracks = pickRandom(6).map((t, i) => ({ ...t, title: `Radio #${sessionId}-${i + 1}` }));
	player.tracks = radioTracks;
	renderTrackList();
	updateNowPlaying();
	statusEl.textContent = "New radio session loaded";
});

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
		li.appendChild(span("track-title", t.title ?? t.src));
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
	npDetail.textContent = `${currentMode} · track ${player.currentIndex + 1} of ${player.tracks.length}`;
}

// ─── Basic controls ───

playBtn.addEventListener("click", () => void player.play());
pauseBtn.addEventListener("click", () => player.pause());
stopBtn.addEventListener("click", () => player.stop());
prevBtn.addEventListener("click", () => void player.previous());
nextBtn.addEventListener("click", () => void player.next());

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
	statusEl.textContent = "Ended";
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
