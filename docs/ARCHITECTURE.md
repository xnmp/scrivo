# Scrivo — architecture

Scrivo is a fast, open-source markdown viewer and Typora-style editor. A file opens in
a **reading view** rendered by Rust while the webview boots; Ctrl/⌘+E switches to a
one-pane **editor** where the syntax melts away as you write, and the file on disk is
exactly what you typed. `scrivo --edit file.md` (or `-e`) starts in the editor;
untitled and new files always do.

## Principles

1. **Startup is the product.** Showing a document needs a small script and HTML the
   backend rendered in parallel with window creation. The editor (CodeMirror, grammars,
   KaTeX) is a lazy chunk, preloaded when the page is idle. Every startup change is
   measured (see "Performance decisions").
2. **The markdown text is the single source of truth.** The editor renders with
   CodeMirror decorations over the text; nothing serializes a model back to markdown,
   so the editor can't reformat or drop content. The reading view is a pure projection.
3. **Rendered HTML is safe by construction.** The Rust renderer builds output from parse
   events: no markup from the document passes through, so the page can insert it as
   HTML (see "Security").
4. **Domain logic is pure and headless-testable.** Link policy, document lifecycle,
   the view/edit state machine and decoration builders run in Node without a DOM.
5. **Infrastructure sits behind ports.** The app depends on `Platform`
   (`src/app/ports.ts`): Tauri implements it in production; an in-memory adapter backs
   unit tests; the browser dev build adds the real renderer over HTTP for Playwright.

## Two surfaces

| | Reading view | Editor |
|---|---|---|
| Renders with | `scrivo-render` (Rust: pulldown-cmark + math-core → HTML + MathML); code grammars load after paint | CodeMirror 6 live preview (lezer markdown, KaTeX) |
| Loaded | at startup (`src/viewer/viewer.ts`) | on demand (`src/editor-app.ts`), preloaded when idle |
| Owns the text | no: shows the file or the editor's buffer | yes, once it exists |

`src/app/workspace.ts` is the use case that switches between them. Once the editor has
been created it owns the document: the reading view then renders the editor's buffer,
saving goes through the editor's controller, and positions carry over both ways as
1-based source lines (every rendered block has `data-line`). Operations run through a
serial queue so a click during a pending switch can't interleave with it. The reading
view's outline is built from renderer heading metadata, and its code highlighting
loads matching editor grammars only after the document has painted. It highlights
several small blocks per idle deadline, then invalidates text nodes as a batch.
Find refreshes at most every 250 ms while open and once at completion so repeated
full-document indexing does not dominate highlighting. The Rust renderer also
provides UTF-16 offsets at complete top-level block boundaries, so the viewer
parses only the first HTML chunk before paint and later chunks during idle time.
The insertion scheduler gives required background work a 250 ms idle-callback
timeout. While Find awaits the complete document, a cancellable wait lowers that
timeout to 25 ms; closing or replacing the query returns to background pacing.
Expired callbacks use the same 12 ms work budget rather than treating their zero
reported idle time as a reason to append only one block. Switching to edit mode
suspends unfinished reader insertion; switching back renders from the editor buffer.
An early Find query waits for that insertion to settle before indexing and range
geometry. The bar remains interactive and shows a pending state; newer queries
or closing the bar cancel stale results. This avoids forcing full-document layout
during the input event while retaining complete-document search.
Code blocks of at least 1 MB are split into 250-line contained spans before layout,
keeping all text in the DOM while bounding visible-scroll work. The viewer sets
the code width from the widest ASCII line and a bounded set of distinct Unicode
lines measured with Canvas. Its tab calculation applies the CSS Text 0.5ch
minimum advance rule. Lines over 10,000 Unicode code units, over 512 distinct
Unicode lines, or over 200,000 distinct Unicode code units keep native layout
instead of risking clipped horizontal content. Find temporarily exposes matching
spans for WebKit range geometry and scrolls a `<pre>` horizontally to reveal a
wide-line match.

Why CodeMirror live preview rather than a ProseMirror WYSIWYG: ProseMirror-based
editors (Milkdown, Tiptap) parse markdown into a rich document and serialize it back,
rewriting list markers, escapes and tables. Obsidian, Zettlr and SilverBullet use
CodeMirror 6 live preview for this reason; it also virtualises the viewport.
Rendered editor tables use a CodeMirror block widget. Its focused cell input
updates only that cell's Markdown source through normal undoable transactions;
the widget redraws changed cells and closes an input if another edit replaces its
source. Row and column commands also edit Markdown directly. Table parsing and
pipe escaping live in the pure `domain/table.ts` helpers.

## Layers

```
src/
  domain/           pure TS: no DOM, no CodeMirror view, no Tauri
    text-format     EOL/BOM detection + lossless decode/encode
    document        DocumentSession: path, saved snapshot, dirty, title, stamps
    links           link policy: anchor / markdown document / external / reveal / none
    external, reveal, table, outline, stats ...
  app/
    ports           Platform, Renderer, Shell, ViewDocument ... (interfaces only)
    workspace       view/edit state machine (ViewerPort, EditorHandle)
    controller      editor use cases: open, save, save-as, new, close, reload
    errors          describeError (shared by both surfaces)
  viewer/           progressive insertion, line ↔ scroll, find, deferred code highlighting
  editor/           CodeMirror integration (may import domain)
  editor-app        lazy chunk: builds the editor + controller, returns an EditorHandle
  platform/
    tauri           Platform over @tauri-apps/* (the only module importing them)
    memory          in-memory Platform for unit tests
    dev             browser dev Platform: memory files + renderer over HTTP
  ui/               DOM chrome: status bar, prompter, outline, find bar
  shims/            browser API polyfills, evaluated before any library
  boot.ts           entry point and composition root

src-tauri/
  render/           scrivo-render crate: pure markdown → safe HTML (+ CLI for dev/E2E)
  src/
    lib.rs          builder, plugins, commands, window
    startup.rs      argv; prefetches (reads + renders) the file on a worker thread
    prewarm.rs      Linux: starts EGL and image-loader init on worker threads
    view.rs         ViewDocument: renderer output + asset URLs + image grants
    document_io.rs  read (UTF-8 validation) and atomic write; no Tauri types
    watch.rs        parent-directory file change notifications
    commands.rs     thin #[tauri::command] adapters, error mapping
```

Dependency direction: `ui`/`viewer`/`editor`/`platform` → `app` → `domain`. `domain`
imports nothing else; `app` never imports adapters. `boot.ts` is the only place that
picks adapters.

## Security

Threat model: opening a hostile markdown file must not run script, reach IPC, read
files it doesn't reference, start programs, or navigate the webview.

- **Renderer output** (`render/src/lib.rs`): raw HTML in the document is shown as
  text; every text node and attribute value is escaped; only a fixed set of tags and
  attributes is produced (the property tests assert this over random input). Math is
  rebuilt as MathML by math-core; its `href`s go through the same link policy.
- **URLs** (`render/src/url.rs`): links keep only http, https, mailto, tel, file and
  relative targets, after WHATWG-style cleaning (control characters, whitespace,
  entity tricks). Anything else keeps its text but loses the link.
- **Images**: a local image resolves against the document's directory and is granted to
  the asset protocol one file at a time, just before the page receives the HTML.
  Remote images load directly (the CSP allows `https:`/`http:` images only).
- **Clicks** (`domain/links.ts`, `workspace.followLink`): the page never navigates.
  Fragments scroll; markdown files open in the reader; web/mail links go to the system
  opener; other local files are *revealed* in the file manager, never executed.
- **CSP** (`tauri.conf.json`): `script-src 'self'`, no inline script, no `object`.

## Data safety rules

- Writes prepare a temp file in the same directory, sync it, and install it with
  an atomic rename operation. Existing file permissions are preserved. Saving a
  writable file in a directory where a temp file cannot be created fails safely.
- Every read/write returns an opaque `FileStamp` string. Rust builds it from exact
  filesystem integers, including device, inode, size, mtime and ctime on Unix;
  serializing floating-point millisecond timestamps through JavaScript previously
  caused false conflicts after rounding a sub-millisecond value by one ULP. Reads
  check that the bytes and stamp came from the same file version. Saving checks
  the on-disk stamp before and after preparing the replacement, including after a
  user-confirmed overwrite. Writes require an explicit condition: unchanged stamp,
  absent file, or user-confirmed overwrite. Symlink saves verify that the link still
  resolves to the original target; dangling links are not replaced.
  Save As first requires an absent target and asks before replacing an existing file.
  Installing a previously absent target uses the platform's no-replace rename
  (Linux `renameat2(RENAME_NOREPLACE)`, macOS `renamex_np(RENAME_EXCL)`, or Windows
  `MoveFileExW` without `MOVEFILE_REPLACE_EXISTING`), so a file or symlink created
  after the final check is not overwritten. If that operation is unavailable on
  the filesystem, creating a new document fails rather than risking another
  writer's file. On Linux, replacing an existing target exchanges it with the
  prepared file using `renameat2(RENAME_EXCHANGE)`. The displaced file is checked
  against a pre-save inode/metadata/content snapshot. A late conflicting edit is
  exchanged back; if recovery cannot safely restore the namespace, the displaced
  version is retained at the temp path and the save reports an I/O error. The
  installed file is also verified before success is reported. Filesystems without
  exchange support fail closed for existing-target saves. This is not a filesystem
  compare-and-swap: a writer retaining an open descriptor can still modify the
  displaced inode after verification and before cleanup. Temp-path cleanup also
  has a check→unlink race if another process replaces that hidden pathname at
  the same moment. Other platforms retain
  the final stamp check followed by rename; their existing-target race remains.
  On Windows,
  the stamp includes the volume/file ID and metadata change time when supported.
  FAT, exFAT, and some virtual filesystems may lack a strong ID or change time, so
  their stamps also include a SHA-256 hash of the file content. Stat and save checks
  stream that hash through a fixed 64 KiB buffer. An in-place concurrent writer can
  still race a hash scan on a filesystem with coarse timestamps; these checks do
  not provide an atomic filesystem transaction.
- The saved snapshot is the text that was *sent* to disk, so edits typed during an
  in-flight save stay dirty.
- Invalid UTF-8 is refused (never lossily decoded and re-saved).
- Line endings: the dominant EOL and a leading BOM are recorded at load and restored
  on save. Mixed-EOL files are normalised to the dominant EOL (the UI says so).
- Once the editor exists, every path to another document (links, Open, New, close)
  goes through its controller, which asks before discarding unsaved changes.
- The watcher watches parent directories so atomic file replacement is detected.
  Events are hints: the serialized workspace checks the current file stamp and only
  reloads a clean buffer. Dirty buffers ask before replacing text. Startup, path
  changes and watcher installation also trigger stamp checks; window focus remains a
  fallback when native notifications are unavailable. Deletion keeps the last version
  visible and recreation is detected on a later check.

## Startup path

Timeline for `scrivo medium.md` (headless cage, trace marks, ms after process start):

| ms | Main (UI) thread | Elsewhere |
|---:|---|---|
| 0 | argv; spawn prefetch + warm-up threads | prefetch: read + render the file |
| ~1–35 | Tauri/GTK init | `prewarm`: EGL vendor libs, image loader process |
| ~150 | window built, page requested | WebKit web + network processes start |
| ~250 | `boot.ts` runs; `startup_preview` IPC returns the first renderer chunk for large files | |
| ~300 | first 1.5 screens inserted and laid out; rest appended in idle slices | |
| ~320 | first frame with the document | editor chunk preloads when idle |

`SCRIVO_TRACE=1` prints these marks. Page reloads get the same prefetched result.
`bench/bench.mjs ... --trace` captures them inside the private compositor. In one
release diagnostic run under load, Tauri setup was at 76 ms, the window built at
430 ms, JavaScript started at 680 ms, the document was shown at 767 ms, and its first
frame was marked at 805 ms; the screenshot sampler observed stable content at 926 ms.
These are phase observations from one launch, not a paired performance claim.
The viewer also marks first-chunk HTML parsing, math-font readiness, and first-block layout.
Three-run medium and large traces are retained in `bench/results/diagnostic-viewer-*.txt`;
the latest phase breakdown and its limits are in `docs/HANDOVER.md`.
The prefetch worker additionally marks completion of document read and rendering;
`startup_view` marks command entry and cloning. Three-run traces show prefetch
ready by 19 ms even for the synthetic 5 MB fixture, more than 250 ms before
JavaScript asks for it. Cloning that view takes under 2 ms. These phases are
not the limiting startup path for the reviewed fixtures.

For a large startup file, `startup_preview` returns a UTF-16-safe first renderer
chunk and the reader requests the complete cached `startup_view` after the first
screen is available. Small files receive the complete view in one response.
The reader waits for the full tail before reporting settlement to Find or code
highlighting. An incomplete document has a persistent Retry warning; retry
completion refreshes the reading view's dependent features. The warning UI is a
deferred chunk and does not enter the normal startup graph.

When returning from edit mode, the workspace renders the editor's latest text,
then gives the hidden reader a measurable viewport using `visibility: hidden`
before inserting its first screen. The editor stays visible until the reader is
ready. A changed editor snapshot causes the transition to retry; abandoned reader
insertion is suspended. Source-line navigation loads enough content below its
target to avoid scroll clamping while the rest of the document is pending.

## Performance decisions

Current comparisons use the release build with `bench/ab.mjs` (paired rounds with
rotated launch order; "content" = first frame within 0.3% of a reviewed fixture-specific
first-viewport reference). The final viewport must also match that reference and settle
before the 20-second cap; at least 80% of rounds must form
valid pairs. "Complete" means viewport stability, not full-document completion. A
native E2E test checks that the large document's tail is present and scrollable.
The `--edit` mode of `bench/bench.mjs` uses a separate reviewed Scrivo editor
reference; it is a standalone measurement, not part of the paired Typora results.
Earlier experiments below used the original fixed launch order, so their deltas are
directional rather than directly comparable with the current README results.

Adopted:

| Change | Effect |
|---|---|
| Reading view first, editor lazy (initial startup JS was 18 KB instead of ~430 KB) | the largest single win (see README) |
| Outline and code highlighting loaded after first paint | keeps heading UI and grammars off the startup path |
| Render in Rust on the prefetch thread, in parallel with window creation | HTML ready before the page asks |
| Progressive insertion (first 1.5 screens, rest in idle slices) | large.md first frame 1285 → ~400 ms |
| Parse only the first safe HTML chunk before paint | −20 ms paired median on large.md, faster in 10/12 release pairs (see README) |
| Send the first renderer chunk before the full cached startup response | −38 ms first viewport on a synthetic 5 MB file (11/12 paired rounds faster); −9 ms on large.md (8/12); medium.md +6–7 ms across two 12-pair runs, mainly window timing. See handover. |
| Insert up to two HTML chunks per 12 ms slice after initial screen insertion | −419 ms paired median to full large-document insertion (12/12 pairs faster); first-viewport differences stayed within a few ms across separate 12-pair runs |
| Bound insertion under continuous animation; prioritize and cancel early Find waits | Real 800-code-block Find completes while animation leaves no idle time; startup comparison in current handover |
| Keep the reader measurable while switching from edit mode | The 443 KB document returns with its first screen instead of inserting all 800 code blocks synchronously; isolated Chromium diagnostic 561 → 145 ms; paired startup check in current handover |
| Load the math font before inserting math | first layout 142 → 86 ms (math-heavy page) |
| `system-ui` first in the body font stack | first layout 75 → 53 ms |
| Warm EGL + image loader on worker threads (`prewarm.rs`) | −48 ms (10/12 rounds) |
| Math font as uncompressed TTF, not WOFF2 | −26 ms (15/22 rounds) |

Rejected (measured, then reverted):

| Idea | Why not |
|---|---|
| `content-visibility: auto` on blocks | large.md layout 521 → 967 ms |
| Reduce first-screen insertion batch from 24 to 16 blocks | medium.md first-viewport paired median +1 ms in 12 pairs; no reliable gain |
| Skip the initial empty-article height check before inserting 24 blocks | 12-pair release runs gave −3 ms medium and +17 ms large first viewport; the large-file regression outweighed the inconclusive medium result |
| Start math-font loading before parsing the first HTML chunk | 12-pair release runs gave +5 ms medium and −1 ms large first viewport; no reliable gain |
| Raw binary `startup_view` IPC with JSON metadata and UTF-8 HTML | 12-pair release runs gave −11 ms medium, +5 ms large, and −13 ms for a synthetic 5 MB fixture; the mixed first-viewport result did not justify a custom Rust/TypeScript protocol or its postMessage number-array fallback cost |
| Targeted `content-visibility: auto` on a 5 MB code block | background insertion became fast, but scrolling into it caused a 350 ms frame gap |
| Streaming a 5 MB code block into one `<pre>` in idle slices | cumulative layout grew and a full-suite run still had a 383 ms frame gap |
| First blocks prerendered into `index.html` (via `on_web_resource_request`) | +58 ms: WebKitGTK doesn't paint parser-inserted content before the first script-driven layout, and parsing it first delays the script |
| Not preloading the editor chunk | no measurable change to first paint |
| `NO_AT_BRIDGE`, `WEBKIT_DISABLE_COMPOSITING_MODE` | no measurable change (and a11y must stay) |

Known costs we don't control: the WebKit web process start (~100 ms: launch, EGL,
fontconfig), GTK's client-side title bar icons (11 SVG decodes through glycin, ~20 ms
after warm-up), NVIDIA's EGL init (Mesa's is ~35 ms faster on the same machine).
Previously, the full rendered startup document crossed Tauri IPC before the first viewport;
temporary phase marks measured about 1 ms for a 22 KB payload, 8–12 ms for a
1.12 MB payload, and 32–39 ms for a synthetic 5.17 MB payload. First-chunk HTML
parsing itself stayed under 1 ms. See the diagnostic IPC traces in the handover.
`startup_view` still returns its JSON view contract, but large files now receive
a `startup_preview` response before the full cached view is requested.
An incomplete first-chunk-only probe matched reviewed first viewports and showed
an upper bound of −60 ms on large.md and −32 ms on a synthetic 5 MB fixture in
12 paired release rounds each. It omitted all content after the first chunk, so
these numbers were an upper bound. The complete preview/tail path and its paired
release outcomes are recorded in the handover.

## Testing

| Layer | Tool | What it asserts |
|---|---|---|
| domain, editor state | Vitest (+ fast-check) | round-trip properties, dirty/save races, link policy, commands on EditorState |
| app use cases | Vitest + memory Platform | workspace view/edit flows, controller: open, edit, save, conflict, close |
| viewer DOM | Vitest + happy-dom | progressive insertion, superseded documents, anchors, link clicks |
| renderer | cargo test (+ proptest) | markup/attribute allowlist over random input, XSS corpus, ids, lines |
| Rust I/O, startup | cargo test | atomic write, permissions, UTF-8 errors, stamps, argv, prefetch |
| app in a browser | Playwright (chromium) | what the user sees, with the real renderer via the `scrivo-render` CLI |
| native app | tauri-driver + WebKitWebDriver (`e2e-native/`) | real binary opens, edits and saves real files; giant-document test checks Unicode text across the first renderer chunk boundary |
| performance | `bench/bench.mjs`, `bench/ab.mjs` | window / content / complete / PSS; paired A/B |
| startup bundle | Vite manifest + `scripts/check-bundle.mjs` + Vitest fixture | 41 KiB static JS/CSS budget, 56 KiB budget including known prepaint window import; shims first; manifest/CSS assets and deferred graph validated and reported |
