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
  add.textContent = '+';
  add.title = 'New document';
  add.setAttribute('aria-label', 'New document');
  add.addEventListener('click', actions.create);
  host.append(list, add);

  const render = (tabs: readonly TabLabel[], activeId: string | null) => {
    const focused = document.activeElement?.getAttribute('data-tab-id');
    list.replaceChildren(...tabs.map((tab) => {
      const item = document.createElement('div');
      item.className = 'tab-item';
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'tab-select';
      select.dataset.tabId = tab.id;
      select.setAttribute('role', 'tab');
      select.setAttribute('aria-controls', `session-${tab.id}`);
      select.setAttribute('aria-selected', String(tab.id === activeId));
      select.tabIndex = tab.id === activeId ? 0 : -1;
      select.title = tab.name;
      select.textContent = tab.name;
      if (tab.dirty || tab.actionNeeded) {
        const mark = document.createElement('span');
        mark.className = 'tab-dirty';
        mark.textContent = tab.actionNeeded ? '!' : '●';
        mark.setAttribute('aria-label', tab.actionNeeded ? 'Action needed' : 'Edited');
        select.appendChild(mark);
      }
      select.addEventListener('click', () => actions.activate(tab.id));
      select.addEventListener('keydown', (event) => {
        const index = tabs.findIndex((candidate) => candidate.id === tab.id);
        const target = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
          : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
          : event.key === 'Home' ? tabs[0]
          : event.key === 'End' ? tabs.at(-1) : undefined;
        if (!target) return;
        event.preventDefault();
        actions.activate(target.id);
        list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(target.id)}"]`)?.focus();
      });
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.textContent = '×';
      close.title = `Close ${tab.name}`;
      close.setAttribute('aria-label', `Close ${tab.name}`);
      close.addEventListener('click', () => actions.close(tab.id));
      item.append(select, close);
      return item;
    }));
    if (focused) list.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(focused)}"]`)?.focus();
  };

  return { render };
}
