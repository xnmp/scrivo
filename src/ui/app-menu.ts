import { bindings, commands, displayChord, type CommandDefinition, type Hotkeys } from '../domain/commands';
import { icon, iconButton } from './icons';
export function createAppMenu(host: HTMLElement, execute: (id: string) => void, hotkeys: () => Hotkeys, mac: boolean) {
  const menu = document.createElement('div'); menu.className = 'app-menu'; menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'menu'); menu.id = 'application-menu';
  const button = iconButton('menu', 'Main menu', () => menu.togglePopover());
  button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-controls', menu.id); button.setAttribute('aria-expanded', 'false');
  let group: string | null = null;
  const focusFirst = () => menu.querySelector<HTMLButtonElement>('button')?.focus();
  const item = (command: CommandDefinition) => {
    const row = document.createElement('button'); row.setAttribute('role', 'menuitem');
    const label = document.createElement('span'); label.textContent = command.label;
    const key = document.createElement('kbd'); key.textContent = bindings(command, hotkeys()).map(chord => displayChord(chord, mac)).join(' / ');
    row.append(label, key); row.addEventListener('click', () => { menu.hidePopover(); execute(command.id); }); return row;
  };
  const render = (selected: string | null = null) => {
    group = selected;
    if (group) {
      const back = document.createElement('button'); back.setAttribute('role', 'menuitem'); back.className = 'menu-back'; back.textContent = '‹ Main menu';
      back.addEventListener('click', () => { render(); focusFirst(); });
      const title = document.createElement('div'); title.className = 'menu-group'; title.textContent = group; title.setAttribute('role', 'presentation');
      menu.replaceChildren(back, title, ...commands.filter(command => command.group === group).map(item));
    } else {
      const groups = ['File', 'Edit', 'Format', 'View', 'Settings'].map(name => {
        const row = document.createElement('button'); row.setAttribute('role', 'menuitem'); row.setAttribute('aria-haspopup', 'menu');
        row.append(name, icon('chevron')); row.addEventListener('click', () => { render(name); focusFirst(); }); return row;
      });
      const divider = document.createElement('div'); divider.className = 'menu-group'; divider.setAttribute('role', 'separator');
      menu.replaceChildren(...groups, divider, ...commands.filter(command => ['recent', 'palette'].includes(command.id)).map(item));
    }
  };
  menu.addEventListener('beforetoggle', event => { if ((event as ToggleEvent).newState === 'open') render(); });
  menu.addEventListener('toggle', event => {
    const open = (event as ToggleEvent).newState === 'open'; button.setAttribute('aria-expanded', String(open)); if (open) focusFirst();
  });
  menu.addEventListener('keydown', event => {
    const rows = [...menu.querySelectorAll<HTMLButtonElement>('button')]; const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); }
    if (event.key === 'ArrowRight' && document.activeElement?.getAttribute('aria-haspopup') === 'menu') { event.preventDefault(); (document.activeElement as HTMLButtonElement).click(); }
    if (event.key === 'ArrowLeft' && group) { event.preventDefault(); render(); focusFirst(); }
    if (event.key === 'Escape') { event.preventDefault(); menu.hidePopover(); button.focus(); }
  });
  host.prepend(button); document.body.append(menu);
}
