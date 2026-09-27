// Loaded only if the startup document could not be completed.
import '../styles/tail-failure.css';

export function mountTailFailure(scroller: HTMLElement, article: HTMLElement, retry: () => void): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'document-load-error';
  banner.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.textContent = 'The document is incomplete. Try loading the rest again.';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Retry';
  button.addEventListener('click', retry);
  banner.append(message, button);
  scroller.insertBefore(banner, article);
  return banner;
}
