# Project Rules

- **Package manager is pnpm** — always `pnpm <cmd>`; never `npm` or `yarn`. If `pnpm` is missing, enable with `corepack enable`.
- **Frontend is Svelte 5 runes mode** — use `$state`, `$effect`, `$derived`, `$props`. Do not write React-style hooks or use React-DNA names like `getSnapshot`/`setSnapshot`.
- In Svelte components, do not hide `$store` reads needed by a reactive expression inside a helper function — Svelte only tracks direct dependencies in `$:` blocks, so wrapping them leaves derived state stuck at its initial value.
- Do not call `invoke()` from a page directly — route through the feature's `*.ipc.ts` wrapper. Feature-private IPC lives next to its consumer; IPC shared by 2+ features lives in `src/ipc/<topic>.ts`.
- Do not reach across features — share only via `shared/`.
- Do not launch the Tauri GUI on the user's desktop without asking, even with autonomy granted.
- **Tauri 2 ACL is default-deny for plugin commands.** If a `@tauri-apps/api/*` call silently fails, check DevTools for "permission denied" and add the permission to the matching capability file under `src-tauri/capabilities/`. Custom commands registered via `invoke_handler()` are NOT ACL-gated.
- **Tauri platform config arrays are replaced wholesale** (RFC 7396 JSON Merge Patch: arrays are not deep-merged). To override one field on one window in a platform override file, redefine the entire `app.windows` array.
- Choose verification proportional to the change:
  - Docs-only and agent-instruction changes do not require `cargo test` or `pnpm check`
  - Svelte or TypeScript changes should run `pnpm check` (svelte-check + tsc)
  - Rust changes should run `cargo test --workspace`
  - Changes touching packaging, Tauri config, or release behavior should run `pnpm tauri build`; do not use it as the default smoke test
  - Do not say "tests pass" without the count
- If there is no meaningful automated test seam for a change, it is acceptable to ship without adding a new test.
- Do not add tests whose primary purpose is asserting mock call sequences or exact code snippets — these are not meaningful verification.
- Write paths as relative paths from the project root.
- When you change behavior or structure, update the relevant doc in the same commit. Don't let memory drift be the only record.

# Pull Request Hygiene

When opening or updating a pull request:

- Use a clear, correctly capitalized, imperative PR title
- Avoid conventional commit prefixes in PR titles (`fix:`, `feat:`, `docs:`, etc.)
- Avoid trailing punctuation in PR titles
- Optionally prefix the title with a module or scope when the change is clearly bounded (e.g. `capsule: …`, `modes: …`)
- Include a `Release Notes:` section as the final section in the PR body
- Use one bullet under `Release Notes:`:
  - `- Added …`, `- Fixed …`, or `- Improved …` for user-facing changes, or
  - `- N/A` for docs-only and other non-user-facing changes
- Format release notes exactly with a blank line after the heading:

```text
Release Notes:

- N/A
```

# Commit Hygiene

- Default branch: `master`. Feature work uses conventional-style prefixes: `feat(…):`, `refactor(…):`, `docs(…):`, `chore(…):`.
- Each verification-passing commit should stand alone — one logical step per commit, not one mega-commit.
- Never `--no-verify`, never `--force` push, never `git reset --hard` without an explicit user ask.

# Rules Hygiene

These rules are read by every agent session. Keep them high-signal.

## After any agentic session

If you discover a non-obvious pattern that would help future sessions, include a **"Suggested AGENTS.md additions"** heading in your PR description with the proposed text. Do **not** edit `AGENTS.md` inline during normal feature or fix work — reviewers decide what gets merged.

## High bar for new rules

Editing or clarifying existing rules is always welcome. New rules must meet all three criteria:

1. Non-obvious
2. Repeatedly encountered
3. Specific enough to act on

## What not to put here

Avoid architectural descriptions of modules or features. Rules should be traps to avoid, not maps to follow. Architecture belongs in `README.md`.

## No drive-by additions

Rules emerge from validated patterns, not one-off observations. The workflow is:

1. Agent notes a pattern during a session
2. Team validates the pattern in code review
3. A dedicated commit adds the rule with context on why it exists
