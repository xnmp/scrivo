# Handover — 2026-09-27 WIP checkpoint

## Where to resume

The user wants a Typora-like markdown reader/editor that is working, thoroughly tested,
and exceptionally fast at startup. This checkpoint commits completed feature work and
measurements; the broader performance objective remains open. The branch is `main`.
The preceding commit was `1a76308 Find in the reading view (Ctrl/Cmd+F)`; this handover
is part of the next WIP commit. Start with the unresolved benchmark validity findings
below before claiming a measured startup win. No release or deployment was made.

Repository entry points: `README.md` (usage and current comparison),
`docs/ARCHITECTURE.md` (layers, safety model, startup path, decisions), and
`docs/CONVENTIONS.md` (code and testing conventions). The app opens files in a Rust-
rendered reading view and loads the CodeMirror editor on demand. `src/boot.ts` composes
it; `src/app/workspace.ts` owns document transitions and disk state; `src/app/controller.ts`
owns user actions; `src/platform/tauri.ts` is the desktop adapter.

## Work in this checkpoint

- Native E2E fixtures now account for reading-view startup; existing editor cases use
  `--edit`. Four new native specs cover headings, local images and missing-image
  placeholders, switching between surfaces, and an atomic external file replacement
  while the window remains focused. The native package script uses an isolated X
  display, D-Bus session, window manager, and distinct driver ports.
- Rust file I/O in `src-tauri/src/document_io.rs` no longer has an in-place truncating
  write fallback. Reads verify bytes and stamp through the same open file. Unix stamps
  include metadata change time. Writes take an explicit condition (`unchanged`,
  `absent`, or `overwrite`), use a same-directory temporary file, sync, recheck the
  target, then rename. Workspace Save As conflict handling can load the selected
  target. Deletion and recreation are checked before the final rename.
- `src-tauri/src/watch.rs` watches parent directories so atomic replacements produce
  notifications. `src/app/workspace.ts` treats events as hints, checks the current
  stamp, reloads clean documents, and prompts before replacing a dirty buffer. It
  checks after watcher installation to close the setup gap. Deletion retains the last
  version; later recreation is detected. A failed first switch to the editor leaves
  the reading view as document owner.
- The reading view loads fenced-code highlighting after paint in
  `src/viewer/code-highlight.ts`; unknown languages and blocks over 20,000 characters
  remain plain text. Find caches refresh when highlighting changes text nodes.
  `src/ui/outline.ts` and `src/styles/outline.css` add a responsive Contents sidebar
  from headings. These lazy paths keep code grammars and outline UI off the initial
  static JS path.
- `bench/ab.mjs` now rotates the first app in each pair, preserves launch failure
  reasons, and handles zero valid pairs without crashing. `bench/bench.mjs --trace`
  captures `SCRIVO_TRACE=1` phase marks in its private compositor. Its validity and
  exit-status gaps are listed below.
- `scripts/check-bundle.mjs` follows transitive static JS imports even when a Vite
  preload link is missing. `tests/check-bundle.test.mjs` proves an oversized nested
  import is caught. The passing 34 KiB / 40 KiB budget covers linked JS/CSS and
  transitive static JS imports only; it is not a complete first-paint byte total.
- The native save-bytes E2E now waits for the editor and typed text to be visible and
  prints expected bytes, actual bytes, and editor text on mismatch. The browser
  large-document case waits for the rendered tail through Playwright auto-retry.

## Validation already completed

| Check | Result |
|---|---|
| `bun run typecheck` | Pass |
| `bunx tsc --noEmit -p e2e-native/tsconfig.json` | Pass |
| `bun run test` | 279 tests, 15 files passed |
| `cd src-tauri && cargo test -q` | 26 passed |
| `bun run test:e2e` | 52 Chromium cases passed |
| `bun run test:e2e:native` | 10 native cases passed |
| `bun run build:web` | Pass; bundle gate reports 34 KiB / 40 KiB |
| `bunx tauri build --no-bundle` | Release build passed before the final benchmark, test, and documentation edits; app source has not changed since |
| `node --check` on benchmark and bundle-check scripts | Pass |
| `git diff --check` | Pass before this handover rewrite; rerun before commit |

The browser and native suites passed sequentially. An earlier concurrent run failed
one native save-bytes case and one browser large-document case under load; isolated
reruns passed. After tightening assertions, a full concurrent rerun passed 52/52 and
10/10. The original failures' cause was not established; do not describe the stronger
waits as proof of an app race fix. Repository-wide `cargo fmt --check` reports broad
formatting differences in existing Rust files. New `watch.rs` was formatted; avoid a
blanket formatting change in this checkpoint. Playwright WebKit cannot start on this
host because `libicu74`, `libxml2`, and `libflite1` are missing. Native E2E exercises
the installed WebKitGTK app.

## Startup evidence and its limits

Raw rotated-order logs are committed in `bench/results/final-medium.txt` and
`bench/results/final-large.txt`. Both compare the same Scrivo release binary against
Typora in a 1280×720 private headless compositor, 12 attempted paired rounds each.
The metric is based on sampled screenshot similarity to a final stable screenshot.
Times below are milliseconds from process launch and are machine-specific:

| Fixture | App | Valid | Window median | Content median | Complete median |
|---|---|---:|---:|---:|---:|
| Medium, 8.8 KB | Typora | 10 | 822 | 1,857 | 1,857 |
| Medium, 8.8 KB | Scrivo | 12 | 498 | 749 | 771 |
| Large, 443 KB | Typora | 12 | 922 | 1,294 | 1,558 |
| Large, 443 KB | Scrivo | 12 | 559 | 933 | 953 |

Two medium Typora attempts reported `window never appeared`. For pairs with two
valid launches, Scrivo's median content advantage was 1,162 ms on medium (10/10
faster) and 379 ms on large (12/12 faster). System load varied markedly. One Scrivo
medium final screenshot (`/tmp/scrivo-medium-final.png`) was visually inspected and
contained the real document, headings, and Contents button. Typora and large final
screenshots have not been visually verified. `/tmp` artifacts are not in the commit.

One `SCRIVO_TRACE=1` diagnostic under load recorded Tauri setup at 75.6 ms, EGL warm
at 77.5 ms, image warm at 164.6 ms, window built at 430.3 ms, JS start at 680.4 ms,
startup view delivered at 680.7 ms, document shown at 767.4 ms, first frame at
805.1 ms, and document settled at 814.7 ms. The screenshot sampler reported window
at 616 ms and content/complete at 926 ms. This is a single phase trace, not an A/B
result; the window/webview path dominated this run.

An independent performance review found these **open issues**, ordered by impact:

1. `bench/bench.mjs` accepts a screen stable for 1.5 seconds as the final reference
   without proving the document rendered. A splash, error, or blank page could count
   as content; reaching its 20-second cap also is not rejected. Add document readiness
   evidence and fail incomplete/capped runs. Verify final screenshots for both apps
   and fixtures before treating the README comparison as validated.
2. `bench/ab.mjs` exits successfully with no valid pairs; `bench/bench.mjs` reports
   failed launches yet also exits successfully. Enforce successful candidate launches
   and a documented minimum valid-pair count, with nonzero exit on insufficient data.
3. The 40 KiB gate omits the conditional math font: `src/viewer/viewer.ts` waits on
   `document.fonts.load('1em "Scrivo Math"')` before inserting math; its font is about
   1,085,336 bytes. Measure and report this separately or extend the startup budget
   to represent actual conditional first-paint dependencies. The README and docs now
   state the gate's narrower scope.
4. The bundle traversal uses a regex for static JS imports. Awaited dynamic imports,
   CSS `@import`, and asset loads can escape it; the current synthetic test covers
   only one nested static-import case. Prefer a reliable manifest/AST-based inventory
   or an explicit dependency accounting for the first-paint path.
5. `bench/bench.mjs` uses the upper middle observation as its even-count “median”; the
   paired script uses the conventional mean of the two middle values. Align them.

The reviewer confirmed the README figures match raw logs; the concern is what those
screenshots prove. First make the harness reject invalid runs, rerun both fixtures,
inspect representative final screenshots, then update the README with validated data.

## Other known limits

- A cross-process writer can race the final conflict check and rename; ordinary
  filesystems do not provide atomic compare-and-rename. On Windows, stamps lack Unix
  change time, so same-size edits with restored mtime can be missed. See the safety
  discussion in `docs/ARCHITECTURE.md`.
- A writable file in a directory that blocks creation of a same-directory temporary
  file cannot be saved by the new safe path. Save fails and leaves the buffer dirty.
- The editor uses KaTeX for interactive preview while the Rust reading renderer
  supplies MathML. Keep the paths separate until output and startup costs have been
  measured. Avoid speculative performance changes: run paired release comparisons.

## Useful commands and environment

```sh
bun run typecheck
bunx tsc --noEmit -p e2e-native/tsconfig.json
bun run test
(cd src-tauri && cargo test -q)
bun run build:web
bun run test:e2e
bun run test:e2e:native
bunx tauri build --no-bundle
node bench/ab.mjs bench/fixtures/medium.md 12 typora src-tauri/target/release/scrivo
node bench/ab.mjs bench/fixtures/large.md 12 typora src-tauri/target/release/scrivo
node bench/bench.mjs scrivo bench/fixtures/medium.md 1 --trace
```

Run GUI automation headlessly only: Playwright headless, native E2E under the package
script's private Xvfb/D-Bus/openbox setup, and benchmarks under private `cage`. A
benchmark may need access to local display sockets outside the default sandbox.
Do not open app windows on the developer's live desktop. Follow the user's AGENTS.md
instructions for domain-first design, behavior tests, and independent review of
medium or high risk changes.
