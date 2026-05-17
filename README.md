# pwaudio

A headless audio player library for Progressive Web Applications.

## Workspace Structure

```
pwaudio/
├── packages/
│   └── pwaudio/          # The library
│       ├── src/
│       │   ├── index.ts       # Library source
│       │   └── index.test.ts  # Tests
│       ├── tsup.config.ts     # Build config (ESM + CJS)
│       └── vitest.config.ts   # Test config (happy-dom)
├── apps/
│   └── demo/             # Vite + Vanilla TS demo app
│       ├── src/
│       │   └── main.ts        # Demo entry
│       ├── index.html
│       └── vite.config.ts
├── pnpm-workspace.yaml
├── tsconfig.json             # Base TypeScript config
└── package.json              # Workspace root
```

## Commands

| Command          | Description                   |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Start the Vite demo app       |
| `pnpm build`     | Build all workspace packages  |
| `pnpm test`      | Run tests across all packages |
| `pnpm typecheck` | Type-check all packages       |

## Development

```sh
# Install dependencies
pnpm install

# Start the demo app with hot reload
pnpm dev

# Run tests in watch mode
pnpm -C packages/pwaudio test:watch
```
