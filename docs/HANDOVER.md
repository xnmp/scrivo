# Handover — 2026-09-27

## Objective and current state

The user wants Scrivo, a Typora-like markdown reader/editor, working, thoroughly
verified, and exceptionally fast at startup. The previous checkpoint (`1dec5d8`)
batched postpaint code highlighting, kept Find responsive during it, and verified
the change in native WebKitGTK. Commit `2101010` added a reviewed editor-startup
benchmark and measured when large documents finish progressive insertion. Earlier
commit `425cd77` made the build gate use Vite's manifest and count known prepaint
imports. This continuation adds finer startup phase traces. The broader goal is
ongoing; there is no release or deployment.

Read `README.md` for usage and the latest performance table,
`docs/ARCHITECTURE.md` for layers and safety/performance decisions, and
`docs/CONVENTIONS.md` for coding and testing rules. Key code entry points are
`src/boot.ts` (composition root), `src/app/workspace.ts` (document state and disk
transitions), `src/app/controller.ts` (actions), `src/platform/tauri.ts` (native
adapter), `src/viewer/viewer.ts` (progressive reading view), and
`src-tauri/src/document_io.rs` (atomic conditional writes).

## Earlier product checkpoint (`8eeead5`)

Commit `8eeead5` made native E2E match view-first startup; hardened Rust file
reads, stamps, and atomic writes; added parent-directory watching with clean reload
and dirty-buffer prompts; added postpaint code highlighting and a Contents sidebar;
and updated Save As conflict handling. It passed 279 unit tests, 26 Rust tests,
52 Chromium E2E cases, and 10 native WebKitGTK specs. It also introduced rotated
A/B rounds and a linked JS/CSS bundle budget. Its startup claims were provisional
because a stable splash screen could be timed as content, failed runs could exit 0,
and the budget omitted a conditional 1 MB math font.

## Previous continuation (`1565334`)

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
- `scripts/check-bundle.mjs` began reporting the conditional 1,060 KiB math font.
- `e2e-native/specs/reading-large.spec.ts` opens the real 443 KB fixture in the
  native WebKitGTK app, waits for its distinct end heading, scrolls it into view,
  and verifies it is visible. This separately validates the large file outcome.
  The first attempt used a stale WebDriver element handle while progressive blocks
  were appending; the final test polls the live DOM and passed with the full suite.

## Bundle gate checkpoint (`425cd77`)

- `vite.config.ts` now emits Vite's build manifest. `scripts/check-bundle.mjs`
  traverses manifest `imports`, `dynamicImports`, `css`, and `assets`, plus CSS
  `@import` and `url()` references. It fails on missing files anywhere in the
  reachable static or dynamic graph. The static JS/CSS budget is **34/40 KiB**.
- Review found that `src/app/workspace.ts` calls `window.setTitle` during initial
  display and `src/boot.ts` registers window handlers before the first-frame mark.
  Both can request `@tauri-apps/api/window` before paint. The checker now includes
  that known dynamic root and its static dependencies in a **48/56 KiB prepaint
  JS/CSS** budget. The root list in `scripts/check-bundle.mjs` needs review when
  boot-time imports change. This budget measures uncompressed files; it does not
  measure network latency or parse/evaluation cost.
- The gate validates and reports **1,060 KiB** of startup-referenced assets (the
  reading-view math font) separately from JS/CSS, and **2,517 KiB** in the declared
  deferred graph across eight JS roots and one standalone CSS root. Vite emits the
  dynamically imported KaTeX stylesheet as a manifest entry without an import edge,
  so the checker traverses standalone CSS entries as well. The deferred figure
  includes the prepaint window files and referenced KaTeX fonts. Synthetic tests
  cover each graph and missing references. An independent reviewer rechecked the
  three initial findings against the final checker and found them resolved, with
  no remaining substantive gate or documentation issue.

## Current checkpoint: postpaint code highlighting

- The 443 KB large fixture has 800 fenced code blocks. Before this change, a
  temporary native diagnostic saw all 800 highlighted only around 10.9 seconds
  after launch: the highlighter yielded once per block. The initial batched-idle
  diagnostic reached all 800 around 3.9 seconds on the same host. These are
  exploratory observations, not controlled paired benchmarks or a CI speed gate.
- `src/viewer/code-highlight.ts` now uses `IdleDeadline.timeRemaining()` to fit
  several small blocks in an idle period. It caches resolved language supports
  within the document, preserves original code on grammar/parser failure, and
  flushes text-node invalidation before a new grammar load, before yielding to
  another idle callback, and at completion. It checks document version after an
  asynchronous load or idle callback to avoid changing a superseded document.
- `src/boot.ts` refreshes an open Find at most every 250 ms during highlighting
  and once at completion. Previously, re-indexing the entire document after each
  code block made a native Find-open diagnostic take about 19.4 seconds; after
  throttling, the large native test took 3.2–3.3 seconds. That test duration is
  not a formal performance metric and does not guarantee Find opened before
  highlighting finished. The behavior tests cover Find's final count and the
  content outcome.
- `src/viewer/code-highlight.test.ts` checks that a changed block is reported
  before a slow second grammar load, then checks text preservation and cancellation.
  The new native test independently waits for all 800 code blocks, opens Find for
  `fib_400`, verifies `1 of 1`, waits for every block to have token spans, and
  compares all rendered code text with the source fixture. An independent reviewer
  found no remaining substantive correctness issue in this revised change.
- The new release binary passed five first-viewport runs against the reviewed
  large fixture reference: content times **338–485 ms**, median **388 ms**. This
  is a single-app smoke measurement under current host load, not a replacement
  for the retained 12-pair Scrivo/Typora comparison below.

## Validation

| Check | Latest result |
|---|---|
| `bun run typecheck` | Pass |
| `bunx tsc --noEmit -p e2e-native/tsconfig.json` | Pass |
| `bun run test` | 294 tests across 17 files passed |
| `bun run test:e2e` | 52/52 Chromium tests passed |
| `bun run test:e2e:native` | 11/11 native WebKitGTK specs, 12 tests passed, including both large-file tests |
| `cargo test -q` | 26/26 Rust tests passed at the prior checkpoint; Rust unchanged here |
| `bun run build:web` | Pass; 34/40 KiB static, 48/56 KiB known prepaint JS/CSS, 1,060 KiB referenced assets, 2,517 KiB deferred graph |
| `bunx tauri build --no-bundle` | Pass; release binary rebuilt with current web assets |
| `node bench/bench.mjs scrivo bench/fixtures/large.md 5` | 5/5 verified reference matches; first viewport median 388 ms |
| `git diff --check` | Pass before commit |

Rust source did not change in the prior highlighting checkpoint. The previous native
suite initially had 10 pass and one new test fail from its stale handle, then passed
11/11 after the test correction; the current suite passes both large-file tests.
Playwright WebKit cannot start on this host because `libicu74`, `libxml2`, and
`libflite1` are missing; native WebKitGTK was exercised. Repository-wide
`cargo fmt --check` still reports broad preexisting formatting drift.

## Latest continuation: startup phase trace

`src/viewer/viewer.ts` now accepts an optional trace callback, supplied by the
composition root. It marks inert HTML parsing, math-font readiness, and first-block
layout during `show()`. The callback checks `__SCRIVO_TRACE__`; normal launches do
not invoke the backend. The rounded bundle gate still reports 34/40 KiB static and
48/56 KiB known prepaint JS/CSS.

Fresh three-run release traces are retained in
`bench/results/diagnostic-viewer-medium.txt` and
`bench/results/diagnostic-viewer-large.txt`. All six launches matched their
reviewed first-viewport references. Approximate phase durations from trace marks:

| Phase | Medium | Large |
|---|---:|---:|
| Process start → window built | 140–184 ms | 137–167 ms |
| Window built → JS start | 84–92 ms | 82–88 ms |
| Startup view delivered → HTML parsed | 1.7–2.0 ms | 30.5–33.9 ms |
| HTML parsed → math font ready | 10.7–11.9 ms | 8.8–9.5 ms |
| Math font ready → first blocks laid out | 22.7–24.1 ms | 24.3–27.5 ms |
| First viewport screenshot | 334–389 ms | 356–419 ms |

These are diagnostic runs on this host, not a paired comparison. JavaScript marks
pass through a Tauri IPC call, so small per-phase differences include IPC scheduling.
The native window and webview account for most elapsed time before JavaScript.
The large document's complete HTML parsing adds roughly 30 ms before its first
viewport; changing that path would require a safe way to split HTML at block
boundaries. The math-font wait is around 9–12 ms in these runs, smaller than the
first-block layout cost. The large document finished progressive insertion at
1,062–1,544 ms in these traces; first viewport was already visible.

This continuation passed `bun run typecheck`, all 294 Vitest tests, all 52 Chromium
E2E tests, the release build and bundle gate, and all six reviewed startup
reference checks. The first Chromium attempt could not bind the local dev server
inside the restricted sandbox (`listen EPERM`); the same command passed with local
networking permitted. No native feature behavior or Rust source changed.

## Editor startup and full-document timing (this continuation)

- `bench/bench.mjs --edit` launches `scrivo --edit FILE` and loads a separate
  fixture-hashed screenshot reference. The new `scrivo-medium-edit.png` was visually
  inspected: it shows the CodeMirror editor, the Medium fixture heading and body,
  and 1,373 words in the status bar. The reviewer measured a 20.25% tile difference
  from the reader reference, well beyond the 0.3% readiness threshold. Five trial
  runs and a retained 12-run series all passed. The raw series is
  `bench/results/verified-medium-edit.txt`: median window **213 ms**, visible
  editor **389 ms**, stable first viewport **389 ms**, PSS **286 MiB**. This is a
  standalone Scrivo measurement; `bench/ab.mjs` does not pass `--edit` to Typora.
- The retained three-run trace in `bench/results/diagnostic-large-settled.txt`
  showed verified first-viewport content at **377–492 ms** and `document settled`
  (all progressive blocks inserted) at **1,016–1,417 ms** after process start. An
  earlier diagnostic three-run session had a 1,935 ms settle outlier under load.
  These traces are not a paired comparison, and full-document completion is not
  the screenshot benchmark's `complete` metric. The native tail E2E passed again.
- An unverified missing-file launch was captured separately to inspect the empty
  editor path; the screenshot showed the expected empty editor. Its 3-run median
  content time was 335 ms, but the run intentionally exited nonzero and is not a
  reviewed benchmark result.

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

- The prepaint list is maintained from source review rather than inferred from
  JavaScript execution. Re-audit it whenever boot, workspace display, or platform
  adapters change. The math font remains a 1,060 KiB conditional first-paint
  dependency for documents with math. Measure a proposed font change in paired
  release runs and check math-heavy rendering before adopting.
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
- `document settled` times insertion only. Code highlighting completes later.
  The new native test verifies the final 800-block outcome, while its runtime is
  not a stable performance gate. If changing the idle policy further, measure
  interaction latency and full highlighting time with a controlled trace. The
  existing Find test does not guarantee that Find opens during highlighting.

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
node bench/bench.mjs scrivo bench/fixtures/large.md 3 --trace
node bench/bench.mjs scrivo bench/fixtures/medium.md 12 --edit
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
