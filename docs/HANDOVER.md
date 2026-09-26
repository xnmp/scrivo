# Handover (2026-09-26)

State: a working Tauri v2 editor. `bunx tsc --noEmit -p .` is clean, `bunx vitest run` passes (197 tests) and Playwright passes on chromium (32 tests). Nothing is committed (this directory isn't a git repo).

## Done this session (after ARCHITECTURE/CONVENTIONS were written)
- Formatting commands (`src/editor/commands.ts`, 56 tests). Multi-cursor is enabled in `setup.ts`.
- Playwright E2E (`e2e/`, 15 specs). It runs on chromium only; Playwright's WebKit build needs ICU 74, and Arch ships 78.
- Word count is a single char-code pass over `doc.iter()`, with no `toString`. That's about 4 ms on the 443 KB fixture instead of about 20 ms.
- `src/shims/idle-callback.ts` provides `requestIdleCallback` for WebKit. Without it, CodeMirror's background parse blocks input in 100 ms slices; with it, slices are 25 ms (measured in WebKitGTK).
  - `vite.config.ts` puts the shims in their own chunk so they evaluate before CodeMirror's chunk.
  - `scripts/check-bundle.mjs` (run by `build:web`) enforces that ordering and a 480 KiB startup budget. Startup is 432 KiB today.
- `joinPath` bug fixed: a document at the filesystem root resolved `img.png` to `//img.png`. Added `document.test.ts` and `external.test.ts`.

## Not done / next
1. **Native E2E (`e2e-native/`, wdio + tauri-driver) is unfinished.** Its agent was stopped mid-run; check whether the specs run under `xvfb-run`.
2. **The adversarial data-safety review was stopped before it reported.** Re-run it unbiased over `controller.ts`, `document_io.rs`, `commands.rs`, `text-format.ts` and `tauri.ts`.
3. Builder unit tests for `live-preview/build.ts` (the brief is in the transcript: test the rendered text a user sees, fast-check for no throw/overlap).
4. Final benchmarks on an idle machine:
   - Run `node bench/bench.mjs scrivo bench/fixtures/{medium,large}.md 8`, then the same for `typora`.
   - Never pass `--desktop`; it runs on the live session.
   - Earlier large-doc results were distorted by load (load avg ~10). Clean runs match the medium doc at about 505 ms, against Typora's 926 ms for medium and 1926 ms for large.
5. Features: outline sidebar (pure line scan in `domain/outline.ts`, tested against lezer's parse), Ctrl+click links, drag-drop open, image paste, then a README with results.

## Gotchas
- `bunx tauri build` writes `dist/`. For side builds, pass `--config` to set `frontendDist: ../dist-bench` (`dist-bench/` is a scratch artifact).
- Never run GUI apps on the live Hyprland desktop: use headless cage (the bench default), `xvfb-run` and Playwright headless.
