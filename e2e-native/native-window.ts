// Reads the OS-level window title via X11 (xprop), for assertions that need it.
//
// The app sets its window title through Tauri's native window API (`window.setTitle`,
// e.g. to show the dirty marker "•"), which changes the GTK window's title-bar text —
// a property of the top-level X11 window, not the webview's `document.title` (that
// stays whatever index.html sets and is never touched by app code). WebDriver's
// "Get Title" command can only see `document.title`, so it can't observe this. Since
// the suite always runs under an X server with a window manager (with-wm.sh), we can
// read the real title directly from X.
import { execFileSync } from 'node:child_process';

function xprop(args: string[]): string {
  return execFileSync('xprop', args, { encoding: 'utf8' });
}

/** Title of the active window (there is only ever one app window per test session). */
export function activeWindowTitle(): string {
  const active = xprop(['-root', '_NET_ACTIVE_WINDOW']);
  const idMatch = active.match(/window id # (0x[0-9a-fA-F]+)/);
  if (!idMatch) throw new Error(`could not read _NET_ACTIVE_WINDOW: ${active.trim()}`);
  const name = xprop(['-id', idMatch[1]!, '_NET_WM_NAME']);
  const nameMatch = name.match(/=\s*"(.*)"\s*$/s);
  if (!nameMatch) throw new Error(`could not read _NET_WM_NAME for ${idMatch[1]}: ${name.trim()}`);
  return nameMatch[1]!;
}
