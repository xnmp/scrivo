# Scrivo — architecture

Scrivo is a fast, open-source, Typora-style markdown editor: one pane, the syntax
melts away as you write, and the file on disk is exactly what you typed.

## Principles

1. **The markdown text is the single source of truth.** Rendering is a projection
   (CodeMirror decorations) over the text. There is no markdown → AST → markdown
   serializer anywhere, so the editor can never reformat or drop content. Save
   writes back the same bytes, modulo the line-ending/BOM format recorded at load.
2. **Pay only for what the document uses.** The critical path is CodeMirror core +
   the markdown grammar + live preview. Code-block grammars, KaTeX, search panel and
   native dialogs are dynamic imports triggered by content or by user action.
3. **Only render what is visible.** CodeMirror virtualises the viewport; inline
   decoration builders only walk `view.visibleRanges`.
4. **Domain logic is pure and headless-testable.** `EditorState` works in Node, so
   decoration computation, commands and document lifecycle are tested without a DOM.
5. **Infrastructure sits behind ports.** The app depends on the `Platform` interface
   (`src/app/ports.ts`). Tauri implements it in production; an in-memory adapter
   backs unit tests, the browser dev build and the Playwright suite.

## Why CodeMirror 6 live preview instead of a ProseMirror WYSIWYG

ProseMirror-based editors (Milkdown, Tiptap) parse markdown into a rich document and
serialize it back on save, which rewrites list markers, escapes, spacing and tables.
Obsidian, Zettlr and SilverBullet all use CodeMirror 6 live preview for exactly this
reason; it also gives us viewport virtualisation, which is why large files stay fast.
Typora renders the entire document as DOM, so its open time grows linearly with size.

## Layers

```
src/
  domain/          pure TS: no DOM, no EditorView, no Tauri
    text-format    EOL/BOM detection + lossless decode/encode
    document       DocumentSession: path, saved snapshot, dirty, title, stamps
    external       what to do when the file changed on disk
    reveal         when hidden syntax becomes visible (cursor/selection policy)
    table, outline, stats ...
  editor/          CodeMirror integration (may import domain)
    setup          extension composition; Compartments for mode + theme
    markdown       grammar config (GFM + math + front matter)
    live-preview/  decoration builders + widgets
    commands       formatting commands (StateCommand) + keymap
  app/
    ports          Platform interface (files, dialogs, window)
    controller     use-cases: open, save, save-as, new, close, reload
  platform/
    tauri          Platform over @tauri-apps/api (only file that imports it)
    memory         in-memory Platform for tests and browser dev
  ui/              DOM chrome: status bar, outline, modal dialogs
  main.ts          composition root

src-tauri/src/
  lib.rs           builder, plugin + command registration, window setup
  commands.rs      thin #[tauri::command] adapters, error mapping
  document_io.rs   read (UTF-8 validation) and atomic write; no Tauri types
  startup.rs       CLI parsing; prefetches the initial file while the webview boots
```

Dependency direction: `ui`/`editor`/`platform` → `app` → `domain`. Nothing in `domain`
imports from any other layer. Only `platform/tauri.ts` imports `@tauri-apps/*`.

## Data safety rules

- Writes are atomic: temp file in the same directory → fsync → rename. Existing file
  permissions are preserved. A failed write never truncates the original.
- Every read/write returns a `FileStamp` (mtime + size). Saving compares the on-disk
  stamp first and refuses to clobber a file that changed externally unless the user
  confirms.
- The saved snapshot is the text that was *sent* to disk, not the editor contents at
  completion time, so edits typed during an in-flight save stay dirty.
- Invalid UTF-8 is refused (never lossily decoded and re-saved).
- Line endings: the dominant EOL and a leading BOM are recorded at load and restored
  on save. Mixed-EOL files are normalised to the dominant EOL (the UI says so).
- Raw HTML in markdown is shown as source, never injected, so a document cannot run
  script with IPC access.

## Startup path

1. `main` parses argv and starts reading the file on a worker thread.
2. Tauri creates the window (background colour already themed) and the webview.
3. The page loads one JS chunk + inlined CSS; `main.ts` calls `initial_document`,
   which returns the prefetched read.
4. The EditorState is created, the first viewport is decorated and painted.
5. Everything else loads after first paint or on demand.

`SCRIVO_TRACE=1` prints timing marks for each step to stdout.

## Testing

| Layer | Tool | What it asserts |
|---|---|---|
| domain, editor state | Vitest (+ fast-check) | round-trip properties, dirty/save races, reveal policy, commands on EditorState |
| app controller | Vitest + memory Platform | user flows: open, edit, save, conflict, close with unsaved changes |
| Rust I/O | cargo test (+ proptest) | atomic write, permissions, UTF-8 errors, stamp conflicts |
| editor in a browser | Playwright (WebKit + Chromium) | what the user sees and what lands in the file |
| native app | tauri-driver + WebKitWebDriver | real binary opens, edits and saves real files |
| performance | bench/bench.mjs | window / first paint / visually complete / PSS vs Typora |
