import { MAX_RULES, defaultSubstitutions, substitutionError, type Substitution } from '../domain/substitutions';
import { substitutionsStore } from '../platform/substitutions';
import { iconButton } from './icons';

export function createSubstitutionSettings(host: HTMLElement) {
  const store = substitutionsStore();
  const panel = document.createElement('section'); panel.className = 'settings-page substitutions-page';
  const heading = document.createElement('h2'); heading.textContent = 'Substitutions';
  const help = document.createElement('p'); help.textContent = 'Replace text as you type. Pasted text and existing documents stay unchanged. Backspace immediately after a replacement restores what you typed.';
  const enabledLabel = document.createElement('label'); enabledLabel.className = 'settings-row';
  const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.setAttribute('role', 'switch');
  enabledLabel.append('Enable substitutions', enabled);
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search substitutions…'; search.setAttribute('aria-label', 'Search substitutions');
  const list = document.createElement('div'); list.className = 'substitution-list';
  const notice = document.createElement('p'); notice.setAttribute('role', 'status');
  const save = (rules: readonly Substitution[]) => {
    notice.textContent = store.set({ ...store.get(), rules }) ? '' : 'Changed for this window. Could not save substitutions for the next launch.';
  };
  const update = (id: string, changes: Partial<Substitution>) => save(store.get().rules.map(rule => rule.id === id ? { ...rule, ...changes } : rule));
  const row = (rule: Substitution) => {
    const wrap = document.createElement('div'); wrap.className = 'substitution-row'; wrap.dataset.rule = rule.id;
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.setAttribute('role', 'switch'); toggle.checked = rule.enabled;
    toggle.setAttribute('aria-label', `Enable substitution ${rule.source || 'new rule'}`);
    toggle.addEventListener('change', () => update(rule.id, { enabled: toggle.checked }));
    const source = document.createElement('input'); source.value = rule.source; source.maxLength = 128; source.placeholder = 'replace this'; source.setAttribute('aria-label', 'Replace this');
    const replacement = document.createElement('input'); replacement.value = rule.replacement; replacement.maxLength = 2048; replacement.placeholder = 'with this'; replacement.setAttribute('aria-label', 'With this');
    const error = document.createElement('small'); error.className = 'substitution-error';
    const current = () => store.get().rules.find(value => value.id === rule.id)!;
    const validate = () => {
      const reason = substitutionError(current()); error.textContent = reason ?? '';
      source.setAttribute('aria-invalid', String(Boolean(reason)));
    };
    source.addEventListener('input', () => { update(rule.id, { source: source.value }); validate(); });
    replacement.addEventListener('input', () => { update(rule.id, { replacement: replacement.value }); swap.disabled = replacement.value.length > 128; });
    const swap = iconButton('swap', 'Swap source and replacement', () => {
      const value = current();
      if (value.replacement.length > 128) return;
      update(rule.id, { source: value.replacement, replacement: value.source }); render();
    });
    swap.disabled = rule.replacement.length > 128;
    if (swap.disabled) swap.title = 'Replacement is too long to use as source (128 characters maximum).';
    const regex = document.createElement('button'); regex.className = 'substitution-regex'; regex.textContent = '.*'; regex.title = 'Use regular expressions';
    regex.setAttribute('aria-label', 'Use regular expressions'); regex.setAttribute('aria-pressed', String(rule.regex));
    regex.addEventListener('click', () => { update(rule.id, { regex: !current().regex }); regex.setAttribute('aria-pressed', String(current().regex)); validate(); });
    const remove = iconButton('close', 'Remove substitution', () => { save(store.get().rules.filter(value => value.id !== rule.id)); render(); });
    wrap.append(toggle, source, swap, replacement, regex, remove, error); validate(); return wrap;
  };
  const add = document.createElement('button'); add.textContent = 'Add substitution';
  add.addEventListener('click', () => {
    if (store.get().rules.length >= MAX_RULES) return;
    const id = crypto.randomUUID();
    search.value = ''; save([...store.get().rules, { id, enabled: true, source: '', replacement: '', regex: false }]); render();
    list.querySelector<HTMLInputElement>(`[data-rule="${id}"] input[aria-label="Replace this"]`)?.focus();
  });
  const reset = document.createElement('button'); reset.textContent = 'Restore default substitutions';
  reset.addEventListener('click', () => { save(defaultSubstitutions.rules); render(); });
  const footer = document.createElement('div'); footer.className = 'settings-actions'; footer.append(add, reset);
  const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Regex and replacement syntax';
  const syntax = document.createElement('p'); syntax.textContent = 'Regex: /pattern$/ with optional i or s flags; $1, $2 and $& expand captures. Uses RE2 syntax (no backreferences or lookaround). Replacement escapes: \\n, \\t, \\b and \\\\. Rules are checked in order against up to 2,048 characters before the cursor.';
  details.append(summary, syntax);
  function render() {
    enabled.checked = store.get().enabled; add.disabled = store.get().rules.length >= MAX_RULES;
    const query = search.value.toLowerCase();
    const rules = store.get().rules.filter(rule => `${rule.source} ${rule.replacement}`.toLowerCase().includes(query));
    list.replaceChildren(...rules.map(row));
    if (!rules.length) { const empty = document.createElement('p'); empty.textContent = query ? 'No matching substitutions.' : 'No substitutions yet. Add a rule to get started.'; list.append(empty); }
  }
  enabled.addEventListener('change', () => { notice.textContent = store.set({ ...store.get(), enabled: enabled.checked }) ? '' : 'Changed for this window. Could not save substitutions for the next launch.'; });
  search.addEventListener('input', render);
  // Keep local input focus while typing; refresh other windows when the settings page reopens.
  panel.append(heading, help, enabledLabel, search, list, footer, details, notice); host.append(panel);
  return { panel, refresh: render };
}
