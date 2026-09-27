# W1 document tabs: implementation design

Status: implemented and verified, 2026-09-28. Contract: `FILE_EDITOR_PARITY.md` W1.
The keyed watcher port, native canonical identity command, pure tab registry,
per-tab workspaces, and tab UI are implemented. Details and test results are in
`HANDOVER.md`.

## Ownership

The tab manager owns an ordered collection of document sessions and one active
session ID. Each session owns one existing `Workspace`, `DocumentController`,
reader, and lazily constructed `EditorApp`. Its DOM stays mounted while inactive
so CodeMirror selection, undo history, live-preview state, and scroll position
remain local to that document. New tabs begin in Reading view; only editing a tab
loads its CodeMirror view. This favors reuse of the tested single-document
lifecycle over sharing a mutable editor port across controllers. Measure memory
and tab-switch latency with several large files before accepting the tradeoff.

The tab manager owns window-level close, focus, dropped-file, and keyboard
commands and delegates document actions to the active session. A controller may
save or receive a watcher event while inactive; its title, save status, and
modal prompt must not overwrite another tab's visible controls. Tab labels show
dirty/action-needed state from that session's controller.

## Path identity and watches

Deduplicate opened files using a canonical filesystem identity from the native
adapter. Keep the user-facing path unchanged for links and Save As; identity is
only a tab registry key. Recompute identity after Save As. Untitled tabs have
unique IDs and no path key. Opening a path already present activates its tab.

Each session has its own watcher subscription. The current `watch_document`
backend and `FileSystem.watch` adapter support only one path, so extend them to
address subscriptions by tab ID before creating the manager. On a tab close,
remove only that tab's subscription. A watch event checks the owning controller;
activation also performs a stamp check to catch events missed while the app was
suspended. Document controller save and recovery queues remain per session.

## Delivery slices

1. Add keyed watcher subscriptions and tests that changing one watched file
   does not replace another subscription.
2. Add a pure tab registry with canonical-path dedup, active selection, and
   close-next semantics. Test aliases, untitled tabs, Save As identity changes,
   and empty collection behavior.
3. Compose per-tab workspaces and lazy surfaces. Add accessible tab buttons,
   dirty labels, close actions, keyboard navigation, and per-tab status.
4. Run browser and native E2E for independent buffers, undo, selection, scroll,
   watcher changes, close prompts, relaunch/recovery, and canonical aliases.
   Recheck first-paint budgets and measure tab switching on large files.

CodeMirror's [reference](https://codemirror.net/docs/ref/) stores history in
`EditorState`; its maintainer recommends keeping a distinct state per buffer
when one view is reused. This design keeps a distinct view and state per
session to keep controller ownership explicit. Each editor remains lazy.
