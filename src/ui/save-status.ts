import type { SaveStatus } from '../app/controller';
import type { StatusBar } from './status-bar';

/** Save feedback is created with the editor, outside the reading view's boot bundle. */
export function createSaveIndicator(status: StatusBar, retry: () => void): (state: SaveStatus) => void {
  const label = document.createElement('span');
  label.className = 'save-status';
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const action = document.createElement('button');
  action.className = 'save-status-action';
  action.type = 'button';
  action.hidden = true;
  action.addEventListener('click', retry);
  status.element.append(label, action);
  return (state) => {
    if (state.kind === 'action-needed') {
      label.textContent = '';
      action.textContent = ' · Action needed · Retry';
      action.title = state.reason;
      action.setAttribute('aria-label', `${state.reason}. Retry save`);
      action.hidden = false;
    } else {
      action.hidden = true;
      label.textContent = ` · ${state.kind === 'saved' ? 'Saved' : state.kind === 'saving' ? 'Saving…' : 'Edited'}`;
    }
  };
}
