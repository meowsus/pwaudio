import { PWAudio } from "pwaudio";
import type {
	Track,
	TrackChangeDetail,
	RepeatMode,
	ShuffleMode,
	StallDetail,
	RecoveryDetail,
} from "pwaudio";
import "../shared/style.css";
import { el, span, label } from "../shared/dom";
import { ALL_TRACKS, formatTime } from "../shared/tracks";
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

/** First 15 tracks — curated playlist */
const PLAYLIST_TRACKS: Track[] = ALL_TRACKS.slice(0, 15);

const player = new PWAudio({
	tracks: PLAYLIST_TRACKS,
	preload: "auto",
	repeat: "off",
	shuffle: "off",
	backgroundPlayback: true,
});

const app = document.getElementById("app")!;

// ─── Build UI ───

const backLink = el("a", { className: "back", href: "/pwaudio/", textContent: "← All demos" });
const h1 = el("h1", { textContent: "Curated Playlist" });
const subtitle = el("p", {
	className: "subtitle",
	textContent: "Navigate tracks, toggle shuffle, cycle repeat modes. Click any track to jump.",
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

const shuffleBtn = el("button", { id: "shuffle", textContent: "Shuffle: off" });
const repeatBtn = el("button", { id: "repeat", textContent: "Repeat: off" });
const modeControls = el("div", { className: "controls" }, shuffleBtn, repeatBtn);

const trackListTitle = el("h2", { className: "section-title", textContent: "Tracks" });
const trackListEl = el("ol", { className: "track-list", id: "track-list" });
const trackSection = el("div", { className: "section" }, trackListTitle, trackListEl);

const statusEl = el("div", { id: "status", className: "status", textContent: "Idle" });

app.append(
	backLink,
	h1,
	subtitle,
	nowPlaying,
	playbackControls,
	seekField,
	volumeField,
	modeControls,
	trackSection,
	statusEl,
);

// ─── Render track list ───

function renderTrackList() {
	const currentIdx = player.currentIndex;
	// Clear existing items
	while (trackListEl.firstChild) trackListEl.removeChild(trackListEl.firstChild);

	for (let i = 0; i < PLAYLIST_TRACKS.length; i++) {
		const t = PLAYLIST_TRACKS[i];
		if (!t) continue;
		const li = el("li", {
			className: i === currentIdx ? "track-item active" : "track-item",
			dataset: { index: String(i) },
		});
		const titleSpan = span("track-title", t.title ?? t.src);
		li.appendChild(titleSpan);
		if (t.artist) {
			const metaSpan = span("track-meta", ` — ${t.artist}`);
			li.appendChild(metaSpan);
		}
		li.addEventListener("click", () => {
			void player.goto(i);
		});
		trackListEl.appendChild(li);
	}
}

function updateNowPlaying() {
	const track = player.currentTrack;
	npTitle.textContent = track?.title ?? "—";
	const parts = [
		track?.artist ?? "",
		track?.album ?? "",
		`Track ${player.currentIndex + 1} / ${player.tracks.length}`,
	].filter(Boolean);
	npDetail.textContent = parts.join(" · ") || "No track loaded";
}

function updateShuffleButton() {
	const mode: ShuffleMode = player.shuffle;
	shuffleBtn.textContent = `Shuffle: ${mode}`;
	shuffleBtn.classList.toggle("active", mode === "on");
}

function updateRepeatButton() {
	const mode: RepeatMode = player.repeat;
	const labels: Record<RepeatMode, string> = { off: "off", one: "1", all: "all" };
	repeatBtn.textContent = `Repeat: ${labels[mode]}`;
	repeatBtn.classList.toggle("active", mode !== "off");
}

// ─── Wire controls ───

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

shuffleBtn.addEventListener("click", () => {
	player.shuffle = player.shuffle === "off" ? "on" : "off";
	updateShuffleButton();
});

repeatBtn.addEventListener("click", () => {
	const order: RepeatMode[] = ["off", "one", "all"];
	const next = order[(order.indexOf(player.repeat) + 1) % order.length];
	player.repeat = next;
	updateRepeatButton();
});

// ─── Events ───

player.on("timeupdate", () => {
	if (seeking) return;
	if (!isNaN(player.duration) && player.duration > 0) {
		seekInput.value = String((player.currentTime / player.duration) * 1000);
	}
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});

player.on("trackchange", (e: CustomEvent<TrackChangeDetail>) => {
	renderTrackList();
	updateNowPlaying();
	statusEl.textContent = `Track changed: index ${e.detail.previousIndex} → ${e.detail.currentIndex}`;
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
	statusEl.textContent = "Ended (repeat=off, last track)";
});
player.on("durationchange", () => {
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});
player.on("trackerror", (e) => {
	statusEl.textContent = `Track error: ${e.detail.error?.message ?? "unknown"} (index ${e.detail.index})`;
});
player.on("stall", (e: CustomEvent<StallDetail>) => {
	statusEl.textContent = `Playback stalled at ${formatTime(e.detail.currentTime)} (${e.detail.stalledFor.toFixed(1)}s)`;
});
player.on("recovery", (e: CustomEvent<RecoveryDetail>) => {
	statusEl.textContent = `Recovered (${e.detail.reason}) at ${formatTime(e.detail.currentTime)}`;
});

// First render
renderTrackList();
updateNowPlaying();
updateShuffleButton();
updateRepeatButton();
