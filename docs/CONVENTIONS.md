# Conventions

Read `docs/ARCHITECTURE.md` first. This file is the short list of rules that keep the
codebase consistent.

## Layers and imports

- `src/domain/` is pure TypeScript: no DOM, no CodeMirror view, no Tauri. Put any logic
  that can be a pure function here and unit-test it.
- `src/editor/` may import `domain`. Decoration builders in `editor/live-preview/build.ts`
  are pure functions of `EditorState`; widgets do DOM work only in `toDOM`.
- `src/app/` holds use-cases and the ports (`app/ports.ts`). It never imports adapters.
- `src/platform/tauri.ts` is the only module that imports `@tauri-apps/*`.
- `src/main.ts` is the composition root; it is the only place that picks adapters.
- `src/shims/` patches missing browser APIs. Shims go in their own chunk that the entry
  imports first (`vite.config.ts`, verified by `scripts/check-bundle.mjs`), because
  libraries read globals when they load.

## Code style

- Functional core: pure functions, immutable values, explicit inputs. Classes only where
  a framework requires them (CodeMirror widgets, view plugins).
- Match the surrounding code: 2-space indent, single quotes, semicolons, trailing commas.
- Comments explain *why*; don't narrate what the code says.
- Anything not needed for the first paint is a dynamic `import()` (see search, KaTeX,
  dialogs, code grammars). A failed lazy import must degrade, never wedge the UI.

## Editing semantics

- The document text is the single source of truth. Never serialize a model back to
  markdown; every edit is a CodeMirror change to the text.
- Edits made by UI (checkbox toggles, commands) are normal transactions with a
  `userEvent`, so they are undoable.

## Tests

- Unit: Vitest, colocated `*.test.ts`. Test behaviour and contracts (outputs, resulting
  document text, what a user would see), not internal structure. Cover edge cases: empty
  input, malformed markdown, very large documents, multiple cursors.
- `EditorState` works headlessly in Node: test commands and decoration builders there.
- Browser E2E: Playwright (`e2e/`), against the Vite dev server with the in-memory
  platform (`window.__scrivo` exposes `editor`, `controller`, `platform`).
- Native E2E: tauri-driver (`e2e-native/`), headless only.
- Rust: `cargo test` in `src-tauri`.

## Commands

| What | Command |
|---|---|
| Unit tests | `bunx vitest run` |
| Typecheck | `bunx tsc --noEmit -p .` |
| Rust tests | `cd src-tauri && cargo test` |
| Dev (browser, in-memory files) | `bun run dev` → http://localhost:1420 |
| Release build | `bunx tauri build --no-bundle` (runs the bundle check) |
| Startup benchmark | `node bench/bench.mjs scrivo bench/fixtures/medium.md` |

## Never on a developer's live desktop

GUI automation must run headless: Playwright headless, native E2E under
`xvfb-run`/`dbus-run-session`, benchmarks in headless `cage` (the default). Windows that
pop up steal focus and swallow the user's keystrokes.

Use `bun`, not npm/yarn/pnpm.
