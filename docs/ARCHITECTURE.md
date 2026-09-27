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

Why CodeMirror live preview rather than a ProseMirror WYSIWYG: ProseMirror-based
editors (Milkdown, Tiptap) parse markdown into a rich document and serialize it back,
rewriting list markers, escapes and tables. Obsidian, Zettlr and SilverBullet use
CodeMirror 6 live preview for this reason; it also virtualises the viewport.

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

- Writes are atomic: temp file in the same directory → fsync → rename. Existing file
  permissions are preserved. A failed write never truncates the original. Saving a
  writable file in a directory where a temp file cannot be created fails safely.
- Every read/write returns a `FileStamp` (mtime + size + Unix metadata change time).
  Reads check that the bytes and stamp came from the same file version. Saving checks
  the on-disk stamp before and after preparing the replacement. Writes require an
  explicit condition: unchanged stamp, absent file, or user-confirmed overwrite.
  Save As first requires an absent target and asks before replacing an existing file.
  No cross-process compare-and-rename is atomic, so a
  writer racing in the final gap before rename can still be overwritten. On Windows,
  where the stamp has no metadata change time, a same-size edit that restores mtime
  may also be missed.
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
| ~250 | `boot.ts` runs; `startup_view` IPC returns the rendered document | |
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
| Load the math font before inserting math | first layout 142 → 86 ms (math-heavy page) |
| `system-ui` first in the body font stack | first layout 75 → 53 ms |
| Warm EGL + image loader on worker threads (`prewarm.rs`) | −48 ms (10/12 rounds) |
| Math font as uncompressed TTF, not WOFF2 | −26 ms (15/22 rounds) |

Rejected (measured, then reverted):

| Idea | Why not |
|---|---|
| `content-visibility: auto` on blocks | large.md layout 521 → 967 ms |
| Targeted `content-visibility: auto` on a 5 MB code block | background insertion became fast, but scrolling into it caused a 350 ms frame gap |
| Streaming a 5 MB code block into one `<pre>` in idle slices | cumulative layout grew and a full-suite run still had a 383 ms frame gap |
| First blocks prerendered into `index.html` (via `on_web_resource_request`) | +58 ms: WebKitGTK doesn't paint parser-inserted content before the first script-driven layout, and parsing it first delays the script |
| Not preloading the editor chunk | no measurable change to first paint |
| `NO_AT_BRIDGE`, `WEBKIT_DISABLE_COMPOSITING_MODE` | no measurable change (and a11y must stay) |

Known costs we don't control: the WebKit web process start (~100 ms: launch, EGL,
fontconfig), GTK's client-side title bar icons (11 SVG decodes through glycin, ~20 ms
after warm-up), NVIDIA's EGL init (Mesa's is ~35 ms faster on the same machine).

## Testing

| Layer | Tool | What it asserts |
|---|---|---|
| domain, editor state | Vitest (+ fast-check) | round-trip properties, dirty/save races, link policy, commands on EditorState |
| app use cases | Vitest + memory Platform | workspace view/edit flows, controller: open, edit, save, conflict, close |
| viewer DOM | Vitest + happy-dom | progressive insertion, superseded documents, anchors, link clicks |
| renderer | cargo test (+ proptest) | markup/attribute allowlist over random input, XSS corpus, ids, lines |
| Rust I/O, startup | cargo test | atomic write, permissions, UTF-8 errors, stamps, argv, prefetch |
| app in a browser | Playwright (chromium) | what the user sees, with the real renderer via the `scrivo-render` CLI |
| native app | tauri-driver + WebKitWebDriver (`e2e-native/`) | real binary opens, edits and saves real files |
| performance | `bench/bench.mjs`, `bench/ab.mjs` | window / content / complete / PSS; paired A/B |
| startup bundle | Vite manifest + `scripts/check-bundle.mjs` + Vitest fixture | 40 KiB static JS/CSS budget, 56 KiB budget including known prepaint window import; shims first; manifest/CSS assets and deferred graph validated and reported |
