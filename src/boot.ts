// Paint the prefetched reading view before loading document-tab machinery.
import './shims/idle-callback';
import { eventChord, storedChordMatches } from './domain/hotkeys';
import './styles/base.css';
import './styles/viewer.css';
import type { Platform, ViewDocument } from './app/ports';
import { createTauriPlatform, isTauri, traceMark } from './platform/tauri';
import { createPrompter } from './ui/prompter';
import { createViewer } from './viewer/viewer';
import { applyAppearance } from './platform/appearance';

traceMark('js start');
applyAppearance();
const tauri = isTauri();
const platform: Platform = tauri ? createTauriPlatform() : (await import('./platform/dev')).createDevPlatform();
const prompter = createPrompter(document.body);
const pendingLinks: string[] = [];
let followLink: (href: string) => void = (href) => { pendingLinks.push(href); };
let installedLinkHandler: ((href: string) => void) | null = null;
const pendingKeys: KeyboardEventInit[] = [];
let bootHotkeys: string | null = null;
try { bootHotkeys = localStorage.getItem('scrivo.hotkeys.v1'); } catch { /* defaults */ }
const queueShortcut = (event: KeyboardEvent) => {
  const mod = event.ctrlKey || event.metaKey;
  if (!(mod && ['e', 'o', 'n', 't', 'r', 'p', 's', 'f', 'w', 'tab', 'g', ',', '+', '-', '='].includes(event.key.toLowerCase()))
    && !(mod && ['Comma', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(event.code))
    && event.key !== 'F3' && event.key !== 'Escape'
    && !storedChordMatches(eventChord(event, /Mac|iPhone|iPad/.test(navigator.userAgent)), bootHotkeys, /Mac|iPhone|iPad/.test(navigator.userAgent))) return;
  event.preventDefault();
  pendingKeys.push({ key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
    shiftKey: event.shiftKey, altKey: event.altKey, bubbles: true, cancelable: true });
};
window.addEventListener('keydown', queueShortcut, true);
const viewer = createViewer(document.getElementById('viewer')!, document.getElementById('document')!,
  (href) => followLink(href), traceMark,
  (error) => prompter.notify(`Could not finish loading the document: ${error.message}`));
let preShown: ViewDocument | null = null;
const startup = await platform.render.startupView().catch(() => ({ kind: 'edit' } as const));
if (startup.kind === 'view') {
  try {
    await viewer.show(startup.document, undefined, startup.loadTail);
    preShown = startup.document;
    traceMark('document shown');
    void viewer.settled().then(() => traceMark('document settled'), () => undefined);
  } catch (error) {
    prompter.notify(`Could not show the document: ${String(error)}`);
  }
}
requestAnimationFrame(() => requestAnimationFrame(() => traceMark('first frame with document')));
const mount = async () => {
  try {
    traceMark('tab shell import start');
    const { startTabWindow } = await import('./tab-window');
    traceMark('tab shell import end');
    await startTabWindow({ platform, tauri, prompter, viewer, preShown,
      setFollowLink: (handler) => { installedLinkHandler = handler; } });
    traceMark('tab shell ready');
    if (installedLinkHandler) {
      followLink = installedLinkHandler;
      for (const href of pendingLinks.splice(0)) installedLinkHandler(href);
    }
    window.removeEventListener('keydown', queueShortcut, true);
    for (const key of pendingKeys.splice(0)) window.dispatchEvent(new KeyboardEvent('keydown', key));
  } catch (error) {
    window.removeEventListener('keydown', queueShortcut, true);
    pendingKeys.length = 0;
    pendingLinks.length = 0;
    const failed = () => prompter.notify(`Could not initialize document controls. Reopen this window to retry. ${String(error)}`);
    followLink = failed;
    failed();
  }
};
if (preShown) requestAnimationFrame(() => void mount());
else await mount();
