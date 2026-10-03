// Shared helpers for the Playwright suite. Talk to the app mostly through
// `window.__scrivo` (see src/boot.ts) rather than reimplementing editor internals here.
import type { Page } from '@playwright/test';

export interface OpenOptions {
  /** Seeds `?text=` — the startup document becomes `/sample/inline.md`. */
  readonly text?: string;
  /** `?doc=none` starts untitled; omit for the default welcome sample. */
  readonly doc?: string;
  /** Which surface to start on. The app opens files in the reading view; most specs edit. */
  readonly mode?: 'edit' | 'view';
}

export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Control+p');
  await page.getByRole('combobox', { name: 'Search commands' }).fill(label);
  await page.keyboard.press('Enter');
}
export async function openSettings(page: Page, section: 'Appearance' | 'Editor' | 'Hotkeys' | 'Substitutions' = 'Appearance'): Promise<void> {
  await page.keyboard.press('Control+,');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
}

/** Navigate to the dev server and wait for the editor + `window.__scrivo` to be ready. */
export async function openApp(page: Page, opts: OpenOptions = {}): Promise<void> {
  const params = new URLSearchParams();
  if (opts.text !== undefined) params.set('text', opts.text);
  if (opts.doc !== undefined) params.set('doc', opts.doc);
  const mode = opts.mode ?? 'edit';
  if (mode === 'edit') params.set('mode', 'edit');
  const qs = params.toString();
  await page.goto(qs ? `/?${qs}` : '/');
  await page.waitForFunction(() => Boolean((window as any).__scrivo));
  await page.waitForSelector(mode === 'edit' ? '.cm-content' : '#document > *');
}

/** Full document text, straight from the CodeMirror state. */
export function docText(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__scrivo.editor.view.state.doc.toString());
}

/** Replace the whole document (as `editor.port.reset` does) and wait a frame for decorations. */
export async function resetDoc(page: Page, text: string, path: string | null = '/sample/inline.md'): Promise<void> {
  await page.evaluate(
    ({ text, path }) => (window as any).__scrivo.editor.port.reset(text, path),
    { text, path },
  );
  await nextFrame(page);
}

/** Place a collapsed caret at a document offset and focus the editor. */
export async function setCaret(page: Page, offset: number): Promise<void> {
  await page.evaluate((offset) => {
    const view = (window as any).__scrivo.editor.view;
    view.dispatch({ selection: { anchor: offset } });
    view.focus();
  }, offset);
}

/** Move the caret out of the document entirely (start of doc, collapsed), a stand-in for "elsewhere". */
export async function blurCaretTo(page: Page, offset = 0): Promise<void> {
  await setCaret(page, offset);
}

/** Visible (rendered) text of the Nth `.cm-line`, 0-indexed. */
export async function lineText(page: Page, n: number): Promise<string> {
  return page.evaluate((n) => {
    const lines = document.querySelectorAll('.cm-content .cm-line');
    const line = lines[n] as HTMLElement | undefined;
    return line?.innerText ?? '';
  }, n);
}

/** Number of rendered `.cm-line` elements currently in the viewport. */
export function lineCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('.cm-content .cm-line').length);
}

export function diskGet(page: Page, path: string): Promise<string | undefined> {
  return page.evaluate((path) => (window as any).__scrivo.platform.disk.get(path), path);
}

export function diskPut(page: Page, path: string, text: string): Promise<void> {
  return page.evaluate(({ path, text }) => (window as any).__scrivo.platform.disk.put(path, text), { path, text });
}

export function windowTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as any).__scrivo.platform.titles as string[]);
}

export function lastTitle(page: Page): Promise<string> {
  return page.evaluate(() => {
    const titles = (window as any).__scrivo.platform.titles as string[];
    return titles[titles.length - 1] ?? '';
  });
}

export function pushSaveAnswer(page: Page, path: string | null): Promise<void> {
  return page.evaluate((path) => (window as any).__scrivo.platform.dialogAnswers.save.push(path), path);
}

export function pushOpenAnswer(page: Page, path: string | null): Promise<void> {
  return page.evaluate((path) => (window as any).__scrivo.platform.dialogAnswers.open.push(path), path);
}

/** Simulate the user closing the window; resolves whether it actually closed. */
export function requestClose(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__scrivo.platform.requestClose());
}

/** Simulate window focus (triggers the on-disk change check) and let the resulting async work settle. */
export async function focusWindow(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__scrivo.platform.focus());
  await page.waitForTimeout(50);
}

export function statusBarText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.status-bar')?.textContent ?? '');
}

/** Open a document by path through the controller (as if via File > Open), awaiting completion. */
export async function controllerOpen(page: Page, path: string): Promise<void> {
  await page.evaluate((path) => (window as any).__scrivo.controller.open(path), path);
}

export const ControlOrMeta = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Wait two animation frames — enough for decoration rebuilds and lazy-load callbacks to settle. */
export function nextFrame(page: Page): Promise<void> {
  return page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

export function generateLargeDoc(repetitions: number): string {
  const section = (i: number) => `# Section ${i}

Paragraph ${i} with **bold**, *em*, and a [link](https://example.com/${i}).

- item ${i}.1
- item ${i}.2
- item ${i}.3

| Col A | Col B |
| :---- | ----: |
| ${i}a  | ${i}b  |

\`\`\`python
def fn_${i}(x):
    return x + ${i}
\`\`\`

Inline math $x_${i}^2 + 1$ and a paragraph of filler text to pad out line count for section ${i}.
`;
  const parts: string[] = [];
  for (let i = 0; i < repetitions; i++) parts.push(section(i));
  return parts.join('\n');
}
