import { EditorView } from '@codemirror/view';
import { convertRichHtml } from '../domain/rich-paste';

export interface Insertion {
  insert(markdown: string): boolean;
  cancel(): void;
}

export interface FileTransfer {
  readonly files: readonly File[];
  readonly insertion: Insertion;
  readonly fallbackText: string;
  /** Text carried alongside pasted files; preserve it when import succeeds. */
  readonly contentText: string;
}

/** Capture the edit location before asynchronous file reads or a Save As dialog. */
export function attachmentEvents(
  begin: (at?: { readonly x: number; readonly y: number }) => Insertion | null,
  handle: (transfer: FileTransfer) => void,
  domFileDrop: boolean,
  nativeImagePaste?: (insertion: Insertion) => void,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      if (!(event.target instanceof Node) || !view.contentDOM.contains(event.target)) return false;
      if (event.target instanceof HTMLElement && event.target.closest('.cm-lp-table')) return false;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0) {
        // WebKitGTK can report no clipboard types for an X11 image. Let the
        // native webview keep its default text paste, while probing for an image.
        if (nativeImagePaste && !event.clipboardData?.types.length) {
          const insertion = begin();
          if (insertion) nativeImagePaste(insertion);
        }
        return false;
      }
      const insertion = begin();
      if (!insertion) return false;
      event.preventDefault();
      const plain = event.clipboardData?.getData('text/plain') ?? '';
      const contentText = plain || convertRichHtml(event.clipboardData?.getData('text/html') ?? '') || '';
      handle({ files, insertion, fallbackText: plain || contentText, contentText });
      return true;
    },
    dragover(event) {
      if (!domFileDrop || !event.dataTransfer?.types.includes('Files')) return false;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      return true;
    },
    drop(event, view) {
      if (!domFileDrop || !(event.target instanceof Node) || !view.contentDOM.contains(event.target)) return false;
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return false;
      const insertion = begin({ x: event.clientX, y: event.clientY });
      if (!insertion) return false;
      event.preventDefault();
      handle({ files, insertion, fallbackText: event.dataTransfer?.getData('text/plain') ?? '', contentText: '' });
      return true;
    },
  });
}
