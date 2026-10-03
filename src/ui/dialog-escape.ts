/** WebKitGTK does not consistently implement native dialog Escape dismissal. */
export function dismissDialogOnEscape(dialog: HTMLDialogElement) {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    event.preventDefault(); dialog.close();
  });
}
