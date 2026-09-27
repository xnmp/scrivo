import { Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { convertRichHtml } from '../domain/rich-paste';

/** Rich HTML is converted once; plain clipboard text retains CodeMirror's paste behavior. */
export const richPaste = EditorView.domEventHandlers({
  paste(event, view) {
    if (!(event.target instanceof Node) || !view.contentDOM.contains(event.target)) return false;
    if (event.target instanceof HTMLElement && event.target.closest('.cm-lp-table')) return false;
    const html = event.clipboardData?.getData('text/html');
    if (!html) return false;
    const markdown = convertRichHtml(html);
    if (markdown === null) {
      if (event.clipboardData?.getData('text/plain')) return false;
      event.preventDefault();
      return true;
    }
    view.dispatch({
      ...view.state.replaceSelection(markdown),
      annotations: Transaction.userEvent.of('input.paste'),
      scrollIntoView: true,
    });
    event.preventDefault();
    return true;
  },
});
