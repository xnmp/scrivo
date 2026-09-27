# Handover — 2026-09-27

## Objective and current state

The user wants Scrivo, a Typora-like markdown reader/editor, working, thoroughly
verified, and exceptionally fast at startup. The current work bounds layout for
very tall code blocks in the reader and makes Find reveal matches inside those
blocks, including text beyond a horizontal scrollbar. The previous checkpoint
fixed false save conflicts caused by lossy timestamp serialization and hardened
conditional writes. Earlier checkpoints added renderer-supplied HTML chunk
boundaries, viewer phase traces, batched postpaint code highlighting, reviewed
startup benchmarks, and a manifest-based bundle gate. The broader goal is
ongoing; there is no release or deployment.

Read `README.md` for usage and the latest performance table,
`docs/ARCHITECTURE.md` for layers and safety/performance decisions, and
`docs/CONVENTIONS.md` for coding and testing rules. Key code entry points are
`src/boot.ts` (composition root), `src/app/workspace.ts` (document state and disk
transitions), `src/app/controller.ts` (actions), `src/platform/tauri.ts` (native
adapter), `src/viewer/viewer.ts` (progressive reading view), and
`src-tauri/src/document_io.rs` (atomic conditional writes).

## Current checkpoint: tall code blocks and Find

- A 5 MB fenced code block with 50,000 lines previously produced about a 333–350 ms
  maximum Chromium frame gap. Profiling attributed roughly 221–242 ms to layout;
  the earlier whole-block `content-visibility: auto` trial merely moved a 350 ms
  stall to scrolling. `src/viewer/viewer.ts` now splits plain ASCII code blocks of
  at least 1 MB into 250-line DOM spans. Each has `content-visibility: auto` and an
  estimated intrinsic height based on the computed line height. All source text
  remains in DOM order and `code.textContent` remains exact. The code block is
  segmented after insertion but before a forced layout read. WebKit's HTML parser
  splits a large code string into multiple Text nodes; the implementation joins
  these before segmenting.
- Paint containment initially clipped long lines. The viewer now calculates the
  widest ASCII line in monospace columns, accounting for tab stops, and gives the
  code element that minimum width. An independent review reproduced the bug with
  a 1,000-character line; browser and native tests now scroll to its final
  characters on a tabbed line. Non-ASCII giant code stays on the original layout
  path to preserve exact horizontal sizing; this is a remaining performance limit,
  not text loss.
- WebKit returns a zero `Range` rectangle when a Find match lies in an offscreen
  segment. `src/viewer/find.ts` temporarily lays out only the matching segment(s)
  for geometry queries. Find also scrolls a code block horizontally when the match
  lies beyond its right edge. Native and Chromium tests locate a middle marker and
  a marker at the far right of the 1,000-character line, checking the actual match
  rectangle is visible. Tests also compare the entire 5 MB code text with the
  source, navigate to the tail, and check background and scroll frame gaps.
- The targeted three-test Chromium spec measured a **33–100 ms** maximum frame gap
  for the 5 MB case across runs on this host, below its 200 ms bound. A native
  five-stop scroll diagnostic measured **17 ms** and is now checked against the
  same 200 ms bound. These are host-specific behavioral gates, not a controlled
  startup speed comparison.

### Validation for this checkpoint

| Check | Result |
|---|---|
| TypeScript and Vitest | Pass; 295/295 unit tests |
| Targeted Chromium giant-code and Find specs | 11/11 tests passed after horizontal Find change |
| Targeted native WebKitGTK giant-code spec | Pass after horizontal Find change |
| Full Chromium suite | 56/56 passed, including an ordinary wide-code Find test |
| Full native WebKitGTK suite | 12/12 specs, 15 tests passed with final tabbed fixture and Find behavior |
| Debug and release builds | Pass; bundle gate 36/40 KiB static, 50/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Paired release startup comparison | 12/12 valid old/new pairs for each fixture; median candidate change +4 ms medium, +2 ms large |

The final startup runs are retained in
`bench/results/paired-code-segments-medium.txt` and
`bench/results/paired-code-segments-large.txt`. The baseline release binary was
copied from `30b91d9` (SHA-256
`3ce67f46c57f4584f6a17e487b20220bb33646d1c3af231095896bdcf0618780`);
the candidate binary SHA-256 was
`2e1965dcf79a70b07eb2ba461cb5b89f4c4c9d6c0d89dce09fa6254e384b78a7`.
Medium first-viewport medians were 363 ms baseline and 366 ms candidate; large
were 377 ms and 382 ms. Candidate was faster in 6/12 medium and 4/12 large
rounds. These results do not establish a startup speed gain. The small positive
differences should be weighed against the bounded 5 MB code-block layout and
native scroll improvements; do not compare absolute medians to other sessions.

The next agent should profile non-ASCII giant blocks and consider a width-preserving
segmentation strategy for them. The data-safety priorities in the previous section
remain: validate conflict behavior on Windows and consider a stronger Windows
revision identity than size and modified time. The final filesystem check → rename
race is still present across processes.

## Previous checkpoint: exact file revisions and active Find (`30b91d9`)

- Native runs intermittently displayed a save conflict when an untouched file was
  edited and saved. The key event reached the editor, but the disk bytes stayed
  unchanged. A targeted Rust trace in a failing native run captured a `FileStamp`
  timestamp whose bits changed by one `f64` ULP after Rust → JSON → JavaScript →
  Rust (`...9116` became `...9117`). Filesystem nanosecond precision is not
  reliably preserved by a JSON number.
  The false conflict appeared in different native specs, so it was not a fixture
  or key-dispatch issue. Temporary diagnostic listeners and traces were removed.
- `FileStamp` is now an opaque JSON string. Rust encodes exact filesystem integers:
  device, inode, size, mtime seconds/nanoseconds, and ctime seconds/nanoseconds on
  Unix. Other platforms encode size and exact modified time with an epoch sign;
  failure to obtain modified time fails closed. The domain compares token strings;
  the in-memory platform issues monotonic string tokens. A Rust test round-trips a
  token through JSON and uses it for a conditional save. Domain tests now use the
  public opaque-string contract.
- The Rust write path checks for changes both before and after writing the temp
  file, including user-confirmed overwrites. It re-resolves symlinks before rename
  and refuses a retargeted or dangling link. Deterministic tests change the target
  between temp-file completion and rename, including a newly introduced dangling
  link and an external edit after overwrite confirmation. Existing link targets and
  external content remain intact on conflict. A final check → rename race across
  processes remains because the filesystem has no atomic compare-and-rename here.
- `e2e-native/specs/reading-large.spec.ts` atomically samples partial highlighting
  of the real 800-code-block fixture, dispatches Ctrl+F in that same browser task,
  and checks that Find opens and focuses before all blocks are highlighted. It
  then finds `fib_400` as `1 of 1`. A separate existing test uses a real Control+F
  keypress and checks every block's final highlighted text.
- `e2e-native/specs/save-bytes.spec.ts` now tests a dirty editor plus an external
  write: Ctrl+S prompts instead of replacing the external bytes, and `Load Theirs`
  updates the editor. Failure diagnostics include the editor and disk state.

### Validation for this checkpoint

| Check | Result |
|---|---|
| `bun run typecheck`; native E2E TypeScript check | Pass |
| `bun run test` | 295/295 Vitest tests passed |
| `cargo test -q` in `src-tauri` | 31/31 app Rust tests passed |
| `cargo test -q -p scrivo-render` | 35/35 renderer Rust tests passed |
| `bun run test:e2e` | 54/54 Chromium tests passed on the opaque-token change before the final Rust-only overwrite guard |
| `bun run build:native-test` | Pass; bundle gate 34/40 KiB static, 48/56 KiB known prepaint JS/CSS, 1,060 KiB conditional font, 2,517 KiB deferred graph |
| Native WebKitGTK | 11/11 specs, 14 tests passed against final rebuilt debug binary; an earlier full run also passed before the final Rust-only overwrite guard |
| `bunx tauri build --no-bundle` | Pass; final release binary built |
| Verified release startup smoke | 5/5 medium and 5/5 large first-viewport reference matches; medians 358 ms and 371 ms respectively |
| `git diff --check` | Pass |

An independent adversarial review found the symlink and confirmed-overwrite races;
the resulting checks and focused Rust tests are included. Native tests run under
isolated Xvfb/DBus. The startup smoke uses the current release binary and reviewed
fixture references, but is a single-app check under this host's current load, not
a controlled paired comparison with Typora. Raw current-run logs are in
`/tmp/scrivo-smoke-medium-final.log` and `/tmp/scrivo-smoke-large-final.log` (not
committed); retain the paired measurements below as the comparison baseline.

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

## Postpaint code highlighting checkpoint (`1dec5d8`)

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

## Validation at the highlighting checkpoint

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

## Viewer phase trace checkpoint (`722c68b`)

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
The large document's complete HTML parsing added roughly 30 ms before its first
viewport. The math-font wait was around 9–12 ms in these runs, smaller than the
first-block layout cost. The large document finished progressive insertion at
1,062–1,544 ms in these traces; first viewport was already visible.

This continuation passed `bun run typecheck`, all 294 Vitest tests, all 52 Chromium
E2E tests, the release build and bundle gate, and all six reviewed startup
reference checks. The first Chromium attempt could not bind the local dev server
inside the restricted sandbox (`listen EPERM`); the same command passed with local
networking permitted. No native feature behavior or Rust source changed.

## Earlier checkpoint: chunked HTML parsing before first paint (`129cd13`)

- The Rust renderer (`src-tauri/render/src/lib.rs`) now records UTF-16 offsets only
  after complete top-level Markdown blocks. It starts another chunk after 32 blocks
  or about 16 KiB of generated HTML, whichever comes first. This avoids a separate
  HTML tag scanner and lets each chunk be parsed independently with the browser's
  inert `<template>` parser. A single oversized block can exceed 16 KiB.
- `ViewDocument.chunkEnds` carries those offsets through native IPC and the browser
  dev renderer. `src/viewer/viewer.ts` parses the first chunk before the first
  viewport, then parses later chunks while appending blocks during idle callbacks.
  A callback parses at most one new chunk and checks elapsed time and the idle
  deadline between appended nodes. Synchronous anchor and line navigation can still
  load any required chunks immediately. Renderers without offsets use the previous
  whole-document path. A superseded document stops its old idle work.
- Rust tests cover nested lists, supplementary Unicode offsets, and large blocks;
  viewer tests cover complete content, deferred chunks, navigation, and settlement.
  A Chromium E2E test renders 32 roughly 30 KiB code blocks through the real Rust
  renderer, checks every code block's exact text, navigates to the tail, and finds
  it. It records animation frame gaps through two frames after settlement and fails
  above 200 ms. The observed maximum was 16.7 ms alone and 66.7 ms under the full
  parallel suite on this host. The full native WebKitGTK suite again verified the
  443 KB fixture's tail and all 800 highlighted code blocks. Its large-file spec
  also passed after checking all 400 tables, 800 MathML expressions, and 800 task
  checkboxes across the parsed chunks. An independent review
  found no remaining substantive boundary or scheduling defect after tightening
  the idle callback and tests.
- In 12 rotated old/new release pairs for the large fixture, the original binary
  had median first viewport **362 ms** and the final chunked binary **345 ms**;
  paired median change **−20 ms**, faster in 10/12 pairs. Raw data are in
  `bench/results/paired-chunked-html-large.txt`. The baseline binary was copied
  from commit `722c68b` (SHA-256
  `5e27a63afd1739a5d02452a93b60d1a038f459b58537049634addd39ef89c17a`).
  A prior byte-capped candidate
  showed −29 ms in 12/12 pairs; that candidate lacked the final one-chunk-per-idle
  scheduler and is not the result claimed here. Three post-change release traces
  in `bench/results/diagnostic-chunked-viewer-large.txt` saw the first chunk parsed
  7.8–9.1 ms after startup-view delivery, versus 30.5–33.9 ms for the entire HTML
  in the earlier traces. These trace marks include small IPC scheduling delays.
  The final idle scheduler finished progressive insertion at 1,460–1,473 ms after
  launch in those traces; it trades some tail completion time for bounded background
  work. First viewport content appeared at 340–355 ms.
- The first post-change trace showed higher PSS than earlier runs. Five alternating
  old/new launches (`bench/results/diagnostic-chunked-memory.txt`) measured roughly
  428–437 MiB for **both** binaries, so the observed shift was host-wide rather
  than a memory regression from chunking. PSS is sampled 1.5 seconds after first
  viewport stability; this is not a peak-memory measurement.
- The final binary also passed 12 direct-to-editor launches against its separately
  reviewed editor reference: median first viewport **388 ms**, window **212 ms**.
  Raw data are in `bench/results/verified-medium-edit-chunked.txt`. This is a
  standalone Scrivo measurement, not a paired Typora comparison.

### Validation on the final candidate

| Check | Result |
|---|---|
| `bun run typecheck`; native E2E TypeScript check | Pass |
| `bun run test` | 295 tests across 17 files passed |
| `cargo test -q -p scrivo-render`; `cargo test -q` | 35 renderer and 26 app Rust tests passed |
| `bun run test:e2e` | 54/54 Chromium tests passed, including the 1 MB single-block case |
| `bun run test:e2e:native` | 11/11 WebKitGTK specs, 12 tests passed |
| `bunx tauri build --no-bundle` | Pass; 34/40 KiB static and 48/56 KiB known prepaint JS/CSS |
| Paired startup checks | 12/12 valid old/new large, 12/12 valid current Scrivo/Typora medium and large |
| Editor startup | 12/12 reviewed reference matches; median first viewport 388 ms |

## Earlier editor startup and full-document timing (`2101010`)

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

Raw logs for the **current** release build and 0.3% content criterion are
`bench/results/verified-medium-chunked.txt` and
`bench/results/verified-large-chunked.txt`. Previous release logs are retained
as `bench/results/verified-medium.txt` and `verified-large.txt`; earlier logs with
weaker readiness checks are `bench/results/pre-readiness-*.txt`. Do not mix
absolute medians across these sessions.
Each current run attempted 12 rotated-order pairs in the same private compositor;
all 12 pairs were valid for both fixtures. Times are milliseconds after process
launch and are specific to this Linux host, Typora 1.14.9-1, and their load:

| Fixture | App | Window median | Content median | Stable viewport median |
|---|---|---:|---:|---:|
| Medium, 8.8 KB | Typora | 411 | 965 | 965 |
| Medium, 8.8 KB | Scrivo | 211 | 340 | 340 |
| Large, 443 KB | Typora | 433 | 2,016 | 2,016 |
| Large, 443 KB | Scrivo | 211 | 356 | 356 |

Scrivo reached the reviewed first viewport sooner in all 12 pairs for both
fixtures. Paired median advantages were 626 ms and 1,682 ms respectively. Host
load differed from the previous release comparison; use the paired differences
and raw rounds, not cross-run absolute medians, to evaluate relative startup.
"Complete" in raw logs means only that the first viewport was
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
  Native tests verify Find opening during partial highlighting and the final
  800-block outcome, while their runtimes are not stable performance gates. If
  changing the idle policy further, measure interaction latency and full
  highlighting time with a controlled trace.
- Chunk boundaries require complete top-level blocks. A very large table or
  paragraph can still exceed the 8 ms idle budget. Giant code blocks containing
  non-ASCII text also use the original layout path while exact horizontal sizing
  is unresolved. The 200 ms performance gates cover their specified fixtures on
  this host, not arbitrary block size or slower hardware.
- Before the current segmentation checkpoint, an additional Chromium test with
  one 1 MB code block observed a 50 ms maximum frame gap in isolation and 100 ms
  in the full parallel suite, with exact text and tail navigation. A 5 MB code
  diagnostic observed a 333 ms gap; isolated profiling attributed 22–25 ms to
  parsing and about 221 ms to forced layout. Applying `content-visibility: auto`
  only to the whole code block moved a 350 ms stall to visible scrolling. A trial
  that appended code text in 512,000-character idle slices reached 150 ms maximum
  in isolation but 383 ms under the full parallel suite; cumulative layout grew
  from about 221 ms to 458–981 ms. Both trials were reverted. The current 250-line
  containment strategy addresses this ASCII case and tests visible scrolling.
  [MDN's `content-visibility` reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)
  describes the browser behavior used here.

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
