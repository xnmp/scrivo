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
import { createTauriPlatform, fileUrl, isTauri, traceMark } from './platform/tauri';
import { createPrompter } from './ui/prompter';
import { createStatusBar } from './ui/status-bar';
import { createViewer } from './viewer/viewer';

traceMark('js start');

const tauri = isTauri();
// The browser dev platform (in-memory files) never ships in the app's startup path.
const platform: Platform = tauri ? createTauriPlatform() : (await import('./platform/dev')).createDevPlatform();
const loadEditorModule = () => import('./editor-app');

const byId = (id: string) => document.getElementById(id)!;
const prompter = createPrompter(document.body);
const status = createStatusBar(document.body);
const viewer = createViewer(byId('viewer'), byId('document'), (href) => void workspace.followLink(href));
const modKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
let editorApp: EditorApp | null = null;

const workspace = createWorkspace({
  platform,
  viewer,
  notify: prompter.notify,
  showSurface(mode) {
    document.body.dataset.mode = mode;
    if (mode === 'view') {
      status.set(`Reading · ${modKey}E to edit`);
      viewer.focus();
    } else {
      editorApp?.shown();
    }
  },
  async loadEditor() {
    const { createEditorApp } = await loadEditorModule();
    editorApp = createEditorApp({
      platform,
      prompter,
      status,
      parent: byId('editor'),
      fileUrl: tauri ? fileUrl : (path) => path,
      commands: {
        toggleReading: () => void workspace.toggle(),
        open: () => void workspace.open(),
        newDocument: () => void workspace.newDocument(),
      },
    });
    return editorApp;
  },
});

// Reading-view shortcuts; the editor has its own keymap for the same keys.
window.addEventListener('keydown', (event) => {
  if (workspace.mode() !== 'view' || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  const run = {
    e: () => workspace.toggle(),
    o: () => workspace.open(),
    n: () => workspace.newDocument(),
    s: () => workspace.save(),
  }[event.key.toLowerCase()];
  if (run && !event.shiftKey) {
    event.preventDefault();
    void run();
  }
});

await workspace.start();
traceMark('document shown');
void viewer.settled().then(() => traceMark('document settled'));

platform.window.onCloseRequested(workspace.requestClose);
platform.window.onFocus(() => void workspace.checkDisk());
requestAnimationFrame(() => requestAnimationFrame(() => traceMark('first frame with document')));

// Warm the editor so the first switch is instant; idle so reading isn't disturbed.
requestIdleCallback(() => void loadEditorModule(), { timeout: 3000 });

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
