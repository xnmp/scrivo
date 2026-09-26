import { describe, expect, it } from 'vitest';
import { createMemoryPlatform, type MemoryPlatform } from '../platform/memory';
import { createDocumentController, type DocumentController } from './controller';
import { FileError } from './ports';
import { fakeEditor, scriptedPrompter } from './testing';

async function setup(files: Record<string, string> = {}, startupPath?: string) {
  const platform = createMemoryPlatform({ files, ...(startupPath ? { startupPath } : {}) });
  const editor = fakeEditor();
  const p = scriptedPrompter();
  const controller = createDocumentController({ platform, prompter: p.prompter, editor });
  platform.window.onCloseRequested(controller.requestClose);
  await controller.start(await platform.startupDocument());
  return { platform, editor, controller, ...p };
}

const lastTitle = (p: MemoryPlatform) => p.titles.at(-1);

describe('opening', () => {
  it('shows the startup file and a clean title', async () => {
    const { editor, controller, platform } = await setup({ '/n/a.md': '# A\n' }, '/n/a.md');
    expect(editor.value()).toBe('# A\n');
    expect(editor.path()).toBe('/n/a.md');
    expect(controller.info().dirty).toBe(false);
    expect(lastTitle(platform)).toBe('a.md — Scrivo');
  });

  it('starts an empty document bound to a path that does not exist yet', async () => {
    const { editor, controller, platform } = await setup({}, '/n/new.md');
    editor.type('hello');
    controller.contentChanged();
    expect(lastTitle(platform)).toBe('new.md • — Scrivo');
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/new.md')).toBe('hello');
  });

  it('normalises CRLF for editing and restores it on save', async () => {
    const { editor, controller, platform } = await setup({ '/n/w.md': 'a\r\nb\r\n' }, '/n/w.md');
    expect(editor.value()).toBe('a\nb\n');
    editor.type('c\n');
    await controller.save();
    expect(platform.disk.get('/n/w.md')).toBe('a\r\nb\r\nc\r\n');
  });

  it('keeps a byte-order mark', async () => {
    const { editor, controller, platform } = await setup({ '/n/b.md': '﻿x' }, '/n/b.md');
    editor.type('y');
    await controller.save();
    expect(platform.disk.get('/n/b.md')).toBe('﻿xy');
  });

  it('warns once when a file mixes line endings', async () => {
    const { notices } = await setup({ '/n/m.md': 'a\r\nb\r\nc\n' }, '/n/m.md');
    expect(notices).toEqual(['m.md mixes line endings; saving will use CRLF.']);
  });

  it('reports unreadable files without touching the current document', async () => {
    const { editor, controller, notices, platform } = await setup({ '/n/a.md': 'keep' }, '/n/a.md');
    platform.dialogAnswers.open.push('/n/missing.md');
    await controller.open();
    expect(editor.value()).toBe('keep');
    expect(notices).toEqual(['Could not open missing.md: the file does not exist']);
  });

  it('asks before replacing unsaved work, and cancelling keeps it', async () => {
    const { editor, controller, asked } = await setup({ '/n/a.md': 'a', '/n/b.md': 'b' }, '/n/a.md');
    editor.type('!');
    await controller.open('/n/b.md');
    expect(asked).toEqual(['unsaved:a.md']);
    expect(editor.value()).toBe('a!');
  });

  it('can save the unsaved work, then open the new file', async () => {
    const { editor, controller, answers, platform } = await setup({ '/n/a.md': 'a', '/n/b.md': 'b' }, '/n/a.md');
    editor.type('!');
    answers.unsaved.push('save');
    await controller.open('/n/b.md');
    expect(platform.disk.get('/n/a.md')).toBe('a!');
    expect(editor.value()).toBe('b');
  });

  it('does not open anything when the dialog is dismissed', async () => {
    const { editor, controller, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    await controller.open();
    expect(asked).toEqual([]);
    expect(editor.value()).toBe('a!');
  });
});

describe('saving', () => {
  it('writes exactly the editor text and clears the dirty marker', async () => {
    const { editor, controller, platform } = await setup({ '/n/a.md': '' }, '/n/a.md');
    editor.type('**bold**  \n- [ ] task');
    controller.contentChanged();
    expect(controller.info().dirty).toBe(true);
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('**bold**  \n- [ ] task');
    expect(controller.info().dirty).toBe(false);
    expect(lastTitle(platform)).toBe('a.md — Scrivo');
  });

  it('prompts for a path for untitled documents and adopts it', async () => {
    const { editor, controller, platform } = await setup();
    editor.type('draft');
    platform.dialogAnswers.save.push('/n/draft.md');
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/draft.md')).toBe('draft');
    expect(controller.info().path).toBe('/n/draft.md');
    expect(editor.path()).toBe('/n/draft.md');
  });

  it('leaves untitled documents alone when the save dialog is dismissed', async () => {
    const { editor, controller, platform } = await setup();
    editor.type('draft');
    expect(await controller.save()).toBe(false);
    expect(platform.disk.writes).toEqual([]);
    expect(controller.info().dirty).toBe(true);
  });

  it('keeps edits typed while a save is in flight marked as unsaved', async () => {
    const { editor, controller, platform } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    let release!: () => void;
    platform.disk.setWriteGate(() => new Promise<void>((r) => (release = r)));
    editor.type('1');
    const saving = controller.save();
    await Promise.resolve();
    editor.type('2'); // typed during the write
    release();
    await saving;
    expect(platform.disk.get('/n/a.md')).toBe('a1');
    expect(controller.info().dirty).toBe(true);
  });

  it('refuses to overwrite a file changed by another program until the user says so', async () => {
    const { editor, controller, platform, answers, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.put('/n/a.md', 'theirs');
    editor.type('-mine');
    expect(await controller.save()).toBe(false);
    expect(platform.disk.get('/n/a.md')).toBe('theirs');
    expect(asked).toEqual(['conflict:a.md']);

    answers.conflict.push('overwrite');
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a-mine');
  });

  it('can resolve a save conflict by taking the disk version', async () => {
    const { editor, controller, platform, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.put('/n/a.md', 'theirs');
    editor.type('-mine');
    answers.conflict.push('reload');
    await controller.save();
    expect(editor.value()).toBe('theirs');
    expect(controller.info().dirty).toBe(false);
  });

  it('reports write failures and stays dirty', async () => {
    const { editor, controller, platform, notices } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.failNextWrite(new FileError('permission-denied', '/n/a.md'));
    editor.type('!');
    expect(await controller.save()).toBe(false);
    expect(notices).toEqual(['Could not save a.md: permission denied']);
    expect(controller.info().dirty).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a');
  });

  it('does not rewrite a mixed-EOL warning after the file was normalised by saving', async () => {
    const { controller, platform } = await setup({ '/n/m.md': 'a\r\nb\r\nc\n' }, '/n/m.md');
    await controller.save();
    expect(platform.disk.get('/n/m.md')).toBe('a\r\nb\r\nc\r\n');
  });
});

describe('closing', () => {
  it('closes immediately when there is nothing to lose', async () => {
    const { platform, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    expect(await platform.requestClose()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('closes an empty untitled document without asking', async () => {
    const { platform, asked } = await setup();
    expect(await platform.requestClose()).toBe(true);
    expect(asked).toEqual([]);
  });

  it('stays open when the user cancels', async () => {
    const { platform, editor, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    answers.unsaved.push('cancel');
    expect(await platform.requestClose()).toBe(false);
    expect(platform.destroyed).toBe(false);
  });

  it('discards when asked to', async () => {
    const { platform, editor, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    answers.unsaved.push('discard');
    expect(await platform.requestClose()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a');
  });

  it('saves then closes, but stays open if that save fails', async () => {
    const { platform, editor, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    answers.unsaved.push('save');
    platform.disk.failNextWrite(new FileError('io', '/n/a.md', 'disk full'));
    expect(await platform.requestClose()).toBe(false);

    answers.unsaved.push('save');
    expect(await platform.requestClose()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a!');
  });
});

describe('changes made by other programs', () => {
  it('silently reloads a clean document', async () => {
    const { platform, editor, controller, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.put('/n/a.md', 'from git pull\r\n');
    await controller.checkDisk();
    expect(editor.value()).toBe('from git pull\n');
    expect(asked).toEqual([]);
    expect(controller.info().dirty).toBe(false);
    expect(controller.info().eol).toBe('CRLF');
  });

  it('asks before replacing unsaved edits, and "keep" stops asking', async () => {
    const { platform, editor, controller, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    platform.disk.put('/n/a.md', 'theirs');
    await controller.checkDisk();
    await controller.checkDisk();
    expect(asked).toEqual(['disk:a.md']);
    expect(editor.value()).toBe('a!');
    // Having chosen to keep ours, saving overwrites without a conflict prompt.
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a!');
  });

  it('treats a deleted file as unsaved and recreates it on save', async () => {
    const { platform, controller, notices } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.remove('/n/a.md');
    await controller.checkDisk();
    expect(notices).toEqual(['a.md was deleted or moved. Save to keep it.']);
    expect(controller.info().dirty).toBe(true);
    await controller.checkDisk(); // no repeated notice
    expect(notices).toHaveLength(1);
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a');
  });

  it('never mistakes its own in-flight save for an external change', async () => {
    // The bytes are on disk but the write hasn't resolved yet (IPC reply in flight),
    // the user keeps typing and the window gets focus. Treating our own write as an
    // external change would offer to "reload" and throw away the newer keystrokes.
    const { platform, editor, controller, asked, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    let release!: () => void;
    platform.disk.setWriteGate(() => new Promise<void>((r) => (release = r)), 'after-landing');
    answers.disk.push('reload');
    editor.type('1');
    const saving = controller.save();
    await new Promise((r) => setTimeout(r, 0)); // let the write land
    expect(platform.disk.get('/n/a.md')).toBe('a1');
    editor.type('2');
    const checking = controller.checkDisk();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([saving, checking]);
    expect(asked).toEqual([]);
    expect(editor.value()).toBe('a12');
    expect(controller.info().dirty).toBe(true);
  });
});

describe('new documents', () => {
  it('replaces a clean document with an empty untitled one', async () => {
    const { editor, controller, platform } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    await controller.newDocument();
    expect(editor.value()).toBe('');
    expect(controller.info().path).toBeNull();
    expect(lastTitle(platform)).toBe('Untitled — Scrivo');
  });
});

// Keep the type import used even when tests are filtered.
export type { DocumentController };
