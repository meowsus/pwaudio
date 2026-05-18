import "../shared/style.css";
import { el } from "../shared/dom";

const demos = [
	{
		href: "/pwaudio/single-track/",
		title: "Single-Track Player",
		description:
			"Play a single audio file with basic controls — play, pause, stop, volume, and seek. Simplest pwaudio usage.",
	},
	{
		href: "/pwaudio/playlist/",
		title: "Curated Playlist",
		description:
			"Navigate a track list with next/previous, jump to any track, toggle shuffle (Fisher-Yates), and cycle repeat modes (off → one → all).",
	},
	{
		href: "/pwaudio/radio/",
		title: "Radio / Random Session",
		description:
			"Each session generates a random set of tracks. Auto-advances through them. Hit 'New Session' for a fresh set. No caching — pure streaming.",
	},
	{
		href: "/pwaudio/podcast/",
		title: "Podcast / Audiobook",
		description:
			"Long-form playback with variable speed (0.5×–3×), pitch preservation toggle, and detailed progress tracking with time codes.",
	},
	{
		href: "/pwaudio/hybrid/",
		title: "Hybrid (Library + Radio)",
		description:
			"Switch between a curated library (cached with stale-while-revalidate) and a random radio session (uncached). Demonstrates dynamic playlist management.",
	},
];

const app = document.getElementById("app")!;
const h1 = el("h1", { textContent: "pwaudio" });
const subtitle = el("p", {
	className: "subtitle",
	textContent: "A headless audio player library for Progressive Web Applications",
});
const list = el("ul", { className: "demo-list" });

for (const d of demos) {
	const li = el(
		"li",
		{},
		el(
			"a",
			{ href: d.href },
			el("h3", { textContent: d.title }),
			el("p", { textContent: d.description }),
		),
	);
	list.appendChild(li);
}

app.append(h1, subtitle, list);
