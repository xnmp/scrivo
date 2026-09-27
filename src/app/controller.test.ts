import { describe, expect, it, vi } from 'vitest';
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

  it('asks before Save As replaces another file', async () => {
    const { editor, controller, platform, asked } = await setup({ '/n/a.md': 'original', '/n/b.md': 'theirs' }, '/n/a.md');
    editor.type('-mine');
    platform.dialogAnswers.save.push('/n/b.md');
    expect(await controller.saveAs()).toBe(false);
    expect(platform.disk.get('/n/b.md')).toBe('theirs');
    expect(editor.value()).toBe('original-mine');
    expect(asked).toContain('conflict:b.md');
  });

  it('loads the Save As target when that conflict is resolved with Load Theirs', async () => {
    const { editor, controller, platform, answers } = await setup({ '/n/a.md': 'original', '/n/b.md': 'theirs' }, '/n/a.md');
    editor.type('-mine');
    answers.conflict.push('reload');
    platform.dialogAnswers.save.push('/n/b.md');
    expect(await controller.saveAs()).toBe(false);
    expect(editor.value()).toBe('theirs');
    expect(controller.info().path).toBe('/n/b.md');
    expect(platform.disk.get('/n/a.md')).toBe('original');
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

  it('asks again if the disk changes while the overwrite confirmation is open', async () => {
    const { platform, editor, controller, prompter } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.put('/n/a.md', 'theirs');
    editor.type('-mine');
    let prompts = 0;
    prompter.saveConflict = async () => {
      prompts++;
      if (prompts === 1) {
        platform.disk.put('/n/a.md', 'newer still');
        return 'overwrite';
      }
      return 'cancel';
    };
    expect(await controller.save()).toBe(false);
    expect(prompts).toBe(2);
    expect(platform.disk.get('/n/a.md')).toBe('newer still');
    expect(editor.value()).toBe('a-mine');
  });

  it('does not overwrite a file recreated after deletion before a disk check', async () => {
    const { editor, controller, platform, asked } = await setup({ '/n/a.md': 'old' }, '/n/a.md');
    editor.type('-mine');
    platform.disk.remove('/n/a.md');
    await controller.checkDisk();
    platform.disk.put('/n/a.md', 'theirs');

    expect(await controller.save()).toBe(false);
    expect(platform.disk.get('/n/a.md')).toBe('theirs');
    expect(asked).toContain('conflict:a.md');
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

describe('autosave', () => {
  it('saves a named file after two idle seconds, and resets the pause after more typing', async () => {
    vi.useFakeTimers();
    try {
      const { editor, controller, platform } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
      editor.type('1');
      controller.contentChanged();
      expect(controller.info().saveStatus.kind).toBe('edited');
      await vi.advanceTimersByTimeAsync(1500);
      editor.type('2');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(1999);
      expect(platform.disk.get('/n/a.md')).toBe('a');
      await vi.advanceTimersByTimeAsync(1);
      expect(platform.disk.get('/n/a.md')).toBe('a12');
      expect(controller.info().saveStatus.kind).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves an edit typed while an earlier write is in flight', async () => {
    vi.useFakeTimers();
    try {
      const { editor, controller, platform } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
      let release!: () => void;
      platform.disk.setWriteGate(() => new Promise<void>((resolve) => { release = resolve; }));
      editor.type('1');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(2000);
      expect(controller.info().saveStatus.kind).toBe('saving');
      editor.type('2');
      controller.contentChanged();
      platform.disk.setWriteGate(null);
      release();
      await vi.advanceTimersByTimeAsync(2000);
      expect(platform.disk.get('/n/a.md')).toBe('a12');
      expect(controller.info().saveStatus.kind).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a failed write visible and stops automatic retries until manual save', async () => {
    vi.useFakeTimers();
    try {
      const { editor, controller, platform, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
      platform.disk.failNextWrite(new FileError('permission-denied', '/n/a.md'));
      editor.type('!');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(2000);
      expect(controller.info().saveStatus).toEqual({ kind: 'action-needed', reason: 'Could not save a.md: permission denied' });
      editor.type('?');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(4000);
      expect(platform.disk.writes).toEqual([]);
      expect(asked).toEqual([]);
      expect(await controller.save()).toBe(true);
      expect(platform.disk.get('/n/a.md')).toBe('a!?');
      expect(controller.info().saveStatus.kind).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses after an autosave conflict and requires a manual resolution', async () => {
    vi.useFakeTimers();
    try {
      const { editor, controller, platform, answers, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
      editor.type('-mine');
      controller.contentChanged();
      platform.disk.put('/n/a.md', 'theirs');
      await vi.advanceTimersByTimeAsync(2000);
      expect(platform.disk.get('/n/a.md')).toBe('theirs');
      expect(controller.info().saveStatus.kind).toBe('action-needed');
      expect(asked).toEqual([]);
      await vi.advanceTimersByTimeAsync(4000);
      expect(asked).toEqual([]);
      answers.conflict.push('save-as');
      platform.dialogAnswers.save.push('/n/mine.md');
      expect(await controller.save()).toBe(true);
      expect(platform.disk.get('/n/a.md')).toBe('theirs');
      expect(platform.disk.get('/n/mine.md')).toBe('a-mine');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not autosave an untitled document to an invented path', async () => {
    vi.useFakeTimers();
    try {
      const { editor, controller, platform } = await setup();
      editor.type('draft');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(5000);
      expect(platform.disk.writes).toEqual([]);
      expect(controller.info().saveStatus.kind).toBe('edited');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('crash recovery', () => {
  it('starts protecting the first untitled edit without waiting for an idle timer', async () => {
    vi.useFakeTimers();
    try {
      const platform = createMemoryPlatform();
      const editor = fakeEditor();
      const controller = createDocumentController({ platform, prompter: scriptedPrompter().prompter, editor });
      await controller.start({ kind: 'none' });
      editor.type('first keystroke');
      controller.contentChanged();
      await Promise.resolve();
      expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['first keystroke']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers and restores the exact unsaved text of an untitled document', async () => {
    vi.useFakeTimers();
    try {
      const platform = createMemoryPlatform();
      const first = fakeEditor();
      const controller = createDocumentController({ platform, prompter: scriptedPrompter().prompter, editor: first });
      await controller.start({ kind: 'none' });
      first.type('# Draft\n😀 and | pipes');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(500);
      expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['# Draft\n😀 and | pipes']);

      const next = fakeEditor();
      const prompts = scriptedPrompter();
      prompts.answers.recovery.push('restore');
      const reopened = createDocumentController({ platform, prompter: prompts.prompter, editor: next });
      await reopened.start({ kind: 'none' });
      expect(prompts.asked).toEqual(['recovery:Untitled:false']);
      expect(next.value()).toBe('# Draft\n😀 and | pipes');
      expect(reopened.info().dirty).toBe(true);
      expect(reopened.info().saveStatus.kind).toBe('edited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never overwrites a newer disk version when restoring a named file', async () => {
    vi.useFakeTimers();
    try {
      const platform = createMemoryPlatform({ files: { '/n/a.md': '\ufeffBase\r\n' }, startupPath: '/n/a.md' });
      const first = fakeEditor();
      const controller = createDocumentController({ platform, prompter: scriptedPrompter().prompter, editor: first });
      await controller.start(await platform.startupDocument());
      first.type('😀\n');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(500);
      platform.disk.put('/n/a.md', '\ufeffNewer\r\n');

      const next = fakeEditor();
      const prompts = scriptedPrompter();
      prompts.answers.recovery.push('restore');
      const reopened = createDocumentController({ platform, prompter: prompts.prompter, editor: next });
      await reopened.start(await platform.startupDocument());
      expect(prompts.asked).toEqual(['recovery:a.md:true']);
      expect(next.value()).toBe('Base\n😀\n');
      expect(reopened.info().saveStatus.kind).toBe('action-needed');
      expect(await reopened.save()).toBe(false);
      expect(platform.disk.get('/n/a.md')).toBe('\ufeffNewer\r\n');
      prompts.answers.conflict.push('save-as');
      platform.dialogAnswers.save.push('/n/recovered.md');
      expect(await reopened.save()).toBe(true);
      expect(platform.disk.get('/n/recovered.md')).toBe('\ufeffBase\r\n😀\r\n');
      expect(platform.disk.get('/n/a.md')).toBe('\ufeffNewer\r\n');
      expect(await platform.recovery.list()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a recovery copy after explicit dismissal', async () => {
    const platform = createMemoryPlatform();
    await platform.recovery.put({ id: crypto.randomUUID(), path: null, stamp: null,
      format: { eol: '\n', bom: false, mixedEol: false }, text: 'old draft', updatedAt: Date.now() });
    const prompts = scriptedPrompter();
    prompts.answers.recovery.push('dismiss');
    const controller = createDocumentController({ platform, prompter: prompts.prompter, editor: fakeEditor() });
    await controller.start({ kind: 'none' });
    expect(prompts.asked).toEqual(['recovery:Untitled:false']);
    expect(await platform.recovery.list()).toEqual([]);
  });

  it('keeps a recovery copy when the prompt is canceled', async () => {
    const platform = createMemoryPlatform();
    const copy = { id: crypto.randomUUID(), path: null, stamp: null,
      format: { eol: '\n' as const, bom: false, mixedEol: false }, text: 'keep me', updatedAt: Date.now() };
    await platform.recovery.put(copy);
    const prompts = scriptedPrompter();
    prompts.answers.recovery.push('cancel');
    const editor = fakeEditor();
    const controller = createDocumentController({ platform, prompter: prompts.prompter, editor });
    await controller.start({ kind: 'none' });
    expect(editor.value()).toBe('');
    expect((await platform.recovery.list()).map((item) => item.text)).toEqual(['keep me']);
  });

  it('offers a missing named file recovery on an untitled launch', async () => {
    const platform = createMemoryPlatform();
    await platform.recovery.put({ id: crypto.randomUUID(), path: '/n/deleted.md', stamp: 'before-deletion',
      format: { eol: '\n', bom: false, mixedEol: false }, text: 'last known edits', updatedAt: Date.now() });
    const prompts = scriptedPrompter();
    prompts.answers.recovery.push('restore');
    const editor = fakeEditor();
    const controller = createDocumentController({ platform, prompter: prompts.prompter, editor });
    await controller.start({ kind: 'none' });
    expect(prompts.asked).toEqual(['recovery:deleted.md:true']);
    expect(editor.value()).toBe('last known edits');
    expect(controller.info().path).toBe('/n/deleted.md');
    expect(controller.info().saveStatus.kind).toBe('action-needed');
    expect(platform.disk.get('/n/deleted.md')).toBeUndefined();
  });

  it('can restore an empty named recovery without losing the need to save it', async () => {
    const platform = createMemoryPlatform();
    await platform.recovery.put({ id: crypto.randomUUID(), path: '/n/empty.md', stamp: 'old',
      format: { eol: '\n', bom: false, mixedEol: false }, text: '', updatedAt: Date.now() });
    const prompts = scriptedPrompter();
    prompts.answers.recovery.push('restore');
    const controller = createDocumentController({ platform, prompter: prompts.prompter, editor: fakeEditor() });
    await controller.start({ kind: 'none' });
    expect(controller.info().dirty).toBe(true);
    prompts.answers.conflict.push('overwrite');
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/empty.md')).toBe('');
  });

  it('does not leave a stale recovery copy after saving while its write is in flight', async () => {
    vi.useFakeTimers();
    try {
      const platform = createMemoryPlatform({ files: { '/n/a.md': 'a' }, startupPath: '/n/a.md' });
      const actualPut = platform.recovery.put;
      let release!: () => void;
      platform.recovery.put = async (copy) => {
        await new Promise<void>((resolve) => { release = resolve; });
        await actualPut(copy);
      };
      const editor = fakeEditor();
      const controller = createDocumentController({ platform, prompter: scriptedPrompter().prompter, editor });
      await controller.start(await platform.startupDocument());
      editor.type('!');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(500);
      const save = controller.save();
      release();
      expect(await save).toBe(true);
      expect(platform.disk.get('/n/a.md')).toBe('a!');
      expect(await platform.recovery.list()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('checkpoints an edit made while a clean save removes its old recovery copy', async () => {
    vi.useFakeTimers();
    try {
      const { platform, editor, controller } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
      editor.type('!');
      controller.contentChanged();
      await vi.advanceTimersByTimeAsync(0);
      expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['a!']);

      const actualRemove = platform.recovery.remove;
      let startRemoving!: () => void;
      let finishRemoving!: () => void;
      const removing = new Promise<void>((resolve) => { startRemoving = resolve; });
      const release = new Promise<void>((resolve) => { finishRemoving = resolve; });
      platform.recovery.remove = async (id) => {
        startRemoving();
        await release;
        await actualRemove(id);
      };
      const save = controller.save();
      await removing;
      editor.type('?');
      controller.contentChanged();
      finishRemoving();
      expect(await save).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['a!?']);
      expect(controller.info().dirty).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a checkpoint when edits are undone back to the saved text', async () => {
    const { platform, editor, controller, asked } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    controller.contentChanged();
    await Promise.resolve();
    expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['a!']);
    editor.replace('a');
    controller.contentChanged();
    expect(controller.info().dirty).toBe(false);
    expect(await platform.requestClose()).toBe(true);
    expect(await platform.recovery.list()).toEqual([]);
    expect(asked).toEqual([]);
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

  it('stays open if typing continues while the chosen Save is in flight', async () => {
    const { platform, editor, controller, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    let release!: () => void;
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    platform.disk.setWriteGate(() => {
      entered();
      return new Promise<void>((resolve) => { release = resolve; });
    });
    editor.type('1');
    controller.contentChanged();
    answers.unsaved.push('save');
    const closing = platform.requestClose();
    await writing;
    editor.type('2');
    controller.contentChanged();
    release();
    expect(await closing).toBe(false);
    expect(platform.destroyed).toBe(false);
    expect(platform.disk.get('/n/a.md')).toBe('a1');
    expect(editor.value()).toBe('a12');
    expect(controller.info().dirty).toBe(true);
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

  it('keeps a dirty external edit pending until overwrite is explicitly confirmed', async () => {
    const { platform, editor, controller, asked, answers } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    editor.type('!');
    platform.disk.put('/n/a.md', 'theirs');
    await controller.checkDisk();
    await controller.checkDisk();
    expect(asked).toEqual(['disk:a.md']);
    expect(editor.value()).toBe('a!');
    expect(controller.info().saveStatus.kind).toBe('action-needed');
    // Keeping our buffer must not silently grant permission to overwrite theirs.
    expect(await controller.save()).toBe(false);
    expect(platform.disk.get('/n/a.md')).toBe('theirs');
    expect(asked).toEqual(['disk:a.md', 'conflict:a.md']);
    answers.conflict.push('overwrite');
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a!');
  });

  it('treats a deleted file as unsaved and recreates it on save', async () => {
    const { platform, controller, notices } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    platform.disk.remove('/n/a.md');
    await controller.checkDisk();
    expect(notices).toEqual(['a.md was deleted or moved. Save to keep it.']);
    expect(controller.info().dirty).toBe(true);
    expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['a']);
    await controller.checkDisk(); // no repeated notice
    expect(notices).toHaveLength(1);
    expect(await controller.save()).toBe(true);
    expect(platform.disk.get('/n/a.md')).toBe('a');
  });

  it('asks before replacing the retained buffer when a deleted file reappears', async () => {
    const { platform, editor, controller, answers, asked } = await setup({ '/n/a.md': 'old' }, '/n/a.md');
    platform.disk.remove('/n/a.md');
    await controller.checkDisk();
    platform.disk.put('/n/a.md', 'recreated');
    answers.disk.push('reload');
    await controller.checkDisk();
    expect(asked).toEqual(['disk:a.md']);
    expect(editor.value()).toBe('recreated');
    expect(controller.info().dirty).toBe(false);
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

  it('keeps a new edit made during a disk reload and preserves a recovery copy', async () => {
    const { platform, editor, controller } = await setup({ '/n/a.md': 'a' }, '/n/a.md');
    const actualRead = platform.fs.read;
    let release!: () => void;
    let entered!: () => void;
    const reading = new Promise<void>((resolve) => { entered = resolve; });
    platform.fs.read = async (path) => {
      entered();
      await new Promise<void>((resolve) => { release = resolve; });
      return actualRead(path);
    };
    platform.disk.put('/n/a.md', 'theirs');
    const checking = controller.checkDisk();
    await reading;
    editor.type(' mine');
    controller.contentChanged();
    release();
    await checking;
    expect(editor.value()).toBe('a mine');
    expect(controller.info().saveStatus.kind).toBe('action-needed');
    expect((await platform.recovery.list()).map((copy) => copy.text)).toEqual(['a mine']);
    expect(platform.disk.get('/n/a.md')).toBe('theirs');
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
