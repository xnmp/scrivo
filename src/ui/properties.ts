import { icon } from './icons';
import '../styles/properties.css';
import { addProperty, changeProperty, readProperties, type Property, type PropertyValue, type SourceChange } from '../domain/properties';

export interface PropertiesPanel {
  refresh(reset?: boolean): void;
  close(): void;
  dismiss(): boolean;
  open(): void;
  commit(): boolean;
  dispose(): void;
}

export function createPropertiesPanel(host: HTMLElement, actions: {
  readonly source: () => string;
  readonly externalShortcuts?: boolean;
  readonly controls?: boolean;
  readonly apply: (change: SourceChange, start?: boolean) => void;
  readonly finishEdit: () => void;
  readonly focusDocument: () => void;
  readonly editSource: () => void;
  readonly saveDocument: () => void;
  readonly onOpen: () => void;
}): PropertiesPanel {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'properties-toggle';
  toggle.append(icon('properties'));
  toggle.setAttribute('aria-label', 'Properties');
  toggle.title = 'Properties';
  const panel = document.createElement('aside');
  panel.className = 'properties-panel';
  panel.id = `properties-${crypto.randomUUID()}`;
  panel.setAttribute('aria-label', 'Document properties');
  panel.hidden = true;
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'false');
  const heading = document.createElement('h2');
  heading.textContent = 'Properties';
  const source = document.createElement('button');
  source.type = 'button';
  source.textContent = 'Edit YAML in source';
  const content = document.createElement('div');
  const notice = document.createElement('p');
  notice.className = 'properties-notice';
  notice.setAttribute('role', 'status');
  panel.append(heading, source, content, notice);
  if (actions.controls !== false) host.append(toggle);
  host.append(panel);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drafts = new Set<HTMLFormElement>();
  const validate = new Map<HTMLFormElement, () => boolean>();

  const close = () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    clearTimeout(timer);
  };
  const fail = (message: string) => { notice.textContent = message; };
  const inputFor = (property: Property) => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', `Property ${property.key}`);
    if (typeof property.value === 'boolean') {
      input.type = 'checkbox';
      input.checked = property.value;
    } else {
      input.type = typeof property.value === 'number' ? 'number' : 'text';
      if (input.type === 'number') input.step = 'any';
      input.value = String(property.value);
      input.maxLength = 65536;
    }
    return input;
  };
  const rowFor = (property: Property) => {
    const form = document.createElement('form');
    form.className = 'property-row';
    const label = document.createElement('label');
    label.textContent = property.key;
    const input = inputFor(property);
    label.append(input);
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = 'Save';
    save.setAttribute('aria-label', `Save property ${property.key}`);
    form.append(label, save);
    let expected = property.value;
    let editing = false;
    input.addEventListener('blur', () => { editing = false; actions.finishEdit(); });
    const applyValue = () => {
      const value: PropertyValue = typeof property.value === 'boolean' ? input.checked
        : typeof property.value === 'number' ? input.valueAsNumber : input.value;
      if (typeof value === 'number' && !Number.isFinite(value)) { fail('Enter a valid number.'); return false; }
      const current = readProperties(actions.source()).entries.find((entry) => entry.key === property.key);
      if (!current || !Object.is(current.value, expected)) {
        fail('This property changed in the document. Close and reopen Properties to load its current value.');
        return false;
      }
      if (!Object.is(value, current.value)) {
        const change = changeProperty(actions.source(), property.key, value, expected);
        if (!change) { fail('This value could not be changed. Edit it in source.'); return false; }
        actions.apply(change, !editing);
        editing = true;
        expected = value;
      }
      drafts.delete(form);
      notice.textContent = '';
      return true;
    };
    validate.set(form, applyValue);
    form.addEventListener('input', () => { drafts.add(form); applyValue(); });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (applyValue()) actions.focusDocument();
    });
    return form;
  };
  const addForm = () => {
    const form = document.createElement('form');
    form.className = 'property-add';
    const key = document.createElement('input');
    key.placeholder = 'Name';
    key.setAttribute('aria-label', 'New property name');
    key.required = true;
    key.pattern = '[A-Za-z][A-Za-z0-9_-]*';
    key.title = 'Start with a letter; use letters, numbers, underscores, or hyphens.';
    const value = document.createElement('input');
    value.placeholder = 'Value';
    value.setAttribute('aria-label', 'New property value');
    value.maxLength = 65536;
    const add = document.createElement('button');
    add.type = 'submit';
    add.textContent = 'Add property';
    form.append(key, value, add);
    form.addEventListener('input', () => drafts.add(form));
    validate.set(form, () => {
      if (!form.reportValidity()) return false;
      const change = addProperty(actions.source(), key.value, value.value);
      if (!change) { fail('Choose a unique property name, or edit this YAML in source.'); return false; }
      actions.apply(change, true);
      actions.finishEdit();
      drafts.delete(form);
      return true;
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (validate.get(form)!()) { render(); actions.focusDocument(); }
    });
    return form;
  };

  function render() {
    drafts.clear();
    validate.clear();
    notice.textContent = '';
    const properties = readProperties(actions.source());
    if (properties.kind === 'invalid') {
      content.replaceChildren();
      fail(properties.reason);
      return;
    }
    content.replaceChildren(...properties.entries.map(rowFor), addForm());
    if (properties.kind === 'ready' && properties.unsupported) {
      notice.textContent = `${properties.unsupported} complex or unsupported ${properties.unsupported === 1 ? 'property remains' : 'properties remain'} available in source.`;
    }
  }
  const open = () => {
    if (!panel.hidden) return;
    actions.onOpen(); render(); panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    if (actions.controls === false) panel.querySelector<HTMLElement>('input, button')?.focus();
  };
  const commit = () => {
    if (panel.hidden) return true;
    if (drafts.size) {
      if (![...drafts].every(form => validate.get(form)?.())) return false;
      render();
    }
    actions.focusDocument(); return true;
  };
  toggle.addEventListener('click', () => panel.hidden ? open() : close());
  source.addEventListener('click', () => { close(); actions.editSource(); });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); if (toggle.isConnected) toggle.focus(); else actions.focusDocument(); }
    else if (!actions.externalShortcuts && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if ([...drafts].every((form) => validate.get(form)?.())) {
        render();
        actions.focusDocument();
        actions.saveDocument();
      }
    }
  });
  return { open, commit,
    close,
    dismiss() { if (panel.hidden) return false; close(); actions.focusDocument(); return true; },
    refresh(reset = false) {
      clearTimeout(timer);
      if (reset) {
        if (panel.contains(document.activeElement)) actions.focusDocument();
        close();
        content.replaceChildren();
        drafts.clear();
        validate.clear();
        return;
      }
      if (panel.hidden) return;
      timer = setTimeout(() => {
        if (!drafts.size && !panel.contains(document.activeElement)) render();
      }, 150);
    },
    dispose() { clearTimeout(timer); toggle.remove(); panel.remove(); },
  };
}
