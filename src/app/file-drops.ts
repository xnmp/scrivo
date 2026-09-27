import { isMarkdownFile } from '../domain/attachment';
import type { EditorHandle, Workspace } from './workspace';

/** One Markdown file opens; other files attach to the current document. */
export async function routeFileDrop(
  paths: readonly string[],
  at: { readonly x: number; readonly y: number } | undefined,
  workspace: Workspace,
  currentEditor: () => EditorHandle | null,
  notify: (message: string) => void,
): Promise<void> {
  if (paths.length === 0) return;
  if (paths.some(isMarkdownFile)) {
    if (paths.length === 1) await workspace.open(paths[0]);
    else notify('Drop one Markdown file at a time to open it.');
    return;
  }
  const expectedPath = workspace.documentPath();
  const position = workspace.mode() === 'view' ? undefined : at;
  if (workspace.mode() === 'view') await workspace.edit();
  if (workspace.mode() !== 'edit') return;
  if (workspace.documentPath() !== expectedPath) {
    notify('The active document changed; drop the file again to attach it.');
    return;
  }
  await currentEditor()?.importPaths(paths, position);
}
