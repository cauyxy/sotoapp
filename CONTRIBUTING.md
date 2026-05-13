# Contributing to Soto

Thanks for your interest in contributing! Here's what you need to know.

## Before you start

- Search [open issues](https://github.com/cauyxy/sotoapp/issues) before filing a new one — duplicates slow everyone down.
- For significant changes (new features, architecture shifts), open an issue first to align on the approach before writing code.

## Development setup

Follow the [Development](README.md#development) section in the README to get a working local build.

## Submitting a pull request

1. Fork the repo and create a branch from `master`.
2. Make your changes. Add tests for new logic in `crates/` and vitest coverage for frontend behavior.
3. Ensure all checks pass locally before opening the PR:
   ```bash
   cargo test --workspace
   cargo clippy --all-targets -- -D warnings
   pnpm test
   pnpm --filter @soto/desktop check
   ```
4. Open a PR with a clear description of **what** changed and **why**.

## Code style

- **Rust:** `rustfmt` defaults, Clippy clean (`-D warnings`).
- **TypeScript/Svelte:** Svelte 5 runes throughout — use `$state`, `$derived`, `$effect`, `$props`. No legacy `$:` reactive blocks.
- **Comments:** only when the *why* is non-obvious (a hidden constraint, a subtle invariant, a platform workaround). Don't explain what the code does.

## Module and crate boundaries

**Backend:**
- Each `soto-*` crate has a focused responsibility — keep new logic in the right crate rather than piling things into `soto-tauri`.
- `soto-tauri` is the Tauri wiring layer; business logic belongs in the domain crates.

**Frontend:**
- `features/X/` must not import from `features/Y/` — share via `shared/`.
- Pages must not call `invoke()` directly — always go through an `*.ipc.ts` wrapper.
- New Tauri commands start as a feature-local `<topic>.ipc.ts` next to the consumer. Promote to `ipc/<topic>.ts` only once a second feature needs it.

**Tauri ACL:** any new `@tauri-apps/api/*` call needs a corresponding entry in `apps/desktop/src-tauri/capabilities/main.json`. Custom `invoke_handler` commands are not ACL-gated.

## Reporting bugs

Please include:

- OS and version (e.g. macOS 15.3, Windows 11 23H2)
- Soto version (Settings → About)
- Steps to reproduce
- What you expected vs. what actually happened
