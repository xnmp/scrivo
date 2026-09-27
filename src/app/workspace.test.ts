import { describe, expect, it, vi } from 'vitest';
import { createMemoryPlatform, type MemoryPlatform } from '../platform/memory';
import { createDocumentController } from './controller';
import type { ViewDocument } from './ports';
import { fakeEditor, scriptedPrompter } from './testing';
import { createWorkspace, type EditorHandle, type Mode, type Position } from './workspace';

function fakeViewer() {
  const shown: Array<{ doc: ViewDocument; at: Position | undefined }> = [];
  const anchors: string[] = [];
  let top = 1;
  return {
    port: {
      show: async (doc: ViewDocument, at?: Position) => void shown.push({ doc, at }),
      topLine: () => top,
      scrollToAnchor: (id: string) => {
        anchors.push(id);
        return shown.at(-1)?.doc.html.includes(`id="${id}"`) ?? false;
      },
    },
    shown,
    anchors,
    scrollTo: (line: number) => void (top = line),
    /** Text of the rendered paragraphs/headings currently shown. */
    text: () => (shown.at(-1)?.doc.html ?? '').replace(/<[^>]+>/g, '|').split('|').filter(Boolean).join('\n'),
  };
}

async function setup(
  opts: { files?: Record<string, string>; startupPath?: string; startInEditor?: boolean; failEditorLoads?: number; watch?: boolean } = {},
) {
  const platform: MemoryPlatform = createMemoryPlatform({
    files: opts.files ?? {},
    ...(opts.startupPath ? { startupPath: opts.startupPath } : {}),
    ...(opts.startInEditor ? { startInEditor: true } : {}),
  });
  const viewer = fakeViewer();
  const p = scriptedPrompter();
  const surfaces: Mode[] = [];
  const editorPort = fakeEditor();
  const revealed: number[] = [];
  let editorTop = 1;
  let loads = 0;
  let failuresLeft = opts.failEditorLoads ?? 0;
  let workspace: ReturnType<typeof createWorkspace>;
  workspace = createWorkspace({
    platform,
    viewer: viewer.port,
    showSurface: (m) => void surfaces.push(m),
    notify: p.prompter.notify,
    ...(opts.watch ? { onPathChanged: (path: string | null) => void platform.fs.watch(path, () => void workspace.checkDisk()) } : {}),
    loadEditor: async () => {
      loads += 1;
      if (failuresLeft-- > 0) throw new Error('chunk failed to load');
      const controller = createDocumentController({ platform, prompter: p.prompter, editor: editorPort });
      const handle: EditorHandle = {
        controller,
        text: () => editorPort.value(),
        topLine: () => editorTop,
        revealLine: (l) => void revealed.push(l),
        focus: () => {},
      };
      return handle;
    },
  });
  await workspace.start();
  return {
    platform,
    viewer,
    workspace,
    editorPort,
    revealed,
    surfaces,
    ...p,
    loads: () => loads,
    scrollEditorTo: (l: number) => void (editorTop = l),
    typeInEditor(s: string) {
      editorPort.type(s);
    },
  };
}

describe('starting', () => {
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
