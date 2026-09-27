// Entry point and composition root.
//
// Startup is the product: an existing file is shown in the reading view from HTML the
// backend rendered while the webview was booting, so first paint needs only this
// module (a few KB). The editor, CodeMirror and its grammars load on demand and are
// preloaded once the page is idle.
//
// Shims patch globals that libraries read at load; vite.config.ts makes them run first.
import './shims/idle-callback';
import './styles/base.css';
import './styles/viewer.css';
import type { Platform } from './app/ports';
import { createWorkspace } from './app/workspace';
import type { EditorApp } from './editor-app';
import { createFindBar, type FindBar } from './ui/find-bar';
import { createTauriPlatform, fileUrl, isTauri, traceMark } from './platform/tauri';
import { createPrompter } from './ui/prompter';
import { createStatusBar } from './ui/status-bar';
import { createFinder } from './viewer/find';
import { createViewer } from './viewer/viewer';
import type { Outline } from './ui/outline';

traceMark('js start');

const tauri = isTauri();
// The browser dev platform (in-memory files) never ships in the app's startup path.
const platform: Platform = tauri ? createTauriPlatform() : (await import('./platform/dev')).createDevPlatform();
const loadEditorModule = () => import('./editor-app');
const FIND_REFRESH_MS = 250;

const byId = (id: string) => document.getElementById(id)!;
const prompter = createPrompter(document.body);
const status = createStatusBar(document.body);
const viewer = createViewer(byId('viewer'), byId('document'), (href) => void workspace.followLink(href), traceMark,
  (error) => prompter.notify(`Could not finish loading the document: ${error.message}`));
const modKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
let editorApp: EditorApp | null = null;
let outline: Outline | null = null;
let watchVersion = 0;
let watchTail: Promise<void> = Promise.resolve();

// Find in the reading view. Its code is small and in the startup chunk so the first
// Ctrl+F opens synchronously: with a lazy chunk, keys typed right after it were lost.
let findBar: FindBar | null = null;
const getFindBar = (): FindBar => {
  if (!findBar) {
    const bar = createFindBar(document.body, createFinder(byId('viewer'), byId('document'), viewer), () => viewer.focus());
    viewer.onShown(() => bar.refresh());
    findBar = bar;
  }
  return findBar;
};

// Keep grammar loading and token DOM work off the startup path. The viewer has
// already painted when idle callbacks run, and large documents finish progressive
// insertion before highlighting starts.
viewer.onShown(() => {
  const version = viewer.version();
  requestIdleCallback(() => {
    void viewer.settled()
      .then(async () => {
        if (version !== viewer.version()) return;
        if (!byId('document').querySelector('pre[data-lang] > code')) return;
        const { highlightCodeBlocks } = await import('./viewer/code-highlight');
        let lastFindRefresh = 0;
        await highlightCodeBlocks(byId('document'), () => version === viewer.version(), () => {
          viewer.invalidateTextNodes();
          // Re-indexing a large document on every idle batch makes Find dominate
          // highlighting. Keep an open search current without scanning every block.
          if (findBar?.isOpen() && performance.now() - lastFindRefresh >= FIND_REFRESH_MS) {
            findBar.refresh();
            lastFindRefresh = performance.now();
          }
        });
        if (version === viewer.version()) findBar?.refresh();
      })
      .catch(() => undefined);
  });
});

viewer.onShown((doc) => {
  outline?.setHeadings(doc.headings);
  if (outline || doc.headings.length === 0) return;
  const version = viewer.version();
  requestIdleCallback(() => {
    void import('./ui/outline')
      .then(({ createOutline }) => {
        if (version !== viewer.version()) return;
        outline ??= createOutline(document.body, (id) => viewer.scrollToAnchor(id), () => viewer.focus());
        outline.setHeadings(doc.headings);
      })
      .catch(() => undefined);
  });
});

const reportPath = (path: string | null) => {
  const version = ++watchVersion;
  requestIdleCallback(() => {
    if (version !== watchVersion) return;
    watchTail = watchTail
      .then(async () => {
        if (version !== watchVersion) return;
        await platform.fs.watch(path, () => void workspace.checkDisk());
        if (version === watchVersion && path !== null) await workspace.checkDisk();
      })
      .catch(() => undefined);
  }, { timeout: 2000 });
};

const workspace = createWorkspace({
  platform,
  viewer,
  notify: prompter.notify,
  scheduleIdle: (run) => void requestIdleCallback(run),
  onPathChanged: reportPath,
  showSurface(mode) {
    document.body.dataset.mode = mode;
    if (mode === 'view') {
      status.set(`Reading · ${modKey}E to edit`);
      viewer.focus();
    } else {
      findBar?.close();
      outline?.close();
      viewer.suspend();
      editorApp?.shown();
    }
  },
  prepareView() {
    document.body.dataset.preparingView = 'true';
    return () => { delete document.body.dataset.preparingView; };
  },
  async loadEditor() {
    const { createEditorApp } = await loadEditorModule();
    editorApp = createEditorApp({
      platform,
      prompter,
      status,
      parent: byId('editor'),
      fileUrl: tauri ? fileUrl : (path) => path,
      domFileDrop: !tauri,
      onDocumentPathChanged: reportPath,
      commands: {
        toggleReading: () => void workspace.toggle(),
        save: () => void workspace.save(),
        saveAs: () => void workspace.saveAs(),
        open: () => void workspace.open(),
        newDocument: () => void workspace.newDocument(),
      },
    });
    return editorApp;
  },
});

// Reading-view shortcuts; the editor has its own keymap for the same keys.
window.addEventListener('keydown', (event) => {
  if (workspace.mode() !== 'view' || event.altKey) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const findStep = (key === 'g' && mod) || (event.key === 'F3' && !mod) ? (event.shiftKey ? -1 : 1) : 0;
  if (findStep !== 0) {
    event.preventDefault();
    findBar?.next(findStep);
    return;
  }
  if (event.key === 'Escape') {
    findBar?.dismiss();
    return;
  }
  if (!mod || event.shiftKey) return;
  const run = {
    e: () => workspace.toggle(),
    o: () => workspace.open(),
    n: () => workspace.newDocument(),
    s: () => workspace.save(),
    f: () => getFindBar().open(),
  }[key];
  if (run) {
    event.preventDefault();
    void run();
  }
});

await workspace.start();
traceMark('document shown');
void viewer.settled().then(() => traceMark('document settled'), () => undefined);

platform.window.onCloseRequested(workspace.requestClose);
platform.window.onFocus(() => void workspace.checkDisk());
requestAnimationFrame(() => requestAnimationFrame(() => traceMark('first frame with document')));

// The native window queues drops until this deferred listener is ready.
requestIdleCallback(() => void import('./app/register-file-drops').then((module) =>
  module.registerFileDrops(platform.window, workspace, () => editorApp, prompter.notify)), { timeout: 3000 });

if (!tauri) {
  Object.assign(window, {
    __scrivo: {
      workspace,
      viewer,
      platform,
      get editor() {
        return editorApp?.editor;
      },
      get controller() {
        return editorApp?.controller;
      },
    },
  });
}
