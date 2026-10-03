import { describe, expect, it, vi } from 'vitest';
import { createMemoryPlatform, fakeRender, type MemoryPlatform, type RenderFn } from '../platform/memory';
import { createDocumentController } from './controller';
import { registerFileDrops } from './register-file-drops';
import type { RecoveryCopy, ViewDocument } from './ports';
import { fakeEditor, scriptedPrompter } from './testing';
import { createWorkspace, type EditorHandle, type Mode, type Position } from './workspace';

function fakeViewer() {
  const shown: Array<{ doc: ViewDocument; at: Position | undefined }> = [];
  const anchors: string[] = [];
  let top = 1;
  let suspensions = 0;
  return {
    port: {
      show: async (doc: ViewDocument, at?: Position) => void shown.push({ doc, at }),
      suspend: () => { suspensions++; },
      topLine: () => top,
      scrollToAnchor: (id: string) => {
        anchors.push(id);
        return shown.at(-1)?.doc.html.includes(`id="${id}"`) ?? false;
      },
    },
    shown,
    anchors,
    scrollTo: (line: number) => void (top = line),
    suspensions: () => suspensions,
    /** Text of the rendered paragraphs/headings currently shown. */
    text: () => (shown.at(-1)?.doc.html ?? '').replace(/<[^>]+>/g, '|').split('|').filter(Boolean).join('\n'),
  };
}

async function setup(
  opts: { files?: Record<string, string>; startupPath?: string; startInEditor?: boolean; failEditorLoads?: number; watch?: boolean; render?: RenderFn;
    recoveryCopy?: RecoveryCopy; beforeEditorLoad?: () => Promise<void>; captureFocus?: () => () => boolean } = {},
) {
  const platform: MemoryPlatform = createMemoryPlatform({
    files: opts.files ?? {},
    ...(opts.startupPath ? { startupPath: opts.startupPath } : {}),
    ...(opts.startInEditor ? { startInEditor: true } : {}),
    ...(opts.render ? { render: opts.render } : {}),
  });
  if (opts.recoveryCopy) await platform.recovery.put(opts.recoveryCopy);
  const viewer = fakeViewer();
  const p = scriptedPrompter();
  const surfaces: Mode[] = [];
  const preparation: string[] = [];
  const editorPort = fakeEditor();
  const revealed: number[] = [];
  let editorTop = 1;
  let loads = 0;
  let focused = 0;
  let failuresLeft = opts.failEditorLoads ?? 0;
  let idleTask: (() => void) | undefined;
  let workspace: ReturnType<typeof createWorkspace>;
  let currentEditor: EditorHandle | null = null;
  workspace = createWorkspace({
    platform,
    viewer: viewer.port,
    ...(opts.captureFocus ? { captureFocus: opts.captureFocus } : {}),
    showSurface: (m) => void surfaces.push(m),
    prepareView: () => {
      preparation.push('prepared');
      return () => void preparation.push('released');
    },
    notify: p.prompter.notify,
    scheduleIdle: (run) => { idleTask = run; },
    ...(opts.watch ? { onPathChanged: (path: string | null) => void platform.fs.watch(path, () => void workspace.checkDisk()) } : {}),
    loadEditor: async () => {
      loads += 1;
      await opts.beforeEditorLoad?.();
      if (failuresLeft-- > 0) throw new Error('chunk failed to load');
      const controller = createDocumentController({ platform, prompter: p.prompter, editor: editorPort });
      const handle: EditorHandle = {
        controller,
        text: () => editorPort.value(),
        topLine: () => editorTop,
        revealLine: (l) => void revealed.push(l),
        focus: () => { focused++; },
        importPaths: (paths) => controller.importAttachments(paths.map((path) => ({ kind: 'path', path })), (markdown) => {
          editorPort.type(markdown);
          return true;
        }),
      };
      currentEditor = handle;
      return handle;
    },
  });
  await workspace.start();
  registerFileDrops(platform.window, workspace, () => currentEditor, p.prompter.notify);
  return {
    platform,
    viewer,
    workspace,
    editorPort,
    revealed,
    surfaces,
    preparation,
    ...p,
    loads: () => loads,
    focused: () => focused,
    runIdle: () => idleTask?.(),
    scrollEditorTo: (l: number) => void (editorTop = l),
    typeInEditor(s: string) {
      editorPort.type(s);
    },
  };
}

describe('starting', () => {
  it('shows a completed editor without stealing newer focus, then honors a new explicit edit request', async () => {
    let focus = 'reader', release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const t = await setup({ files: { '/d/a.md': 'Body' }, startupPath: '/d/a.md', beforeEditorLoad: () => ready,
      captureFocus: () => { const previous = focus; return () => previous === focus; } });
    const editing = t.workspace.edit();
    await vi.waitFor(() => expect(t.loads()).toBe(1));
    focus = 'tabs'; release(); await editing;
    expect(t.workspace.mode()).toBe('edit'); expect(t.editorPort.value()).toBe('Body'); expect(t.focused()).toBe(0);
    await t.workspace.view(); await t.workspace.edit();
    expect(t.focused()).toBe(1);
  });
  it('shows an existing file in the reading view without loading the editor', async () => {
    const t = await setup({ files: { '/d/a.md': '# A\nbody' }, startupPath: '/d/a.md' });
    expect(t.workspace.mode()).toBe('view');
    expect(t.surfaces).toEqual(['view']);
    expect(t.viewer.text()).toBe('A\nbody');
    expect(t.loads()).toBe(0);
    expect(t.platform.titles.at(-1)).toBe('a.md — Scrivo');
  });

  it.each([
    ['no document', {}],
    ['a path that does not exist yet', { startupPath: '/d/new.md' }],
    ['--edit', { files: { '/d/a.md': 'x' }, startupPath: '/d/a.md', startInEditor: true }],
  ])('starts in the editor for %s', async (_, opts) => {
    const t = await setup(opts);
    expect(t.workspace.mode()).toBe('edit');
    expect(t.surfaces).toEqual(['edit']);
    expect(t.loads()).toBe(1);
    expect(t.viewer.shown).toHaveLength(0);
  });

  it('starts the editor with the file when asked to', async () => {
    const t = await setup({ files: { '/d/a.md': 'hello' }, startupPath: '/d/a.md', startInEditor: true });
    expect(t.editorPort.value()).toBe('hello');
    expect(t.editorPort.path()).toBe('/d/a.md');
  });

  it('offers a matching named recovery copy after the reading view is shown', async () => {
    const t = await setup({
      files: { '/d/a.md': 'disk' }, startupPath: '/d/a.md',
      recoveryCopy: { id: crypto.randomUUID(), path: '/d/a.md', stamp: 'older',
        format: { eol: '\n', bom: false, mixedEol: false }, text: 'recovered', updatedAt: Date.now() },
    });
    expect(t.workspace.mode()).toBe('view');
    expect(t.loads()).toBe(0);
    t.answers.recovery.push('restore');
    t.runIdle();
    await vi.waitFor(() => expect(t.workspace.mode()).toBe('edit'));
    expect(t.editorPort.value()).toBe('recovered');
    expect(t.asked).toEqual(['recovery:a.md:true']);
    expect(t.platform.disk.get('/d/a.md')).toBe('disk');
  });

  it('surfaces an unmatched recovery copy accepted from a different reading view', async () => {
    const t = await setup({
      files: { '/d/b.md': 'B on disk' }, startupPath: '/d/b.md',
      recoveryCopy: { id: crypto.randomUUID(), path: '/d/a.md', stamp: 'older',
        format: { eol: '\n', bom: false, mixedEol: false }, text: 'A recovered', updatedAt: Date.now() },
    });
    t.answers.recovery.push('restore');
    t.runIdle();
    await vi.waitFor(() => expect(t.workspace.mode()).toBe('edit'));
    expect(t.editorPort.value()).toBe('A recovered');
    expect(t.editorPort.path()).toBe('/d/a.md');
    expect(t.asked).toEqual(['recovery:a.md:true']);
    expect(t.platform.disk.get('/d/b.md')).toBe('B on disk');
    expect(t.platform.disk.get('/d/a.md')).toBeUndefined();
    t.answers.unsaved.push('cancel');
    expect(await t.workspace.requestClose()).toBe(false);
    expect(t.asked).toContain('unsaved:a.md');
  });
});

describe('native file drops', () => {
  it('opens one Markdown file in the reading view', async () => {
    const t = await setup({ files: { '/n/a.md': '# A', '/n/b.md': '# B' }, startupPath: '/n/a.md' });
    await t.platform.dropPaths(['/n/b.md']);
    expect(t.workspace.mode()).toBe('view');
    expect(t.viewer.text()).toContain('B');
    expect(t.loads()).toBe(0);
  });

  it('switches from reading to editing and imports a dropped file beside the document', async () => {
    const t = await setup({ files: { '/n/a.md': 'Note\n' }, startupPath: '/n/a.md' });
    t.platform.disk.putBytes('/drop/picture.png', Uint8Array.of(3, 4));
    await t.platform.dropPaths(['/drop/picture.png']);
    expect(t.workspace.mode()).toBe('edit');
    expect(t.editorPort.value()).toContain('![picture](assets/picture.png)');
    expect(t.platform.disk.getBytes('/n/assets/picture.png')).toEqual(Uint8Array.of(3, 4));
  });

  it('rejects mixed Markdown drops without changing the current document', async () => {
    const t = await setup({ files: { '/n/a.md': 'A', '/n/b.md': 'B' }, startupPath: '/n/a.md' });
    await t.platform.dropPaths(['/n/b.md', '/drop/picture.png']);
    expect(t.workspace.mode()).toBe('view');
    expect(t.viewer.text()).toContain('A');
    expect(t.notices).toContain('Drop one Markdown file at a time to open it.');
  });

  it('does not attach to a different recovery document revealed during a drop', async () => {
    const t = await setup({ files: { '/n/a.md': 'A' }, startupPath: '/n/a.md',
      recoveryCopy: { id: crypto.randomUUID(), path: '/n/recovered.md', stamp: null,
        format: { eol: '\n', bom: false, mixedEol: false }, text: 'Recovered', updatedAt: Date.now() } });
    t.platform.disk.putBytes('/drop/picture.png', Uint8Array.of(3, 4));
    t.answers.recovery.push('restore');
    await t.platform.dropPaths(['/drop/picture.png']);
    expect(t.workspace.documentPath()).toBe('/n/recovered.md');
    expect(t.editorPort.value()).toBe('Recovered');
    expect(t.platform.disk.getBytes('/n/assets/picture.png')).toBeUndefined();
    expect(t.notices).toContain('The active document changed; drop the file again to attach it.');
  });
});

describe('switching between reading and editing', () => {
  const files = { '/d/a.md': '# A\none\ntwo\nthree' };

  it('loads the editor once, with the viewed file, where the reader was', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    t.viewer.scrollTo(3);
    await t.workspace.toggle();
    expect(t.workspace.mode()).toBe('edit');
    expect(t.editorPort.value()).toBe(files['/d/a.md']);
    expect(t.revealed).toEqual([3]);

    t.scrollEditorTo(2);
    await t.workspace.toggle();
    expect(t.workspace.mode()).toBe('view');
    expect(t.viewer.shown.at(-1)?.at).toEqual({ line: 2 });

    await t.workspace.toggle();
    expect(t.loads()).toBe(1);
    expect(t.surfaces).toEqual(['view', 'edit', 'view', 'edit']);
  });

  it('shows unsaved edits in the reading view without saving them', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.edit();
    t.typeInEditor('\nfour');
    await t.workspace.view();
    expect(t.viewer.text()).toBe('A\none\ntwo\nthree\nfour');
    expect(t.platform.disk.get('/d/a.md')).toBe(files['/d/a.md']);
  });

  it('shows edits typed while rendering and prepares layout only after the render is ready', async () => {
    let renderStarted!: () => void;
    let finishRender!: () => void;
    const started = new Promise<void>((resolve) => { renderStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finishRender = resolve; });
    const t = await setup({
      files,
      startupPath: '/d/a.md',
      startInEditor: true,
      render: async (text, path) => {
        if (text.includes('first') && !text.includes('second')) {
          renderStarted();
          await gate;
        }
        return fakeRender(text, path);
      },
    });
    t.typeInEditor(' first');
    const switching = t.workspace.view();
    await started;
    expect(t.preparation).toEqual([]);
    t.typeInEditor(' second');
    finishRender();
    await switching;
    expect(t.workspace.mode()).toBe('view');
    expect(t.viewer.text()).toContain('first second');
    expect(t.preparation).toEqual(['prepared', 'released']);
  });

  it('discards a rendered view when the editor changes during viewer insertion', async () => {
    const t = await setup({ files, startupPath: '/d/a.md', startInEditor: true });
    let displayStarted!: () => void;
    let finishDisplay!: () => void;
    const started = new Promise<void>((resolve) => { displayStarted = resolve; });
    const gate = new Promise<void>((resolve) => { finishDisplay = resolve; });
    const originalShow = t.viewer.port.show;
    let first = true;
    t.viewer.port.show = async (doc, at) => {
      if (first) {
        first = false;
        displayStarted();
        await gate;
      }
      await originalShow(doc, at);
    };
    t.typeInEditor(' first');
    const switching = t.workspace.view();
    await started;
    t.typeInEditor(' second');
    finishDisplay();
    await switching;
    expect(t.workspace.mode()).toBe('view');
    expect(t.viewer.text()).toContain('first second');
    expect(t.viewer.suspensions()).toBe(1);
    expect(t.preparation).toEqual(['prepared', 'released', 'prepared', 'released']);
  });

  it('opens the editor at a given line', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.edit(4);
    expect(t.revealed).toEqual([4]);
  });

  it('stays in the reading view when the file vanished before editing', async () => {
    const t = await setup({ files, startupPath: '/d/a.md', watch: true });
    t.platform.disk.remove('/d/a.md');
    await t.workspace.edit();
    expect(t.workspace.mode()).toBe('view');
    expect(t.notices.join()).toMatch(/does not exist/);
    t.platform.disk.put('/d/a.md', '# A\nrestored');
    t.platform.disk.notify('/d/a.md');
    await vi.waitFor(() => expect(t.viewer.text()).toBe('A\nrestored'));
    await t.workspace.edit();
    expect(t.workspace.mode()).toBe('edit');
    expect(t.editorPort.value()).toBe('# A\nrestored');
  });

  it('reports an editor that fails to load and can retry', async () => {
    const t = await setup({ files, startupPath: '/d/a.md', failEditorLoads: 1 });
    await t.workspace.edit();
    expect(t.workspace.mode()).toBe('view');
    expect(t.notices.join()).toMatch(/Could not load the editor/);
    await t.workspace.edit();
    expect(t.workspace.mode()).toBe('edit');
    expect(t.loads()).toBe(2);
  });

  it('handles rapid toggles in order', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await Promise.all([t.workspace.toggle(), t.workspace.toggle(), t.workspace.toggle()]);
    expect(t.workspace.mode()).toBe('edit');
    expect(t.surfaces).toEqual(['view', 'edit', 'view', 'edit']);
    expect(t.loads()).toBe(1);
  });
});

describe('opening files', () => {
  const files = { '/d/a.md': '# A', '/d/b.md': '# B', '/d/bad.md': 'x' };

  it('renders the chosen file in the reading view', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    t.platform.dialogAnswers.open.push('/d/b.md');
    await t.workspace.open();
    expect(t.viewer.text()).toBe('B');
    expect(t.platform.titles.at(-1)).toBe('b.md — Scrivo');
    expect(t.loads()).toBe(0);
  });

  it('does nothing when the dialog is cancelled', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.open();
    expect(t.viewer.shown).toHaveLength(1);
  });

  it('keeps the current document when the new one cannot be read', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.open('/d/missing.md');
    expect(t.viewer.text()).toBe('A');
    expect(t.notices.join()).toMatch(/Could not open missing\.md/);
  });

  it('goes through the editor once it exists, so unsaved edits are protected', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.edit();
    t.typeInEditor('!');
    await t.workspace.view();
    await t.workspace.open('/d/b.md'); // the prompter answers "cancel"
    expect(t.asked).toEqual(['unsaved:a.md']);
    expect(t.viewer.text()).toBe('A!');

    t.answers.unsaved.push('discard');
    await t.workspace.open('/d/b.md');
    expect(t.viewer.text()).toBe('B');
    expect(t.workspace.mode()).toBe('view');
  });

  it('refreshes the reading view when reopening the same path restores a recovery copy', async () => {
    const t = await setup({ files: { '/d/a.md': '# Disk' }, startupPath: '/d/a.md' });
    await t.workspace.edit();
    await t.workspace.view();
    expect(t.viewer.text()).toBe('Disk');
    await t.platform.recovery.put({ id: crypto.randomUUID(), path: '/d/a.md', stamp: 'older',
      format: { eol: '\n', bom: false, mixedEol: false }, text: '# Recovered', updatedAt: Date.now() });
    t.answers.recovery.push('restore');
    await t.workspace.open('/d/a.md');
    expect(t.workspace.mode()).toBe('view');
    expect(t.viewer.text()).toBe('Recovered');
    expect(t.platform.disk.get('/d/a.md')).toBe('# Disk');
  });

  it('shows the opened buffer in the editor if the reading view cannot render it', async () => {
    const t = await setup({ files: { '/d/a.md': '# Disk' }, startupPath: '/d/a.md',
      render: async (text, path) => {
        if (text.includes('Recovered')) throw new Error('renderer unavailable');
        return fakeRender(text, path);
      } });
    await t.workspace.edit();
    await t.workspace.view();
    await t.platform.recovery.put({ id: crypto.randomUUID(), path: '/d/a.md', stamp: 'older',
      format: { eol: '\n', bom: false, mixedEol: false }, text: '# Recovered', updatedAt: Date.now() });
    t.answers.recovery.push('restore');
    await t.workspace.open('/d/a.md');
    expect(t.workspace.mode()).toBe('edit');
    expect(t.editorPort.value()).toBe('# Recovered');
    expect(t.notices.join()).toContain('renderer unavailable');
  });
});

describe('following links', () => {
  const files = { '/d/a.md': '# A\n[b](b.md)', '/d/sub/b.md': '# B', '/d/b.md': '## Part\nb' };

  it('opens linked markdown documents and scrolls to their anchor', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.followLink('b.md#part');
    expect(t.viewer.text()).toBe('Part\nb');
    expect(t.viewer.shown.at(-1)?.at).toEqual({ anchor: 'part' });
    await t.workspace.followLink('sub/b.md');
    expect(t.viewer.text()).toBe('B');
  });

  it('scrolls within the document for fragment links', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.followLink('#a');
    expect(t.viewer.anchors).toEqual(['a']);
    expect(t.viewer.shown).toHaveLength(1);
  });

  it('hands web links to the system and only reveals other local files', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.followLink('https://example.com');
    await t.workspace.followLink('tool.exe');
    await t.workspace.followLink('javascript:alert(1)');
    expect(t.platform.opened).toEqual(['url:https://example.com', 'reveal:/d/tool.exe']);
  });

  it('reports a linked document that does not exist', async () => {
    const t = await setup({ files, startupPath: '/d/a.md' });
    await t.workspace.followLink('nope.md');
    expect(t.viewer.text()).toBe('A\n[b](b.md)');
    expect(t.notices.join()).toMatch(/Could not open nope\.md/);
  });
});

describe('changes made by other programs', () => {
  it('reacts to a watched file change and follows the current document', async () => {
    const t = await setup({ files: { '/d/a.md': 'one', '/d/b.md': 'bee' }, startupPath: '/d/a.md', watch: true });
    t.platform.disk.put('/d/a.md', 'two');
    t.platform.disk.notify('/d/a.md');
    await vi.waitFor(() => expect(t.viewer.text()).toBe('two'));

    await t.workspace.open('/d/b.md');
    t.platform.disk.put('/d/a.md', 'three');
    t.platform.disk.notify('/d/a.md');
    expect(t.viewer.text()).toBe('bee');
    t.platform.disk.put('/d/b.md', 'new');
    t.platform.disk.notify('/d/b.md');
    await vi.waitFor(() => expect(t.viewer.text()).toBe('new'));
  });

  it('reloads a watched file that is deleted and recreated', async () => {
    const t = await setup({ files: { '/d/a.md': 'old' }, startupPath: '/d/a.md', watch: true });
    t.platform.disk.remove('/d/a.md');
    t.platform.disk.notify('/d/a.md');
    await vi.waitFor(() => expect(t.notices).toHaveLength(1));
    expect(t.viewer.text()).toBe('old');

    t.platform.disk.put('/d/a.md', 'recreated');
    t.platform.disk.notify('/d/a.md');
    await vi.waitFor(() => expect(t.viewer.text()).toBe('recreated'));
  });

  it('watches the path assigned by Save As', async () => {
    const t = await setup({ watch: true });
    t.typeInEditor('mine');
    t.platform.dialogAnswers.save.push('/d/new.md');
    await t.workspace.saveAs();
    expect(t.platform.disk.get('/d/new.md')).toBe('mine');

    t.platform.disk.put('/d/new.md', 'external');
    t.platform.disk.notify('/d/new.md');
    await vi.waitFor(() => expect(t.editorPort.value()).toBe('external'));
  });

  it('re-renders the reading view where the reader was', async () => {
    const t = await setup({ files: { '/d/a.md': 'one' }, startupPath: '/d/a.md' });
    t.viewer.scrollTo(7);
    t.platform.disk.put('/d/a.md', 'two');
    await t.workspace.checkDisk();
    expect(t.viewer.text()).toBe('two');
    expect(t.viewer.shown.at(-1)?.at).toEqual({ line: 7 });
  });

  it('does not re-render when nothing changed', async () => {
    const t = await setup({ files: { '/d/a.md': 'one' }, startupPath: '/d/a.md' });
    await t.workspace.checkDisk();
    await t.workspace.checkDisk();
    expect(t.viewer.shown).toHaveLength(1);
  });

  it('keeps showing a deleted file and says so once', async () => {
    const t = await setup({ files: { '/d/a.md': 'one' }, startupPath: '/d/a.md' });
    t.platform.disk.remove('/d/a.md');
    await t.workspace.checkDisk();
    await t.workspace.checkDisk();
    expect(t.viewer.text()).toBe('one');
    expect(t.notices).toHaveLength(1);
  });

  it('lets the editor reload a clean document, then shows it', async () => {
    const t = await setup({ files: { '/d/a.md': 'one' }, startupPath: '/d/a.md' });
    await t.workspace.edit();
    await t.workspace.view();
    t.platform.disk.put('/d/a.md', 'two');
    await t.workspace.checkDisk();
    expect(t.editorPort.value()).toBe('two');
    expect(t.viewer.text()).toBe('two');
  });
});

describe('closing and new documents', () => {
  it('closes freely before anything was edited', async () => {
    const t = await setup({ files: { '/d/a.md': 'x' }, startupPath: '/d/a.md' });
    expect(await t.workspace.requestClose()).toBe(true);
  });

  it('asks about unsaved edits, even from the reading view', async () => {
    const t = await setup({ files: { '/d/a.md': 'x' }, startupPath: '/d/a.md' });
    await t.workspace.edit();
    t.typeInEditor('y');
    await t.workspace.view();
    expect(await t.workspace.requestClose()).toBe(false);
    expect(t.asked).toEqual(['unsaved:a.md']);
  });

  it('starts an untitled document in the editor', async () => {
    const t = await setup({ files: { '/d/a.md': 'x' }, startupPath: '/d/a.md' });
    await t.workspace.newDocument();
    expect(t.workspace.mode()).toBe('edit');
    expect(t.editorPort.value()).toBe('');
    expect(t.editorPort.path()).toBeNull();
    t.typeInEditor('draft');
    t.platform.dialogAnswers.save.push('/d/draft.md');
    await t.workspace.save();
    expect(t.platform.disk.get('/d/draft.md')).toBe('draft');
  });

  it('saves from the reading view', async () => {
    const t = await setup({ files: { '/d/a.md': 'x' }, startupPath: '/d/a.md' });
    await t.workspace.save(); // nothing loaded: nothing to save
    await t.workspace.edit();
    t.typeInEditor('y');
    await t.workspace.view();
    await t.workspace.save();
    expect(t.platform.disk.get('/d/a.md')).toBe('xy');
  });
});
