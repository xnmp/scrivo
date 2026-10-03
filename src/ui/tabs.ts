import { icon } from './icons';
import { createTabMotion } from './tab-motion';
export interface TabLabel {
  readonly id: string;
  readonly name: string;
  readonly dirty: boolean;
  readonly actionNeeded: boolean;
}

/** Window-level tab controls; the application owns selection and close policy. */
export function createTabBar(host: HTMLElement, actions: {
  readonly activate: (id: string) => void;
  readonly close: (id: string) => void;
  readonly create: () => void;
}) {
  const list = document.createElement('div');
  list.className = 'tab-list';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Documents');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tab-add';
  add.append(icon('plus'));
  add.title = 'New document';
  add.setAttribute('aria-label', 'New document');
  add.addEventListener('click', actions.create);
  host.append(list, add);

  let labels: readonly TabLabel[] = [], active: string | null = null, initialized = false;
  const nodes = new Map<string, ReturnType<typeof createItem>>();
  const revealActive = () => {
    if (active) nodes.get(active)?.item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const motion = createTabMotion(revealActive);
  new ResizeObserver(revealActive).observe(list);

  function createItem(id: string) {
    const item = document.createElement('div'); item.className = 'tab-item';
    const select = document.createElement('button');
    select.type = 'button'; select.className = 'tab-select'; select.dataset.tabId = id;
    select.setAttribute('role', 'tab'); select.setAttribute('aria-controls', `session-${id}`);
    const title = document.createElement('span'), mark = document.createElement('span');
    mark.className = 'tab-dirty'; select.append(title, mark);
    select.addEventListener('click', () => actions.activate(id));
    select.addEventListener('keydown', event => {
      const index = labels.findIndex(candidate => candidate.id === id);
      const target = event.key === 'ArrowRight' ? labels[(index + 1) % labels.length]
        : event.key === 'ArrowLeft' ? labels[(index - 1 + labels.length) % labels.length]
        : event.key === 'Home' ? labels[0] : event.key === 'End' ? labels.at(-1) : undefined;
      if (!target) return;
      event.preventDefault(); actions.activate(target.id); nodes.get(target.id)?.select.focus();
    });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'tab-close';
    close.append(icon('close')); close.addEventListener('click', () => actions.close(id));
    item.append(select, close);
    return { item, select, title, mark, close };
  }

  const render = (tabs: readonly TabLabel[], activeId: string | null) => {
    labels = tabs; active = activeId;
    const ids = new Set(tabs.map(tab => tab.id));
    for (const [id, node] of nodes) {
      if (!ids.has(id)) { nodes.delete(id); motion.exit(node.item); }
    }
    const nextLive = (node: Element | null): Element | null => {
      while (node instanceof HTMLElement && node.inert) node = node.nextElementSibling;
      return node;
    };
    let current = nextLive(list.firstElementChild);
    for (const tab of tabs) {
      let node = nodes.get(tab.id);
      const added = !node;
      if (!node) { node = createItem(tab.id); nodes.set(tab.id, node); }
      const { item, select, title, mark, close } = node;
      if (title.textContent !== tab.name) title.textContent = tab.name;
      select.title = tab.name; select.setAttribute('aria-selected', String(tab.id === activeId));
      select.tabIndex = tab.id === activeId ? 0 : -1;
      mark.hidden = !(tab.dirty || tab.actionNeeded);
      mark.textContent = tab.actionNeeded ? '!' : '●';
      mark.setAttribute('aria-label', tab.actionNeeded ? 'Action needed' : 'Edited');
      close.title = `Close ${tab.name}`; close.setAttribute('aria-label', close.title);
      // Preserve live nodes and leave departing nodes in place while they collapse.
      if (current !== item) list.insertBefore(item, current ?? null);
      current = nextLive(item.nextElementSibling);
      if (added && initialized) motion.enter(item);
    }
    initialized = true; revealActive();
  };
  return { render };
}
