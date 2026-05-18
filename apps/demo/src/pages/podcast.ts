import { PWAudio } from "pwaudio";
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

/** Use longer SoundHelix tracks to simulate podcast/audiobook episodes */
const EPISODES = ALL_TRACKS.slice(0, 3).map((t, i) => ({
	...t,
	title: `Episode ${i + 1}: The Sound of Helix`,
	artist: "Demo Podcast",
	album: "Season 1",
}));

const player = new PWAudio({
	tracks: EPISODES,
	preload: "auto",
	backgroundPlayback: true,
	playbackRate: 1,
});

const app = document.getElementById("app")!;

// ─── Build UI ───

const backLink = el("a", { className: "back", href: "/pwaudio/", textContent: "← All demos" });
const h1 = el("h1", { textContent: "Podcast / Audiobook" });
const subtitle = el("p", {
	className: "subtitle",
	textContent: "Long-form playback with variable speed, pitch control, and chapter navigation.",
});

const npTitle = el("div", { className: "title", id: "np-title", textContent: "—" });
const npDetail = el("div", {
	className: "detail",
	id: "np-detail",
	textContent: "No episode loaded",
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

// ─── Speed section ───
const speedTitle = el("h2", { className: "section-title", textContent: "Playback Speed" });
const rateButtons = [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((r) =>
	el("button", {
		className: r === 1 ? "active" : "",
		textContent: `${r}×`,
		dataType: "rate",
		dataset: { rate: String(r) },
	}),
);
const rateControls = el("div", { className: "controls" }, ...rateButtons);

const rateVal = el("span", { id: "rate-val", textContent: "1.00" });
const rateInput = el("input", {
	id: "rate",
	type: "range",
	min: "0.25",
	max: "4",
	step: "0.25",
	value: "1",
});
const rateField = el(
	"div",
	{ className: "field", style: "margin-top:0.5rem;" },
	label("Playback rate: ", rateVal),
	rateInput,
);

const pitchBtn = el("button", { id: "pitch", textContent: "On" });
const pitchField = el("div", { className: "field" }, label("Preserves pitch"), pitchBtn);

const speedSection = el(
	"div",
	{ className: "section" },
	speedTitle,
	rateControls,
	rateField,
	pitchField,
);

// ─── Progress section ───
const progressTitle = el("h2", { className: "section-title", textContent: "Progress" });
const timeDisplay = el("span", { id: "time-display", textContent: "0:00:00 / --:--:--" });
const seekInput = el("input", {
	id: "seek",
	type: "range",
	min: "0",
	max: "10000",
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

const back30 = el("button", { id: "back30", textContent: "⏪ 30s" });
const back10 = el("button", { id: "back10", textContent: "⏪ 10s" });
const fwd10 = el("button", { id: "fwd10", textContent: "10s ⏩" });
const fwd30 = el("button", { id: "fwd30", textContent: "30s ⏩" });
const jumpLabel = label("Jump forward/back");
const jumpControls = el("div", { className: "controls" }, back30, back10, fwd10, fwd30);
const jumpField = el("div", { className: "field" }, jumpLabel, jumpControls);

const progressSection = el(
	"div",
	{ className: "section" },
	progressTitle,
	seekField,
	volumeField,
	jumpField,
);

// ─── Episode list ───
const episodeTitle = el("h2", { className: "section-title", textContent: "Episodes" });
const episodeList = el("ol", { className: "track-list", id: "episode-list" });
const episodeSection = el("div", { className: "section" }, episodeTitle, episodeList);

const statusEl = el("div", { id: "status", className: "status", textContent: "Idle" });

app.append(
	backLink,
	h1,
	subtitle,
	nowPlaying,
	playbackControls,
	speedSection,
	progressSection,
	episodeSection,
	statusEl,
);

// ─── Speed buttons ───

function updateSpeedButtons(rate: number) {
	for (const btn of rateButtons) {
		btn.classList.toggle("active", parseFloat(btn.dataset.rate ?? "0") === rate);
	}
}

for (const btn of rateButtons) {
	btn.addEventListener("click", () => {
		const rate = parseFloat(btn.dataset.rate ?? "1");
		player.playbackRate = rate;
		rateInput.value = String(rate);
		rateVal.textContent = rate.toFixed(2);
		updateSpeedButtons(rate);
	});
}

rateInput.addEventListener("input", () => {
	const rate = parseFloat(rateInput.value);
	player.playbackRate = rate;
	rateVal.textContent = rate.toFixed(2);
	updateSpeedButtons(rate);
});

pitchBtn.addEventListener("click", () => {
	player.preservesPitch = !player.preservesPitch;
	pitchBtn.textContent = player.preservesPitch ? "On" : "Off";
	pitchBtn.classList.toggle("active", !player.preservesPitch);
});

// ─── Jump buttons ───

back30.addEventListener("click", () => {
	player.currentTime = Math.max(0, player.currentTime - 30);
});
back10.addEventListener("click", () => {
	player.currentTime = Math.max(0, player.currentTime - 10);
});
fwd10.addEventListener("click", () => {
	player.currentTime = Math.min(player.duration || 0, player.currentTime + 10);
});
fwd30.addEventListener("click", () => {
	player.currentTime = Math.min(player.duration || 0, player.currentTime + 30);
});

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
		player.currentTime = (parseFloat(seekInput.value) / 10000) * player.duration;
	}
});

// ─── Render episode list ───

function renderEpisodeList() {
	const currentIdx = player.currentIndex;
	while (episodeList.firstChild) episodeList.removeChild(episodeList.firstChild);

	for (let i = 0; i < EPISODES.length; i++) {
		const t = EPISODES[i];
		if (!t) continue;
		const li = el("li", {
			className: i === currentIdx ? "track-item active" : "track-item",
			dataset: { index: String(i) },
		});
		li.appendChild(span("track-title", t.title));
		if (t.artist) li.appendChild(span("track-meta", ` — ${t.artist}`));
		const idx = i;
		li.addEventListener("click", () => {
			void player.goto(idx);
		});
		episodeList.appendChild(li);
	}
}

function updateNowPlaying() {
	const track = player.currentTrack;
	npTitle.textContent = track?.title ?? "—";
	npDetail.textContent = track?.artist ?? "No episode loaded";
}

// ─── Events ───

player.on("timeupdate", () => {
	if (seeking) return;
	if (!isNaN(player.duration) && player.duration > 0) {
		seekInput.value = String((player.currentTime / player.duration) * 10000);
	}
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});

player.on("trackchange", () => {
	renderEpisodeList();
	updateNowPlaying();
	statusEl.textContent = `Episode changed to ${player.currentIndex + 1}`;
});

player.on("play", () => {
	statusEl.textContent = `Playing at ${player.playbackRate}×`;
});
player.on("pause", () => {
	statusEl.textContent = "Paused";
});
player.on("stop", () => {
	statusEl.textContent = "Stopped";
	seekInput.value = "0";
});
player.on("ended", () => {
	statusEl.textContent = "Episode ended";
});
player.on("durationchange", () => {
	timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
});
player.on("ratechange", () => {
	rateVal.textContent = player.playbackRate.toFixed(2);
	rateInput.value = String(player.playbackRate);
	updateSpeedButtons(player.playbackRate);
});

// First render
renderEpisodeList();
updateNowPlaying();
