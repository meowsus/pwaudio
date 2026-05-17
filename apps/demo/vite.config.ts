import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			pwaudio: resolve(
				import.meta.dirname,
				"../../packages/pwaudio/src/index.ts",
			),
		},
	},
	server: {
		port: 3000,
		open: true,
	},
});
