# File editor behavior audit — 2026-09-28

This is the milestone 0 checkpoint for `FILE_EDITOR_PARITY.md`. “Verified” means
a native WebKitGTK test asserts the user-visible result or real file bytes;
“browser” means a Chromium test of the browser adapter. Rows without a native
check remain acceptance work for their milestone.

| Workflow | Current behavior | Evidence and gap |
|---|---|---|
| Open / first view | Named Markdown opens in Rust-rendered reading view; `--edit` opens the editor. Missing and invalid UTF-8 paths show an error. | Native `reading-heading`, `missing-file`, `invalid-utf8`, and `reading-toggle` specs. |
| Save / Save As | `Ctrl+S` saves the editor text; Save As and untitled Save choose a path. A leading BOM and dominant EOL are preserved. | Native `save-bytes`; browser `saving`. |
| Autosave / status | Named dirty files save after 2 seconds idle. Status exposes Edited, Saving, Saved, and Action needed; failure is retryable. | Native `save-bytes` and `autosave-conflict`; browser `autosave`; controller unit tests. |
| External edit / conflict | Reading view reloads a changed file; dirty editor retains its buffer and asks. Conditional writes prevent an automatic overwrite; manual Save can reload, save elsewhere, or confirm overwrite. | Native `reading-watch` and `autosave-conflict`; browser `external-change`; controller tests cover write races. |
| Recovery / close | Dirty and untitled text is copied to private app data. Relaunch offers Restore or Discard, including when the original named file was deleted or another file is being viewed. Close asks about unsaved work. | Native `recovery`, `recovery-named`, `recovery-other`; browser `recovery`, `closing`; controller/workspace tests. A kill before asynchronous recovery IPC completes can lose the last edit. |
| Find / replace | Reading-view Find navigates the rendered document; CodeMirror offers editor find/replace. | Browser `viewer-find` and `find`; native reading-view Find and editor replace need further outcome checks. |
| Source / live preview | `Ctrl+/` switches between CodeMirror source and live preview, with literal Markdown as the document text. | Browser `source-mode`, `live-preview`; native `reading-toggle`. |
| Tables | Live preview edits rendered cells with keyboard navigation, row/column context menu, save, and undo. | Native `table`; browser `tables`; broader escaped/malformed/long table E2 gate remains. |
| Paste / drop | Plain text editing works. Rich HTML conversion and local attachment import are not implemented. | I1/I2 acceptance work. |

At this checkpoint the web startup bundle gate remains 41 KiB startup JS/CSS
and 56 KiB known prepaint JS/CSS. The exact build output and full test counts
are recorded in `HANDOVER.md` after each verified checkpoint.
