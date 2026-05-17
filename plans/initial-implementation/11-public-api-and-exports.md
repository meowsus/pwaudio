# Plan 11: Public API & Exports

## Objective

Wire up the public `index.ts` entry point to re-export all public symbols from the internal modules. Verify that the export map in `package.json` matches the design document. Ensure the build produces correct ESM and CJS outputs with types.

## File to Modify

### `packages/pwaudio/src/index.ts`

Replace the current stub with proper re-exports:

```ts
// pwaudio — A headless audio player library for Progressive Web Applications

export { PWAudio } from "./PWAudio";

export type {
	Track,
	PWAudioOptions,
	PlayerEvent,
	PlayerEventHandlerMap,
	RepeatMode,
	ShuffleMode,
	PreloadStrategy,
	TrackChangeDetail,
	PlaylistChangeDetail,
	MediaCardChangeDetail,
	TrackErrorDetail,
	NativeEventDetail,
} from "./types";
```

**Note**: Only the symbols listed in the export map above should be exported. Internal modules (`events.ts`, `shuffle.ts`, `media-session.ts`, `constants.ts`, `utils.ts`) must **not** be re-exported. They are implementation details.

### `packages/pwaudio/package.json`

The existing `package.json` already has the correct export map from the design document. Verify it matches:

```json
{
	"exports": {
		".": {
			"import": {
				"types": "./dist/index.d.ts",
				"default": "./dist/index.js"
			},
			"require": {
				"types": "./dist/index.d.cts",
				"default": "./dist/index.cjs"
			}
		}
	}
}
```

### `packages/pwaudio/tsup.config.ts`

Verify the build config produces both ESM and CJS with declaration files:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
});
```

This is already correct — no change needed.

### `packages/pwaudio/tsconfig.json`

Verify the TypeScript config includes all source files:

```json
{
	"extends": "../../tsconfig.json",
	"compilerOptions": {
		"outDir": "./dist",
		"rootDir": "./src",
		"ignoreDeprecations": "6.0"
	},
	"include": ["src"]
}
```

This is already correct — no change needed.

## Build Verification

After all previous plans are implemented:

```bash
# From the workspace root
pnpm -C packages/pwaudio build
```

This should produce:

```
packages/pwaudio/dist/
├── index.js          # ESM bundle
├── index.cjs         # CJS bundle
├── index.d.ts        # ESM type declarations
├── index.d.cts       # CJS type declarations
├── index.js.map      # ESM source map
└── index.cjs.map     # CJS source map
```

## Type-Checking Verification

```bash
pnpm -C packages/pwaudio typecheck
```

Should produce zero errors.

## Import Verification

Verify that consumers can import the library correctly:

```ts
// ESM
import { PWAudio } from "pwaudio";
import type { Track, PWAudioOptions, PlayerEvent } from "pwaudio";

// CJS
const { PWAudio } = require("pwaudio");
```

Both should work without errors.

## Verify Export Completeness

The public API surface per DESIGN.md §9 is:

- `PWAudio` (class)
- `Track` (interface)
- `PWAudioOptions` (interface)
- `PlayerEvent` (union type)
- `PlayerEventHandlerMap` (interface)
- `RepeatMode` (union type)
- `ShuffleMode` (union type)
- `PreloadStrategy` (union type)
- `TrackChangeDetail` (interface)
- `PlaylistChangeDetail` (interface)
- `MediaCardChangeDetail` (interface)
- `TrackErrorDetail` (interface)
- `NativeEventDetail` (interface)

No other symbols should be exported from `index.ts`.

## File Structure After All Plans

```
packages/pwaudio/src/
├── index.ts              # Public API, re-exports
├── PWAudio.ts            # Main class
├── types.ts              # Track, PWAudioOptions, PlayerEvent, etc.
├── events.ts             # Event proxy & synthetic event system
├── shuffle.ts            # Fisher-Yates shuffle + history manager
├── media-session.ts      # Media Session API integration
├── constants.ts          # Defaults, limits
└── utils.ts              # clamp, isFiniteDuration, etc.
```

## Remove the Old Test File

The existing `packages/pwaudio/src/index.test.ts` should be removed — it tests the old stub implementation. The comprehensive test suite is created in Plan 12.

## Verification

1. `pnpm -C packages/pwaudio build` succeeds and produces all expected output files.
2. `pnpm -C packages/pwaudio typecheck` passes with zero errors.
3. Only the 13 public symbols listed above are exported from `index.ts`.
4. ESM import works: `import { PWAudio, type Track } from "pwaudio"`.
5. CJS require works: `const { PWAudio } = require("pwaudio")`.
6. Internal modules (`EventManager`, `ShuffleManager`, `MediaSessionManager`, constants, utils) are not accessible from the public API.
7. The build output includes `.d.ts` and `.d.cts` declaration files.
8. Source maps are generated for both ESM and CJS bundles.
