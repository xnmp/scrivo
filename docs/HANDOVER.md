# Handover — 2026-09-27

## Objective and current state

The user wants Scrivo, a Typora-like markdown reader/editor, working, thoroughly
verified, and exceptionally fast at startup. Work continues on `main` after commit
`8eeead5 WIP: reader enhancements, file safety, and startup benchmarks`. This
continuation hardened the startup comparison, made the large fixture visibly
distinct, added a native large-file outcome test, and made the build gate report a
conditional font dependency. The broader goal is ongoing; there is no release or
deployment.

Read `README.md` for usage and the latest performance table,
`docs/ARCHITECTURE.md` for layers and safety/performance decisions, and
`docs/CONVENTIONS.md` for coding and testing rules. Key code entry points are
`src/boot.ts` (composition root), `src/app/workspace.ts` (document state and disk
transitions), `src/app/controller.ts` (actions), `src/platform/tauri.ts` (native
adapter), `src/viewer/viewer.ts` (progressive reading view), and
`src-tauri/src/document_io.rs` (atomic conditional writes).

## Product work in the preceding checkpoint

The preceding commit made native E2E match view-first startup; hardened Rust file
reads, stamps, and atomic writes; added parent-directory watching with clean reload
and dirty-buffer prompts; added postpaint code highlighting and a Contents sidebar;
and updated Save As conflict handling. It passed 279 unit tests, 26 Rust tests,
52 Chromium E2E cases, and 10 native WebKitGTK specs. It also introduced rotated
A/B rounds and a linked JS/CSS bundle budget. Its startup claims were provisional
because a stable splash screen could be timed as content, failed runs could exit 0,
and the budget omitted a conditional 1 MB math font.

## This continuation

- `bench/bench.mjs` now waits through intermediate stable screens until the first
  viewport matches a manually reviewed fixture-specific reference, then stays
  stable for 1.5 seconds. A timed `content` frame itself must match the reference
  within 0.3% of 16×16 luminance tiles. Missing windows, incomplete or capped runs
  fail; the process exits nonzero when a run fails. `--failure-dir=DIR` saves a final
  PPM for diagnosis. `--unverified --dump=DIR` supports reference capture, exits
  nonzero, and labels the numbers unverified. The live-desktop mode was removed;
  every run uses a private 1280×720 `cage` compositor.
- `bench/references/` contains compact fixture-hashed signatures and the four PNGs
  from which they were made. Both apps' medium and large PNGs were visually
  inspected: the expected heading, fixture label, and body text are visible.
  `bench/fixtures/gen.py` now puts distinct Medium/Large labels at the top and
  distinct end headings at the tail. The benchmark compares first-viewport startup,
  not the time to finish rendering the whole file.
- `bench/ab.mjs` retains each launch failure and requires at least 80% valid paired
  rounds for every candidate, exiting nonzero otherwise. Both benchmark scripts
  use the conventional median for even sample counts. Unit tests cover blank and
  incomplete screens, wrong fixtures, fixture hash mismatch, the timed-frame
  contract, median calculation, and the minimum-pair rule. An independent reviewer
  rechecked the final implementation and found no substantive validity issue within
  this first-viewport metric.
- `scripts/check-bundle.mjs` now includes CSS `@import` files in the 40 KiB linked
  JS/CSS budget and separately reports CSS `url()` assets. The current build reports
  **34 KiB / 40 KiB** linked startup JS/CSS and **1,060 KiB** conditional CSS assets:
  `libertinus-math` loads for math in the reading view. A synthetic CSS-import/font
  test was added. Awaited dynamic imports remain outside this static budget.
- `e2e-native/specs/reading-large.spec.ts` opens the real 443 KB fixture in the
  native WebKitGTK app, waits for its distinct end heading, scrolls it into view,
  and verifies it is visible. This separately validates the large file outcome.
  The first attempt used a stale WebDriver element handle while progressive blocks
  were appending; the final test polls the live DOM and passed with the full suite.

## Validation

| Check | Latest result |
|---|---|
| `bun run typecheck` | Pass |
| `bunx tsc --noEmit -p e2e-native/tsconfig.json` | Pass |
| `bun run test` | 287 tests across 16 files passed |
| `bun run test:e2e:native` | 11/11 passed, including large-file tail |
| `bun run build:web` | Pass as the native test build prerequisite; 34 KiB JS/CSS gate plus 1,060 KiB conditional asset report |
| `node --check bench/bench.mjs` and `bench/ab.mjs` | Pass |
| `git diff --check` | Pass before this handover update; rerun before commit |

The Rust source and browser app source did not change in this continuation. The
preceding checkpoint's `cargo test -q` (26 passed), Chromium E2E (52 passed), and
release `tauri build --no-bundle` remain the relevant evidence. The full native
suite initially had 10 pass and one new test fail from its stale handle, then passed
11/11 after the test correction. Playwright WebKit cannot start on this host because
`libicu74`, `libxml2`, and `libflite1` are missing; native WebKitGTK was exercised.
Repository-wide `cargo fmt --check` still reports broad preexisting formatting drift.

## Final paired measurements

Raw logs for the **current** distinct fixtures and 0.3% content criterion are
`bench/results/verified-medium.txt` and `bench/results/verified-large.txt`. Older
logs from different fixture labels and weaker readiness checks are retained as
`bench/results/pre-readiness-*.txt` for history and are not directly comparable.
Each current run attempted 12 rotated-order pairs in the same private compositor;
all 12 pairs were valid for both fixtures. Times are milliseconds after process
launch and are specific to this Linux host and its load:

| Fixture | App | Window median | Content median | Stable viewport median |
|---|---|---:|---:|---:|
| Medium, 8.8 KB | Typora | 449 | 1,010 | 1,010 |
| Medium, 8.8 KB | Scrivo | 218 | 363 | 363 |
| Large, 443 KB | Typora | 819 | 4,107 | 4,107 |
| Large, 443 KB | Scrivo | 495 | 858 | 858 |

Scrivo reached the reviewed first viewport sooner in 11/12 medium pairs and 12/12
large pairs. Paired median advantages were 651 ms and 3,239 ms respectively. One
medium Scrivo launch had a 1.7-second window scheduling outlier. Host load changed
sharply during the large run (load average about 27 midrun, then lower); use the
paired differences and raw rounds, not cross-run absolute medians, to evaluate
relative startup. "Complete" in raw logs means only that the first viewport was
stable. The native large-file test proves its tail eventually renders; it does not
measure how long that takes. A prior single startup trace is in
`docs/ARCHITECTURE.md` and should not be treated as an A/B result.

## Remaining limits and useful next work

- The build gate does not infer whether a dynamic import is awaited before first
  paint. The production `src/boot.ts` path currently awaits no such chunk before
  showing the reading view; re-audit when that path changes. The math font is
  intentionally separate from the 40 KiB JS/CSS budget and remains a 1,060 KiB
  conditional first-paint dependency for documents with math. Measure a proposed
  font change in paired release runs and check math-heavy rendering before adopting.
- Reviewed screenshot references are sensitive to compositor geometry, fonts, app
  theme, and deliberate UI changes. Regenerate them only after inspecting the new
  PNGs. The 0.3% tile threshold is strict by design; a new machine may need its
  own reviewed references. This is a first-viewport benchmark, not a Typora
  full-document completion test.
- The Rust write path still has the unavoidable cross-process race between final
  conflict check and rename. Windows stamps lack Unix metadata change time, so a
  same-size edit that restores mtime may be missed. A writable file in a directory
  that forbids temporary-file creation now fails safely and keeps the buffer dirty.
  See `docs/ARCHITECTURE.md` for the safety model.
- The editor uses KaTeX for interactive preview while the Rust reader supplies
  MathML. Keep the two render paths separate until output and startup costs have
  been measured. A prior concurrent browser/native run had one failure in each
  suite under load; later full concurrent and sequential reruns passed, but its
  exact cause was not established.

## Commands

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

To refresh a reference after a visual or platform change, run one app and fixture
headlessly with `--unverified --dump=/tmp/NAME`, convert `final.ppm` to PNG with
`ffmpeg`, **inspect the image**, then use `node bench/make-reference.mjs
/tmp/NAME/final.ppm bench/fixtures/FILE.md bench/references/APP-FILE.json` and copy
the inspected PNG beside it. The unverified capture exits 1 intentionally. Use
`BENCH_FAILURE_DIR=/tmp/scrivo-bench-failures` with `bench/ab.mjs` to retain final
screens of failed launches. Keep GUI automation off the developer's live desktop.
The private compositor may need local display socket access outside the default
sandbox. Use Bun, not npm/yarn/pnpm.
