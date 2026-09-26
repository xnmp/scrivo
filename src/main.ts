// Composition root: picks the platform, builds the editor and wires the use-cases.
// Shims patch globals that libraries read at load; vite.config.ts makes them run first.
import './shims/idle-callback';
import './styles/app.css';
import { createDocumentController } from './app/controller';
import type { Platform } from './app/ports';
import { createEditor } from './editor/setup';
import { createDevPlatform } from './platform/dev';
import { createTauriPlatform, fileUrl, isTauri, traceMark } from './platform/tauri';
import { createPrompter } from './ui/prompter';
import { createStatusBar } from './ui/status-bar';

traceMark('js start');

const tauri = isTauri();
const platform: Platform = tauri ? createTauriPlatform() : createDevPlatform();
// Start fetching the document before building the UI; the backend prefetched it.
const startup = platform.startupDocument();

const host = document.body;
const prompter = createPrompter(host);

const editor = createEditor({
  parent: document.getElementById('editor')!,
  fileUrl: tauri ? fileUrl : (path) => path,
  commands: {
    save: () => void controller.save(),
    saveAs: () => void controller.saveAs(),
    open: () => void controller.open(),
    newDocument: () => void controller.newDocument(),
  },
  onDocChanged: () => {
    controller.contentChanged();
    status.update();
  },
});

const controller = createDocumentController({ platform, prompter, editor: editor.port });
const status = createStatusBar(host, () => editor.view.state.doc.iter(), () => (editor.sourceMode() ? 'Source' : ''));

platform.window.onCloseRequested(controller.requestClose);
platform.window.onFocus(() => void controller.checkDisk());

await controller.start(await startup);
traceMark('document loaded');
editor.view.focus();
status.update(0);
requestAnimationFrame(() => requestAnimationFrame(() => traceMark('first frame with document')));

if (!tauri) Object.assign(window, { __scrivo: { editor, controller, platform } });
