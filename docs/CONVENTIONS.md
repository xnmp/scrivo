# Conventions

Read `docs/ARCHITECTURE.md` first. This file is the short list of rules that keep the
codebase consistent.

## Layers and imports

- `src/domain/` is pure TypeScript: no DOM, no CodeMirror view, no Tauri. Put any logic
  that can be a pure function here and unit-test it.
- `src/editor/` may import `domain`. Decoration builders in `editor/live-preview/build.ts`
  are pure functions of `EditorState`; widgets do DOM work only in `toDOM`.
- `src/app/` holds use-cases and the ports (`app/ports.ts`). It never imports adapters.
- `src/platform/tauri.ts` is the only module that imports `@tauri-apps/*`; it loads
  plugin and window APIs lazily so they stay out of the startup chunk.
- `src/boot.ts` is the entry point and composition root; it is the only place that
  picks adapters. Everything it imports statically is on the startup path: the editor,
  CodeMirror, the controller and the dev platform are dynamic imports.
- The reading view inserts HTML only from the backend renderer (`scrivo-render`).
  Never insert document-derived markup built in TypeScript.
- `src/shims/` patches missing browser APIs. Shims go in their own chunk that the entry
  imports first (`vite.config.ts`, verified by `scripts/check-bundle.mjs`), because
  libraries read globals when they load.

## Code style

- Functional core: pure functions, immutable values, explicit inputs. Classes only where
  a framework requires them (CodeMirror widgets, view plugins).
- Match the surrounding code: 2-space indent, single quotes, semicolons, trailing commas.
- Comments explain *why*; don't narrate what the code says.
- Anything not needed for the first paint is a dynamic `import()` (the editor,
  outline, KaTeX, dialogs, code grammars). Reading-view find stays in the startup
  chunk so typing immediately after Ctrl+F is captured. A failed lazy import must
  degrade, never wedge the UI.
  `scripts/check-bundle.mjs` uses Vite's build manifest to enforce a 41 KiB budget
  over linked static JS/CSS, including CSS `@import` files. The known boot-time
  Tauri window import counts toward a separate 56 KiB prepaint JS/CSS budget.
  Manifest assets, stylesheet URLs, and the declared deferred graph are validated
  and reported. Standalone CSS manifest entries need separate traversal because
  Vite omits their dynamic import edge. Audit the prepaint import list when boot or
  platform code changes.

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
- Browser E2E: Playwright (`e2e/`), against the Vite dev server with the dev platform:
  in-memory files, and the real renderer through the `scrivo-render` CLI
  (`scripts/vite-render-plugin.ts`). `window.__scrivo` exposes `workspace`, `viewer`,
  `platform`, `editor`, `controller`. `openApp(page, { mode: 'view' })` starts in the
  reading view; specs default to the editor.
- Native E2E: tauri-driver (`e2e-native/`), headless only. Run the package script;
  it provides an isolated X display and window manager.
- Rust: `cargo test` in `src-tauri`.

## Commands

| What | Command |
|---|---|
| Unit tests | `bunx vitest run` |
| Typecheck | `bunx tsc --noEmit -p .` |
| Rust tests | `cd src-tauri && cargo test` |
| Browser E2E | `bun run test:e2e` (Chromium) |
| Native E2E | `bun run test:e2e:native` |
| Dev (browser, in-memory files) | `bun run dev` → http://localhost:1420 |
| Release build | `bunx tauri build --no-bundle` (runs the bundle check) |
| Startup benchmark | `node bench/bench.mjs scrivo bench/fixtures/medium.md` |
| Compare builds | `node bench/ab.mjs bench/fixtures/medium.md 12 old-binary new-binary` |
| Headless startup trace | `node bench/bench.mjs scrivo bench/fixtures/medium.md 1 --trace` |

## Performance changes

- Measure before and after on the release build, interleaved: `bench/ab.mjs` runs one
  launch of each build per round and reports the paired median. Separate runs mostly
  measure load drift on a shared machine.
- Record the result (adopted or rejected) in ARCHITECTURE.md "Performance decisions",
  so rejected ideas aren't retried blind.

## Never on a developer's live desktop

GUI automation must run headless: Playwright headless, native E2E under
`xvfb-run`/`dbus-run-session`, benchmarks in headless `cage` (the default). Windows that
pop up steal focus and swallow the user's keystrokes.

Use `bun`, not npm/yarn/pnpm.
