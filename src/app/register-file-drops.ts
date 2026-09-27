import type { WindowPort } from './ports';
import type { EditorHandle, Workspace } from './workspace';
import { routeFileDrop } from './file-drops';

export function registerFileDrops(windowPort: WindowPort, workspace: Workspace, currentEditor: () => EditorHandle | null, notify: (message: string) => void): void {
  void import('../editor-app').catch(() => undefined); // warm after first paint
  void windowPort.onFilesDropped(async ({ paths, position }) => {
    try {
      await routeFileDrop(paths, position, workspace, currentEditor, notify);
    } catch (error) {
      notify(`Could not import dropped files: ${String(error)}`);
    }
  })
    .catch((error) => notify(`Could not accept file drops: ${String(error)}`));
}
