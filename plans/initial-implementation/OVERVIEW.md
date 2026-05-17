# pwaudio — Initial Implementation Plans

This directory contains 12 independently-actionable implementation plans for building the `pwaudio` library from its current stub state to the full design specified in `DESIGN.md`.

## Current State

The library exists as a minimal skeleton in `packages/pwaudio/src/index.ts` — a single-file class that wraps `HTMLAudioElement` with basic `play`/`pause`/`src`/`volume`/`muted` support and untyped `on`/`off` event delegation. It lacks playlists, shuffle, repeat, Media Session, typed events, concurrency guards, destroy semantics, and error handling.

The existing test file (`packages/pwaudio/src/index.test.ts`) covers only the stub behavior and will need to be replaced.

## Target State

A fully-featured, typed, headless audio player library matching `DESIGN.md`, with:

- Immutable playlist model with next/previous/goto navigation
- Fisher-Yates shuffle with history
- Repeat modes (off/one/all)
- Media Session API integration
- Typed CustomEvent system with native proxy
- Play-generation concurrency guard
- Error handling with `trackerror` synthetic events
- Platform quirk mitigation (preservesPitch prefix, autoplay policy, position state throttling)
- Full `destroy()` lifecycle
- Dual ESM/CJS build via tsup
- Comprehensive test suite via vitest

## Plan Index

Plans are ordered by dependency — each plan assumes the outputs of its predecessors exist.

| #   | Plan                                                 | Files Created/Modified                                  | Dependencies |
| --- | ---------------------------------------------------- | ------------------------------------------------------- | ------------ |
| 01  | [Types & Constants](01-types-and-constants.md)       | `types.ts`, `constants.ts`, `utils.ts`                  | None         |
| 02  | [Event System](02-event-system.md)                   | `events.ts`                                             | Plan 01      |
| 03  | [Core Playback](03-core-playback.md)                 | `PWAudio.ts` (constructor, play/pause/stop, properties) | Plans 01–02  |
| 04  | [Playlist Engine](04-playlist-engine.md)             | `PWAudio.ts` (tracks, next, previous, goto, loadTrack)  | Plan 03      |
| 05  | [Shuffle & Repeat](05-shuffle-and-repeat.md)         | `shuffle.ts`, `PWAudio.ts` (shuffle/repeat logic)       | Plan 04      |
| 06  | [Concurrency Guard](06-concurrency-guard.md)         | `PWAudio.ts` (play-generation counter)                  | Plan 04      |
| 07  | [Media Session](07-media-session.md)                 | `media-session.ts`, `PWAudio.ts` (media session wiring) | Plan 05      |
| 08  | [Error Handling](08-error-handling.md)               | `PWAudio.ts` (trackerror, empty-playlist, handleError)  | Plan 03      |
| 09  | [Platform Quirks](09-platform-quirks.md)             | `PWAudio.ts` (preservesPitch, preload, clamping, state) | Plan 03      |
| 10  | [Destroy & Lifecycle](10-destroy-lifecycle.md)       | `PWAudio.ts` (destroy, post-destroy guards)             | Plans 03–09  |
| 11  | [Public API & Exports](11-public-api-and-exports.md) | `index.ts`, `package.json`                              | Plans 01–10  |
| 12  | [Test Suite](12-test-suite.md)                       | `src/__tests__/*.test.ts`                               | Plans 01–11  |

## Dependency Graph

```
01-types-and-constants
└── 02-event-system
    └── 03-core-playback
        ├── 04-playlist-engine
        │   ├── 05-shuffle-and-repeat
        │   │   └── 07-media-session
        │   └── 06-concurrency-guard
        ├── 08-error-handling
        └── 09-platform-quirks
            └── 10-destroy-lifecycle
                └── 11-public-api-and-exports
                    └── 12-test-suite
```

## Execution Strategy

Plans 05+06 can be **parallelized** since they touch different internal concerns (shuffle/repeat vs. concurrency guard). Plans 08+09 can also be **parallelized** (error handling vs. platform quirks). All other plans should be executed sequentially.

For maximum safety, execute in order 01→02→03→04→(05∥06)→07→(08∥09)→10→11→12.

## Conventions

- All source lives under `packages/pwaudio/src/`
- The library uses **private fields** (`#field`) exclusively — no `private` keyword
- All events are `CustomEvent` dispatched on the `PWAudio` instance (which extends no class, but uses `EventTarget`-style listener management)
- TypeScript `strict: true` — no `any`, no non-null assertions without justification
- Tests use `vitest` with `happy-dom` environment
- Build uses `tsup` configured for ESM + CJS dual output
