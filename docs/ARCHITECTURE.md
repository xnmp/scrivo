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

The editing outline indexes the complete Markdown in one shared module worker
(`editor/headings.worker.ts`). Each editor coalesces changes for 250 ms, permits
one request in flight, and rejects stale results. The worker imports only the
Lezer block grammar and inert entity decoder, avoiding fenced code grammars and
CodeMirror view code. Navigation maps indexed heading positions through the
editor's composed change descriptions; it unfolds containing ranges and focuses
the current source line. Closed outlines defer row creation; open outlines reuse
existing buttons instead of rebuilding the DOM on each input.

`domain/properties.ts` validates bounded leading YAML and returns scalar source
changes. The Properties panel applies valid string, number, and boolean inputs
as ordinary editor transactions. A field's typing groups into an undo step;
field boundaries isolate history. Each change checks its expected scalar against
the current document, preserving comments/order/unknown constructs. Multiline
strings, custom tags, collections, aliases, and unsafe integers remain in source.
Malformed or oversized YAML is never rewritten by the form.

Editor preferences are immutable validated values in `domain/editor-preferences.ts`.
The deferred platform store persists `scrivo.editor-preferences.v1` in WebView
local storage and broadcasts changes to mounted editors and other windows.
Storage failures retain usable session settings with visible persistence feedback.
CodeMirror compartments reconfigure line numbers, viewport-only indentation
guides, spellcheck, wrapping, and visual tab width without editing source/history.
The settings and properties panels are mutually exclusive and document-local;
preference values are shared across all documents.

Appearance is a separate window-level store. Small validated preferences persist
in `scrivo.appearance.v1`; the theme library is loaded lazily from `scrivo.themes.v1`.
The selected theme's ID, name, and CSS form one atomic `scrivo.active-theme.v1`
snapshot, applied before layout and reconciled into the library after partial
storage failures. Ordinary controls do not rewrite theme CSS. Native storage events
update other windows. Obsidian CSS variables bridge to the app's existing tokens;
`theme-light`/`theme-dark` classes and per-level heading colors cover both reader
and live preview. Imported CSS has the same native CSP as the rest of the app.

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
    recovery.rs     private atomic recovery copies in app data
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
- Named files autosave after a 2-second editing pause through the same serial
  controller queue and conditional write API as manual Save. A failed or conflicting
  autosave enters a visible action-needed state and pauses until the user acts.
  Untitled documents receive recovery copies but no automatic user-file path.
- The app-layer `RecoveryStore` port writes each dirty document's current text,
  path, observed stamp, and text format to the Tauri app-data `recovery/` directory.
  The native adapter uses a private directory and files on Unix, a synced temporary
  file, and an atomic replacement. The first dirty change is queued immediately;
  later changes are throttled to 500 ms. The latest copy for each document remains
  until save or explicit discard; seven-day and 100 MiB limits prune redundant
  history only. The asynchronous IPC/write interval is a durability window: a
  process killed before the write finishes can lose the last change. Startup offers
  matching and unmatched copies, and restoring a copy never silently overwrites a
  newer disk file.
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

Appearance preferences and selected theme CSS apply before document layout. The
theme library and controls remain deferred. Tab-shell import start/end and readiness
trace marks help diagnose the deferred application controls. Earlier shell loading
was tried and rejected after paired measurements showed mixed results. The bundle
gate retains its 41 KiB static and 56 KiB known prepaint budgets.

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

Playwright serves the production web build with Vite preview. The browser
adapter still uses in-memory files and the Rust CLI renderer bridge, which is
registered for both dev and preview servers. This verifies emitted workers,
code splitting, and styles while avoiding hundreds of development-module
requests per cold navigation. `bun run dev` remains available for development.

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

## Commands, chrome and themes (2026-10-03)

`domain/commands.ts` defines stable command IDs, labels, groups and default physical
key chords. `domain/hotkeys.ts` normalizes events and validates bounded chords;
`domain/recents.ts` validates a bounded identity-deduplicated file history;
`domain/search.ts` ranks word and ordered-character matches. Infrastructure
persistence lives in `platform/command-preferences.ts`; the tab coordinator owns
execution, active-document routing and successful-file history updates.

One window capture dispatcher routes application commands. Mounted editors opt into
external shortcuts, removing overlapping application/format/history/fold bindings
and conflicting CodeMirror defaults; structural Enter/Tab/Backspace and ordinary
text movement stay in CodeMirror. Standalone editor callers retain legacy defaults.
Properties exposes a commit boundary to saves and disables its legacy save binding
when the shared dispatcher owns commands. Native/form text fields retain text undo.

`ui/window-chrome.ts` composes header, menu, dialogs, window operations and document
label; picker commands execute after the native dialog close event restores focus.
The WindowPort close-listener registration is awaited before exposing custom window
controls. Its handler awaits initial session readiness and delegates dirty/recovery
policy to every Workspace. Readiness is released in finally even on startup failure.
Native close uses close(), preserving that guard; destroy() remains an internal port.

Linux/Windows disable native decorations; macOS keeps them. Only the tab list scrolls,
so native window controls stay visible. Dragging uses mouse-down click detail and a
full-height blank region. Native API imports stay behind the Tauri platform adapter.

Bundled original themes are registered by deferred Appearance UI. A selected theme's
atomic CSS snapshot still applies before document layout, including on relaunch.
Registration reconciles updated packaged CSS for an active builtin ID; builtins are
immutable and imports retain their existing limits. No community-theme network fetch
or Obsidian vault/plugin layer is introduced.

## Unified settings, substitutions and selection paint

`ui/settings.ts` owns one modal with Appearance, Editor, Hotkeys and Substitutions
sections. Ctrl/⌘+, opens it; commands route directly to a section. Embedded forms
share this lifecycle and return focus on close. Escape cancels shortcut recording
first, then closes the dialog. Explicit Escape handling is necessary for native
WebKitGTK search controls. The global command dispatcher defers to the recorder.
The header exposes the main menu, tabs and native controls; document panels and
reading/editing are reached through commands instead of permanent toolbar buttons.
Final-tab close delegates to the native window close guard, including dirty checks.

Substitution contracts live in `domain/substitutions.ts`; storage is separate in
`platform/substitutions.ts` (`scrivo.substitutions.v1`). Rules are ordered, bounded
and immutable. Literal suffixes or anchored RE2 expressions match up to 2,048
characters before each cursor. The RE2JS dependency prevents regex backtracking;
lookaround and backreferences are unsupported. The serialized envelope is bounded
at 2 MiB, with at most 100 rules, 128 source characters and 2,048 replacement
characters. Invalid JSON/rules fail safely; denied persistence retains session state.

`editor/substitutions.ts` intercepts only direct single-character typing, preserves
the default input transaction and all selections, and isolates replacement undo.
Immediate Backspace restoration is available when every cursor was substituted;
mixed cursors retain ordinary Backspace. Paste, IME composition and existing
Markdown do not trigger replacements. Rendered table inputs share the matcher but
reject control-character outputs because their input is single-line. Their caret
and selection must still match for immediate restoration. Table typing groups in
history; structural row/column commands remain separate undo events. Hover/focus
extension strips call existing table commands and focus the new cell synchronously
when mounted, using a frame only when the widget has not yet been rendered.

Ctrl/⌘+D delegates synchronously to CodeMirror's `selectNextOccurrence`. Loading the
selection command asynchronously lost rapid consecutive shortcuts; the dependency
is therefore in the already deferred editor module, not the reading startup path.

Native WebKit paints some selected list ancestors across block backgrounds.
`viewer/text-selection.ts` keeps the browser's Selection unchanged and paints
clipped text-node ranges with CSS Custom Highlights. Native selection paint is
suppressed only while custom ranges exist. Visible renderer blocks are located by
binary search, bounding scroll work; unsupported engines keep normal selection.


## In-app Save As

`ui/save-dialog.ts` is a deferred native dialog with filename/folder inputs, native
focus trapping, Enter submission, Escape cancellation and prior-focus restoration.
It returns a path only; controller conditional writes and conflict prompts remain
authoritative. `domain/save-location.ts` validates platform-specific absolute paths,
rejects path-like/control filenames and preserves literal names/extensions. Drive
roots keep their separator. Native homeDir supplies both the initial folder and
platform path style. Tauri validates identity/regular-file stat before closing the
modal; failure stays inline with fields retained. Actual writes may still fail or
race after this read, so the existing write guards/error status remain required.
Memory platform accepts an optional picker dependency; browser dev uses the same UI,
while queued test answers and pure-controller unit tests retain their old contract.
The system Open dialog is unchanged. No filesystem browsing or folder creation is
included in this filename/folder modal.


Settings initialization is demand-driven through the chrome facade: one module/
instance promise, retry on import failure, awaited commands and synchronous
recording inspection. Pending open intents use AbortController so Escape or a
newer command cannot leave a late dialog. The tiny bundled palette registry is
separate from forms and reconciles selected packaged CSS during chrome startup.
Reading startup therefore avoids constructing settings controls or loading regex
matching and the imported-theme library. Saved active CSS still applies in boot.
Selection paint suppression targets article descendants, not all HTML descendants;
WebKit can blank content when a body-boundary Range meets global transparency.
