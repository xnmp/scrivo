// Paint the prefetched reading view before loading document-tab machinery.
import './shims/idle-callback';
import './styles/base.css';
import './styles/viewer.css';
import type { Platform, ViewDocument } from './app/ports';
import { createTauriPlatform, isTauri, traceMark } from './platform/tauri';
import { createPrompter } from './ui/prompter';
import { createViewer } from './viewer/viewer';

traceMark('js start');
const tauri = isTauri();
const platform: Platform = tauri ? createTauriPlatform() : (await import('./platform/dev')).createDevPlatform();
const prompter = createPrompter(document.body);
const pendingLinks: string[] = [];
let followLink: (href: string) => void = (href) => { pendingLinks.push(href); };
let installedLinkHandler: ((href: string) => void) | null = null;
const pendingKeys: KeyboardEventInit[] = [];
const queueShortcut = (event: KeyboardEvent) => {
  const mod = event.ctrlKey || event.metaKey;
  if (!(mod && ['e', 'o', 'n', 's', 'f', 'w', 'tab', 'g'].includes(event.key.toLowerCase()))
    && event.key !== 'F3' && event.key !== 'Escape') return;
  event.preventDefault();
  pendingKeys.push({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey,
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
  const { startTabWindow } = await import('./tab-window');
  await startTabWindow({ platform, tauri, prompter, viewer, preShown,
    setFollowLink: (handler) => { installedLinkHandler = handler; } });
  if (installedLinkHandler) {
    followLink = installedLinkHandler;
    for (const href of pendingLinks.splice(0)) installedLinkHandler(href);
  }
  window.removeEventListener('keydown', queueShortcut, true);
  for (const key of pendingKeys.splice(0)) window.dispatchEvent(new KeyboardEvent('keydown', key));
};
if (preShown) requestAnimationFrame(() => void mount());
else await mount();
