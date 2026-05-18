import { defineConfig } from "vite";
import { resolve } from "node:path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	base: "/pwaudio/",
	resolve: {
		alias: {
			pwaudio: resolve(import.meta.dirname, "../../packages/pwaudio/src/index.ts"),
		},
	},
	server: {
		port: 3000,
		open: true,
	},
	build: {
		rollupOptions: {
			input: {
				index: resolve(__dirname, "index.html"),
				"single-track": resolve(__dirname, "single-track/index.html"),
				playlist: resolve(__dirname, "playlist/index.html"),
				radio: resolve(__dirname, "radio/index.html"),
				podcast: resolve(__dirname, "podcast/index.html"),
				hybrid: resolve(__dirname, "hybrid/index.html"),
			},
		},
	},
	plugins: [
		VitePWA({
			registerType: "prompt",
			includeAssets: ["favicon.svg"],
			manifest: {
				name: "pwaudio — Headless Audio Player",
				short_name: "pwaudio",
				description: "A headless audio player library for Progressive Web Applications",
				theme_color: "#632CC7",
				background_color: "#ffffff",
				display: "standalone",
				start_url: "/pwaudio/",
				icons: [
					{
						src: "pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
				navigateFallback: "/pwaudio/",
			},
			devOptions: {
				enabled: true,
			},
		}),
	],
});
