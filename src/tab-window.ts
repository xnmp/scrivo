// Document-tab machinery, loaded after the initial reading view reaches the screen.
import { displayName, windowTitle } from './domain/document';
import { emptyTabs, openTab as addTab, activateTab as selectTab, closeTab as removeTab, updateTabIdentity, type TabRegistry } from './app/tab-registry';
import { FileError, type Platform, type Heading, type ViewDocument } from './app/ports';
import { createWorkspace, type Workspace } from './app/workspace';
import type { EditorApp } from './editor-app';
import { createFindBar, type FindBar } from './ui/find-bar';
import { fileUrl, traceMark } from './platform/tauri';
import type { Prompter } from './app/ports';
import { createStatusBar } from './ui/status-bar';
import { createTabBar } from './ui/tabs';
import { createFinder } from './viewer/find';
import { createViewer, type Viewer } from './viewer/viewer';
import type { Outline } from './ui/outline';
import { commands, bindings, eventChord, matchKeyCommand, displayChord } from './domain/commands';
import { commandPreferences } from './platform/command-preferences';
import { createWindowChrome } from './ui/window-chrome';
import { createZoomControls } from './app/zoom';
import { isZoomCommand } from './domain/zoom';

export async function startTabWindow(context: {
  readonly platform: Platform;
  readonly tauri: boolean;
  readonly prompter: Prompter;
  readonly viewer: Viewer;
  readonly preShown: ViewDocument | null;
  readonly setFollowLink: (handler: (href: string) => void) => void;
}): Promise<void> {
const { platform, tauri, prompter, preShown } = context;
if (tauri) void import('./viewer/text-selection').then(module => module.installTextSelection()).catch(() => undefined);
document.body.dataset.native = String(tauri);
const loadEditorModule = () => import('./editor-app');
const FIND_REFRESH_MS = 250;
const preferences = commandPreferences();
const zoom = createZoomControls(scale => platform.window.setZoom(scale));
const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const commandHint = (id: string) => bindings(commands.find(command => command.id === id)!, preferences.hotkeys(), mac).map(key => displayChord(key, mac)).join(' / ');
const readingHint = () => {
  const shortcut = commandHint('reading');
  return `Reading · ${shortcut ? `${shortcut} to edit` : 'Right-click tab bar for commands'}`;
};
const panels = document.getElementById('tab-panels')!;
let tabs: TabRegistry = emptyTabs();
let outline: Outline | null = null;

interface Session {
  readonly id: string;
  readonly host: HTMLElement;
  readonly viewer: Viewer;
  readonly workspace: Workspace;
  readonly status: ReturnType<typeof createStatusBar>;
  readonly headings: () => readonly Heading[];
  readonly findBar: () => FindBar;
  readonly editorApp: () => EditorApp | null;
  readonly dispose: () => Promise<void>;
}
const sessions = new Map<string, Session>();
const reservedIdentities = new Map<string, { path: string; identity: string }>();
let identityTail: Promise<void> = Promise.resolve();
let releaseInitialIdentity!: () => void;
const initialIdentityReady = new Promise<void>((resolve) => { releaseInitialIdentity = resolve; });
const activeSession = (): Session | null => sessions.get(tabs.activeId ?? '') ?? null;
await platform.window.onCloseRequested(async () => {
  await initialIdentityReady;
  for (const tab of tabs.tabs) {
    if (!(await sessions.get(tab.id)?.workspace.requestClose())) {
      for (const open of sessions.values()) open.workspace.resumeAfterCancelledClose();
      return false;
    }
  }
  return true;
});
let outlineLoading = false;
function refreshOutline(): void {
  const headings = activeSession()?.headings() ?? [];
  if (outline) { outline.setHeadings(headings); return; }
  if (!headings.length || outlineLoading) return;
  outlineLoading = true;
  requestIdleCallback(() => {
    void import('./ui/outline').then(({ createOutline }) => {
      outline = createOutline(document.body, (heading) => {
        const session = activeSession();
        if (session?.workspace.mode() === 'edit') {
          session.editorApp()?.revealHeading(heading);
          session.editorApp()?.focus();
        } else session?.viewer.scrollToAnchor(heading.id);
      }, () => {
        const session = activeSession();
        if (session?.workspace.mode() === 'edit') session.editorApp()?.focus();
        else session?.viewer.focus();
      }, false);
      outline.setHeadings(activeSession()?.headings() ?? []);
    }).catch(() => undefined).finally(() => { outlineLoading = false; });
  });
}
const tabLabels = () => tabs.tabs.map(({ id }) => {
  const session = sessions.get(id);
  const info = session?.editorApp()?.controller.info();
  return {
    id,
    name: displayName(session?.workspace.documentPath() ?? null),
    dirty: info?.dirty ?? false,
    actionNeeded: info?.saveStatus.kind === 'action-needed',
  };
});
const tabBar = createTabBar(document.getElementById('tab-bar')!, {
  activate: (id) => activate(id),
  close: (id) => void close(id),
  create: () => void createUntitled(),
});
const renderTabs = () => { tabBar.render(tabLabels(), tabs.activeId); };
const { settings, picker, refreshControls } = createWindowChrome(
  document.getElementById('tab-bar')!, document.getElementById('document-toolbar')!, {
    window: platform.window, native: tauri, mac, preferences, notify: prompter.notify,
  });
const header = document.getElementById('tab-bar')!;
header.addEventListener('contextmenu', event => {
  if (event.target instanceof Element && event.target.closest('.window-controls')) return;
  event.preventDefault(); void execute('palette');
});
const refreshHints = () => {
  refreshControls();
  header.title = `Right-click for commands${commandHint('palette') ? ` · ${commandHint('palette')}` : ''}`;
  const session = activeSession();
  if (session?.workspace.mode() === 'view') session.status.set(readingHint());
};
preferences.subscribe(refreshHints);


function activate(id: string): void {
  if (!sessions.has(id)) return;
  activeSession()?.findBar().close();
  outline?.close();
  tabs = selectTab(tabs, id);
  for (const [key, session] of sessions) session.host.hidden = key !== id;
  const session = sessions.get(id)!;
  document.body.dataset.mode = session.workspace.mode();
  const info = session.editorApp()?.controller.info();
  platform.window.setTitle(windowTitle(session.workspace.documentPath(), info?.dirty ?? false));
  refreshOutline();
  renderTabs();
  if (session.workspace.mode() === 'edit') {
    session.editorApp()?.shown();
    session.editorApp()?.focus();
  } else session.viewer.focus();
  void session.workspace.checkDisk();
}

async function reconcileIdentity(id: string, path: string | null): Promise<void> {
  if (!tabs.tabs.some((tab) => tab.id === id)) return;
  try {
    const identity = path === null ? null : await platform.fs.identity(path);
    if (!tabs.tabs.some((tab) => tab.id === id)) return;
    if (sessions.get(id)?.workspace.documentPath() !== path) return;
    tabs = updateTabIdentity(tabs, id, identity);
    if (path && identity && await platform.fs.stat(path)) preferences.remember(path, identity);
    if (reservedIdentities.get(id)?.identity === identity) reservedIdentities.delete(id);
    renderTabs();
  } catch (error) {
    prompter.notify(`Could not identify ${displayName(path)}: ${String(error)}`);
  }
}

function queueIdentity(id: string, path: string | null): Promise<void> {
  identityTail = identityTail.then(() => reconcileIdentity(id, path));
  return identityTail;
}

function makeSession(id: string, path: string | null, initial = false): Session {
  const host = initial ? document.getElementById('session-initial')! : document.createElement('section');
  host.id = `session-${id}`;
  host.className = 'document-session';
  host.dataset.mode = 'view';
  host.setAttribute('role', 'tabpanel');
  host.setAttribute('aria-label', path ? displayName(path) : 'Untitled');
  if (!initial) {
    host.hidden = true;
    const viewerNode = document.createElement('div');
    viewerNode.className = 'viewer';
    const docNode = document.createElement('article');
    docNode.className = 'markdown-body';
    viewerNode.append(docNode);
    const editorNode = document.createElement('main');
    editorNode.className = 'editor';
    host.append(viewerNode, editorNode);
    panels.append(host);
  }
  const viewerNode = host.querySelector<HTMLElement>('.viewer')!;
  const docNode = host.querySelector<HTMLElement>('.markdown-body')!;
  const editorNode = host.querySelector<HTMLElement>('.editor')!;
  const status = createStatusBar(host);
  let workspace!: Workspace;
  let editorApp: EditorApp | null = null;
  let findBar: FindBar | null = null;
  let readingHeadings: readonly Heading[] = [];
  let editHeadings: readonly Heading[] = [];
  let watchVersion = 0;
  let watchTail: Promise<void> = Promise.resolve();
  const reportPath = (next: string | null) => {
    host.setAttribute('aria-label', next ? displayName(next) : 'Untitled');
    renderTabs();
    void queueIdentity(id, next);
    const version = ++watchVersion;
    requestIdleCallback(() => {
      if (version !== watchVersion) return;
      watchTail = watchTail.then(async () => {
        if (version !== watchVersion) return;
        await platform.fs.watch(next, () => {
          if (tabs.activeId === id) void workspace.checkDisk();
        }, id);
        if (version === watchVersion && next !== null && tabs.activeId === id) await workspace.checkDisk();
      }).catch(() => undefined);
    }, { timeout: 2000 });
  };
  const scopedPlatform: Platform = {
    ...platform,
    fs: {
      ...platform.fs,
      write: async (target, text, condition) => {
        const identity = await platform.fs.identity(target);
        if (tabs.tabs.some((tab) => tab.id !== id && tab.identity === identity)
          || [...reservedIdentities].some(([owner, reserved]) => owner !== id && reserved.identity === identity)) {
          throw new FileError('conflict', target, `${displayName(target)} is open in another tab`);
        }
        return platform.fs.write(target, text, condition);
      },
    },
    window: { ...platform.window, setTitle: (title) => { if (tabs.activeId === id) platform.window.setTitle(title); } },
    dialogs: {
      ...platform.dialogs,
      pickSave: async (suggested) => {
        const target = await platform.dialogs.pickSave(suggested);
        if (target === null) return null;
        const identity = await platform.fs.identity(target);
        if (tabs.tabs.some((tab) => tab.id !== id && tab.identity === identity)
          || [...reservedIdentities].some(([owner, reserved]) => owner !== id && reserved.identity === identity)) {
          prompter.notify(`${displayName(target)} is already open in another tab.`);
          return null;
        }
        reservedIdentities.set(id, { path: target, identity });
        return target;
      },
    },
    render: {
      ...platform.render,
      startupView: initial ? platform.render.startupView : async () => path === null
        ? { kind: 'edit' } : { kind: 'view', document: await platform.render.renderFile(path) },
    },
    startupDocument: initial ? platform.startupDocument : async () => path === null
      ? { kind: 'none' } : platform.fs.read(path).then((file) => ({ kind: 'file', file } as const)),
  };
  const viewer = initial ? context.viewer : createViewer(viewerNode, docNode, (href) => void workspace.followLink(href), traceMark,
    (error) => prompter.notify(`Could not finish loading the document: ${error.message}`));
  const getFindBar = () => {
    if (!findBar) {
      findBar = createFindBar(host, createFinder(viewerNode, docNode, viewer), () => viewer.focus());
      viewer.onShown(() => findBar?.refresh());
    }
    return findBar;
  };
  const highlight = () => {
    const version = viewer.version();
    requestIdleCallback(() => {
      void viewer.settled().then(async () => {
        if (version !== viewer.version() || tabs.activeId !== id) return;
        if (!docNode.querySelector('pre[data-lang] > code')) return;
        const { highlightCodeBlocks } = await import('./viewer/code-highlight');
        let lastFindRefresh = 0;
        await highlightCodeBlocks(docNode, () => version === viewer.version() && tabs.activeId === id, () => {
          viewer.invalidateTextNodes();
          if (findBar?.isOpen() && performance.now() - lastFindRefresh >= FIND_REFRESH_MS) {
            findBar.refresh();
            lastFindRefresh = performance.now();
          }
        });
        if (version === viewer.version()) findBar?.refresh();
      }).catch(() => undefined);
    });
  };
  viewer.onShown(highlight);
  const onDocumentShown = (doc: ViewDocument) => {
    readingHeadings = doc.headings;
    if (tabs.activeId === id) refreshOutline();
  };
  viewer.onShown(onDocumentShown);
  if (initial && preShown) {
    onDocumentShown(preShown);
    highlight();
  }
  const recoveryScope = () => initial && tabs.tabs.length === 1 ? 'all' as const
    : path === null ? 'none' as const : 'matching' as const;
  workspace = createWorkspace({
    platform: scopedPlatform,
    viewer,
    ...(initial && preShown ? { preShown } : {}),
    recoveryScope,
    openDocumentLink: async (target, anchor) => {
      await openPath(target);
      if (anchor) activeSession()?.viewer.scrollToAnchor(anchor);
    },
    notify: prompter.notify,
    scheduleIdle: (run) => void requestIdleCallback(run),
    onPathChanged: reportPath,
    showSurface(mode) {
      host.dataset.mode = mode;
      if (tabs.activeId === id) document.body.dataset.mode = mode;
      if (mode === 'view') {
        status.set(readingHint());
        if (tabs.activeId === id) viewer.focus();
      } else {
        findBar?.close();
        if (tabs.activeId === id) outline?.close();
        viewer.suspend();
        editorApp?.shown();
      }
      if (tabs.activeId === id) refreshOutline();
    },
    prepareView() {
      host.dataset.preparingView = 'true';
      return () => { delete host.dataset.preparingView; };
    },
    async loadEditor() {
      const { createEditorApp } = await loadEditorModule();
      editorApp = createEditorApp({
        platform: scopedPlatform, prompter, status, parent: editorNode,
        fileUrl: tauri ? fileUrl : (value) => value,
        domFileDrop: !tauri,
        onDocumentPathChanged: reportPath,
        onStateChanged: renderTabs,
        onHeadingsChanged: (headings) => {
          editHeadings = headings;
          if (tabs.activeId === id && host.dataset.mode === 'edit') refreshOutline();
        },
        recoveryScope,
        allowRecovery: async (copy) => {
          if (copy.path === null) return true;
          const identity = await platform.fs.identity(copy.path).catch(() => null);
          return identity === null || (!tabs.tabs.some((tab) => tab.id !== id && tab.identity === identity)
            && ![...reservedIdentities].some(([owner, reserved]) => owner !== id && reserved.identity === identity));
        },
        onSaveAsFinished: (_saved, currentPath, target) => {
          const pending = reservedIdentities.get(id);
          if (pending && pending.path === target && (currentPath !== target
            || tabs.tabs.find((tab) => tab.id === id)?.identity === pending.identity)) {
            reservedIdentities.delete(id);
          }
        },
        commands: {
          toggleReading: () => void workspace.toggle(),
          save: () => void workspace.save(),
          saveAs: () => void workspace.saveAs(),
          open: () => void openFromDialog(),
          newDocument: () => void createUntitled(),
        },
      });
      return editorApp;
    },
  });
  if (initial) context.setFollowLink((href) => void workspace.followLink(href));
  const session: Session = {
    id, host, viewer, workspace, status,
    headings: () => host.dataset.mode === 'edit' ? editHeadings : readingHeadings,
    findBar: getFindBar,
    editorApp: () => editorApp,
    dispose: async () => {
      watchVersion++;
      await watchTail.catch(() => undefined);
      await platform.fs.watch(null, () => {}, id).catch(() => undefined);
      findBar?.close();
      viewer.suspend();
      editorApp?.dispose();
    },
  };
  sessions.set(id, session);
  if (tabs.activeId === id) refreshOutline();
  return session;
}

async function openPath(path: string): Promise<void> {
  await initialIdentityReady;
  await identityTail;
  let identity: string;
  try { identity = await platform.fs.identity(path); }
  catch (error) { prompter.notify(`Could not open ${displayName(path)}: ${String(error)}`); return; }
  await identityTail;
  const existing = tabs.tabs.find((tab) => tab.identity === identity);
  if (existing) { activate(existing.id); return; }
  const reserved = [...reservedIdentities].find(([, candidate]) => candidate.identity === identity);
  if (reserved) { activate(reserved[0]); return; }
  const previous = tabs.activeId;
  const id = crypto.randomUUID();
  tabs = addTab(tabs, id, identity);
  const session = makeSession(id, path);
  activate(id);
  try { await session.workspace.start(); }
  catch (error) {
    await session.dispose();
    session.host.remove();
    sessions.delete(id);
    tabs = removeTab(tabs, id);
    if (previous) activate(previous);
    prompter.notify(`Could not open ${displayName(path)}: ${String(error)}`);
    return;
  }
  renderTabs();
}

async function openFromDialog(): Promise<void> {
  const path = await platform.dialogs.pickOpen();
  if (path !== null) await openPath(path);
}

async function createUntitled(): Promise<void> {
  await initialIdentityReady;
  const previous = tabs.activeId;
  const id = crypto.randomUUID();
  tabs = addTab(tabs, id, null);
  const session = makeSession(id, null);
  activate(id);
  try { await session.workspace.start(); }
  catch (error) {
    if (previous) {
      await session.dispose();
      session.host.remove();
      sessions.delete(id);
      tabs = removeTab(tabs, id);
      activate(previous);
    }
    prompter.notify(`Could not create a document: ${String(error)}`);
    return;
  }
  renderTabs();
}

async function close(id: string): Promise<void> {
  await initialIdentityReady;
  const session = sessions.get(id);
  if (!session || !(await session.workspace.requestClose())) return;
  await session.dispose();
  reservedIdentities.delete(id);
  session.host.remove();
  sessions.delete(id);
  tabs = removeTab(tabs, id);
  if (tabs.activeId === null) await createUntitled();
  else activate(tabs.activeId);
}

async function execute(id: string): Promise<void> {
  try {
    if (isZoomCommand(id)) { await zoom.change(id); return; }
    if (!['settings', 'appearance', 'resetAppearance', 'hotkeys', 'editorSettings', 'substitutions'].includes(id)) settings.cancelPending();
    const session = activeSession();
    if (id === 'palette') {
      picker.open('Command palette', commands.map(command => ({ id: command.id, label: command.label, detail: command.group,
        hint: bindings(command, preferences.hotkeys(), mac).map(key => displayChord(key, mac)).join(' / '), run: () => void execute(command.id) })));
    } else if (id === 'recent') {
      picker.open('Open recent', preferences.recents().map(item => ({ id: item.identity, label: displayName(item.path), detail: item.path, run: () => void openPath(item.path) })),
        { label: 'Clear recent files', run: () => { void execute('clearRecents').then(() => execute('recent')); } });
    } else if (id === 'settings') await settings.open();
    else if (id === 'appearance') await settings.open('appearance');
    else if (id === 'resetAppearance') await settings.resetAppearance();
    else if (id === 'hotkeys') await settings.open('hotkeys');
    else if (id === 'editorSettings') await settings.open('editor');
    else if (id === 'substitutions') await settings.open('substitutions');
    else if (id === 'clearRecents') { if (!preferences.clearRecents()) prompter.notify('Cleared for this window. Could not save recent files.'); }
    else if (id === 'open') await openFromDialog();
    else if (id === 'new') await createUntitled();
    else if (!session) return;
    else if (id === 'save') {
      if (session.editorApp()?.savePendingProperties() === false) return;
      await session.workspace.save();
    } else if (id === 'saveAs') {
      if (session.editorApp()?.savePendingProperties() === false) return;
      await session.workspace.saveAs();
    } else if (id === 'close') {
      if (tauri && tabs.tabs.length === 1) await platform.window.close();
      else await close(session.id);
    }
    else if (id === 'reading') await session.workspace.toggle();
    else if (id === 'contents') outline?.toggle();
    else if (id === 'nextTab' || id === 'previousTab') {
      const index = tabs.tabs.findIndex(tab => tab.id === tabs.activeId);
      const next = tabs.tabs[(index + (id === 'previousTab' ? -1 : 1) + tabs.tabs.length) % tabs.tabs.length];
      if (next) activate(next.id);
    } else if (session.workspace.mode() === 'view' && id.startsWith('find')) {
      if (id === 'find') session.findBar().open();
      else session.findBar().next(id === 'findPrevious' ? -1 : 1);
    } else {
      if (session.workspace.mode() !== 'edit') await session.workspace.toggle();
      const app = session.editorApp();
      if (id === 'properties') app?.openProperties();
      else await app?.editor.runCommand(id);
    }
  } catch (error) { prompter.notify(`Could not run command: ${String(error)}`); }
}
// A single capture dispatcher owns application shortcuts, including table widgets.
// Form text fields retain native text-editing history.
window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing) return;
  const command = matchKeyCommand(event, preferences.hotkeys(), mac);
  if (command && isZoomCommand(command.id) && !settings.recording()) {
    event.preventDefault(); void execute(command.id); return;
  }
  if (document.querySelector('.modal-backdrop')) return;
  const modal = document.querySelector('dialog[open]');
  if (modal) {
    const definition = command;
    if (modal.id === 'scrivo-settings' && !settings.recording() && ['settings', 'resetAppearance'].includes(definition?.id ?? '')) {
      event.preventDefault(); void execute(definition!.id);
    }
    return;
  }
  if (event.key === 'Escape') {
    if (settings.cancelPending()) { event.preventDefault(); return; }
    if (document.querySelector('.cm-lp-table-menu')) return;
    const session = activeSession();
    if (session?.editorApp()?.dismissPanels() || outline?.dismiss()) event.preventDefault();
    else if (session?.workspace.mode() === 'view') session.findBar().dismiss();
    return;
  }
  if (!command) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.matches('input, textarea, select') && !target.closest('.cm-lp-table')
    && (['undo', 'redo', 'selectNext', 'Format'].includes(command.group === 'Format' ? 'Format' : command.id)
      || /^(Mod|Ctrl|Meta)\+(Shift\+)?Key[ZY]$/.test(eventChord(event, mac)))) return;
  event.preventDefault(); void execute(command.id);
}, true);

const initialId = 'initial';
tabs = addTab(tabs, initialId, null);
const initial = makeSession(initialId, null, true);
renderTabs();
try {
  await initial.workspace.start();
  if (!preShown) traceMark('document shown');
  const initialPath = initial.workspace.documentPath();
  if (initialPath !== null) await queueIdentity(initialId, initialPath);
} finally { releaseInitialIdentity(); }
refreshHints();
platform.window.onFocus(() => { const session = activeSession(); if (session) void session.workspace.checkDisk(); });
requestIdleCallback(() => {
  void import('./app/file-drops').then(({ routeFileDrop }) =>
    platform.window.onFilesDropped(async ({ paths, position }) => {
      const session = activeSession();
      if (!session) return;
      try {
        await routeFileDrop(paths, position, { ...session.workspace, open: (path) => path ? openPath(path) : openFromDialog() },
          () => session.editorApp(), prompter.notify);
      } catch (error) { prompter.notify(`Could not import dropped files: ${String(error)}`); }
    })).catch((error) => prompter.notify(`Could not accept file drops: ${String(error)}`));
}, { timeout: 3000 });

if (!tauri) Object.assign(window, { __scrivo: {
  get workspace() { return activeSession()?.workspace; },
  get viewer() { return activeSession()?.viewer; },
  platform,
  get editor() { return activeSession()?.editorApp()?.editor; },
  get controller() { return activeSession()?.editorApp()?.controller; },
  tabs: { open: openPath, create: createUntitled, close, activate, state: () => tabs },
} });
}
