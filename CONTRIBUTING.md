# Contributing to Soto

Thanks for your interest in contributing! Here's what you need to know.

## Before you start

- Search [open issues](https://github.com/cauyxy/sotoapp/issues) before filing a new one — duplicates slow everyone down.
- For significant changes (new features, architecture shifts), open an issue first to align on the approach before writing code.

## Development setup

Follow the [Development](README.md#development) section in the README to get a working local build.

Prerequisites:

- Shared: Node.js, pnpm 10.24+.
- macOS (only to rebuild the native dylib): macOS 14+ on Apple Silicon with Xcode 16+ / Swift 6+.
- Windows (only to rebuild the native DLL): Windows 11 x64 with the .NET 8 SDK Native AOT support.

Native package details live in [`native/macos/README.md`](native/macos/README.md)
and [`native/windows/README.md`](native/windows/README.md).
`pnpm build` runs the electron-vite build; signed macOS release builds use
`pnpm build:mac:signed` and the private files under `signing-secrets/`.

## Submitting a pull request

1. Fork the repo and create a branch from `master`.
2. Make your changes. Add pure-logic tests in `@soto/core` (`packages/core`) and vitest coverage for the Electron app (`apps/desktop`).
3. Ensure all checks pass locally before opening the PR:
   ```bash
   pnpm check
   pnpm test
   ```
4. Open a PR with a clear description of **what** changed and **why**.

## Code style

- **TypeScript:** strict TS throughout; pure logic lives in `@soto/core` and stays free of Electron/Node/native imports.
- **Comments:** only when the *why* is non-obvious (a hidden constraint, a subtle invariant, a platform workaround). Don't explain what the code does.

## Module boundaries

- **`@soto/core` is the single source of truth** for types and logic. Put new pure logic (chord/session/audio/provider/IPC schemas) here, not in the app — it must remain unit-testable with zero Electron/native deps.
- **The Electron app (`apps/desktop`) is the orchestration layer.** The main process owns the IPC router (`@soto/ipc`, the trust boundary), the Drizzle/better-sqlite3 store, the SessionController, and the `@soto/native-bridge` koffi bridge.
- **The renderer talks to main only through the per-command preload bridge** — no generic `ipcRenderer.invoke` from React. Each command has its own typed `contextBridge` method, validated main-side against the `@soto/ipc` command policy.
- **Native FFI stays in the main-process koffi bridge** — never import koffi or `.node` natives into `@soto/core` or the renderer.

## Reporting bugs

Please include:

- OS and version (e.g. macOS 15.3, Windows 11 23H2)
- Soto version (Settings → About)
- Steps to reproduce
- What you expected vs. what actually happened
