# Scrivo — architecture

Scrivo is a fast, open-source markdown viewer and Typora-style editor. A file opens in
a **reading view** rendered by Rust while the webview boots; Ctrl/⌘+E switches to a
one-pane **editor** where the syntax melts away as you write, and the file on disk is
exactly what you typed. `scrivo --edit file.md` (or `-e`) starts in the editor;
untitled and new files always do.

## Principles

1. **Startup is the product.** Showing a document needs one ~18 KB script and HTML the
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
| Renders with | `scrivo-render` (Rust: pulldown-cmark + math-core → HTML + MathML) | CodeMirror 6 live preview (lezer markdown, KaTeX) |
| Loaded | at startup (`src/viewer/viewer.ts`) | on demand (`src/editor-app.ts`), preloaded when idle |
| Owns the text | no: shows the file or the editor's buffer | yes, once it exists |

`src/app/workspace.ts` is the use case that switches between them. Once the editor has
been created it owns the document: the reading view then renders the editor's buffer,
saving goes through the editor's controller, and positions carry over both ways as
1-based source lines (every rendered block has `data-line`). Operations run through a
serial queue so a click during a pending switch can't interleave with it.

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
  viewer/viewer     ViewerPort over the DOM: progressive insertion, line ↔ scroll
  editor/           CodeMirror integration (may import domain)
  editor-app        lazy chunk: builds the editor + controller, returns an EditorHandle
  platform/
    tauri           Platform over @tauri-apps/* (the only module importing them)
    memory          in-memory Platform for unit tests
    dev             browser dev Platform: memory files + renderer over HTTP
  ui/               DOM chrome: status bar, prompter (toasts, dialogs)
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
  permissions are preserved. A failed write never truncates the original.
- Every read/write returns a `FileStamp` (mtime + size). Saving compares the on-disk
  stamp first and refuses to clobber a file that changed externally unless the user
  confirms.
- The saved snapshot is the text that was *sent* to disk, so edits typed during an
  in-flight save stay dirty.
- Invalid UTF-8 is refused (never lossily decoded and re-saved).
- Line endings: the dominant EOL and a leading BOM are recorded at load and restored
  on save. Mixed-EOL files are normalised to the dominant EOL (the UI says so).
- Once the editor exists, every path to another document (links, Open, New, close)
  goes through its controller, which asks before discarding unsaved changes.

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

## Performance decisions

All measured on the release build with `bench/ab.mjs` (interleaved rounds, paired
medians of "content" = first frame within 3% of the final one) unless noted.

Adopted:

| Change | Effect |
|---|---|
| Reading view first, editor lazy (startup JS 18 KB instead of ~430 KB) | the largest single win (see README) |
| Render in Rust on the prefetch thread, in parallel with window creation | HTML ready before the page asks |
| Progressive insertion (first 1.5 screens, rest in idle slices) | large.md first frame 1285 → ~400 ms |
| Load the math font before inserting math | first layout 142 → 86 ms (math-heavy page) |
| `system-ui` first in the body font stack | first layout 75 → 53 ms |
| Warm EGL + image loader on worker threads (`prewarm.rs`) | −48 ms (10/12 rounds) |
| Math font as uncompressed TTF, not WOFF2 | −26 ms (15/22 rounds) |

Rejected (measured, then reverted):

| Idea | Why not |
|---|---|
| `content-visibility: auto` on blocks | large.md layout 521 → 967 ms |
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
