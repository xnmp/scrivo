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

export async function startTabWindow(context: {
  readonly platform: Platform;
  readonly tauri: boolean;
  readonly prompter: Prompter;
  readonly viewer: Viewer;
  readonly preShown: ViewDocument | null;
  readonly setFollowLink: (handler: (href: string) => void) => void;
}): Promise<void> {
const { platform, tauri, prompter, preShown } = context;
const loadEditorModule = () => import('./editor-app');
const FIND_REFRESH_MS = 250;
const modKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
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
const renderTabs = () => tabBar.render(tabLabels(), tabs.activeId);

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
  outline?.setHeadings(session.headings());
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
  let headings: readonly Heading[] = [];
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
    headings = doc.headings;
    if (tabs.activeId !== id) return;
    outline?.setHeadings(headings);
    if (outline || headings.length === 0) return;
    const version = viewer.version();
    requestIdleCallback(() => {
      void import('./ui/outline').then(({ createOutline }) => {
        if (version !== viewer.version() || tabs.activeId !== id) return;
        outline ??= createOutline(document.body, (anchor) => activeSession()?.viewer.scrollToAnchor(anchor),
          () => activeSession()?.viewer.focus());
        outline.setHeadings(headings);
      }).catch(() => undefined);
    });
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
        status.set(`Reading · ${modKey}E to edit`);
        if (tabs.activeId === id) viewer.focus();
      } else {
        findBar?.close();
        if (tabs.activeId === id) outline?.close();
        viewer.suspend();
        editorApp?.shown();
      }
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
    headings: () => headings,
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

window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.altKey) return;
  const session = activeSession();
  if (!session) return;
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (mod && key === 'tab') {
    event.preventDefault();
    const index = tabs.tabs.findIndex((tab) => tab.id === tabs.activeId);
    const next = tabs.tabs[(index + (event.shiftKey ? -1 : 1) + tabs.tabs.length) % tabs.tabs.length];
    if (next) activate(next.id);
    return;
  }
  if (mod && !event.shiftKey && key === 'w') { event.preventDefault(); void close(session.id); return; }
  if (session.workspace.mode() !== 'view') return;
  const findStep = (key === 'g' && mod) || (event.key === 'F3' && !mod) ? (event.shiftKey ? -1 : 1) : 0;
  if (findStep) { event.preventDefault(); session.findBar().next(findStep); return; }
  if (event.key === 'Escape') { session.findBar().dismiss(); return; }
  if (!mod || event.shiftKey) return;
  const run = {
    e: () => session.workspace.toggle(),
    o: openFromDialog,
    n: createUntitled,
    s: () => session.workspace.save(),
    f: () => session.findBar().open(),
  }[key];
  if (run) { event.preventDefault(); void run(); }
});

const initialId = 'initial';
tabs = addTab(tabs, initialId, null);
const initial = makeSession(initialId, null, true);
renderTabs();
await initial.workspace.start();
if (!preShown) traceMark('document shown');
const initialPath = initial.workspace.documentPath();
if (initialPath !== null) await queueIdentity(initialId, initialPath);
releaseInitialIdentity();
platform.window.onCloseRequested(async () => {
  for (const tab of tabs.tabs) {
    if (!(await sessions.get(tab.id)?.workspace.requestClose())) {
      for (const open of sessions.values()) open.workspace.resumeAfterCancelledClose();
      return false;
    }
  }
  return true;
});
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
