import { describe, expect, it } from 'vitest';
import { activateTab, closeTab, emptyTabs, openTab, updateTabIdentity } from './tab-registry';

describe('tab registry', () => {
  it('opens one tab per canonical file identity and activates an existing tab', () => {
    const first = openTab(emptyTabs(), 'a', '/real/note.md');
    const withSecond = openTab(first, 'b', '/real/other.md');
    const reopened = openTab(withSecond, 'unused', '/real/note.md');
    expect(reopened.tabs.map((tab) => tab.id)).toEqual(['a', 'b']);
    expect(reopened.activeId).toBe('a');
  });

  it('allows multiple untitled documents and prevents Save As from colliding', () => {
    let registry = openTab(openTab(emptyTabs(), 'a', null), 'b', null);
    registry = updateTabIdentity(registry, 'a', '/real/note.md');
    expect(() => updateTabIdentity(registry, 'b', '/real/note.md')).toThrow('already open');
    expect(registry.tabs[1]?.identity).toBeNull();
  });

  it('selects the next tab, then the previous tab, and finally none', () => {
    const three = openTab(openTab(openTab(emptyTabs(), 'a', null), 'b', null), 'c', null);
    const activeMiddle = activateTab(three, 'b');
    const afterMiddle = closeTab(activeMiddle, 'b');
    expect(afterMiddle.activeId).toBe('c');
    const afterLast = closeTab(afterMiddle, 'c');
    expect(afterLast.activeId).toBe('a');
    expect(closeTab(afterLast, 'a')).toEqual(emptyTabs());
  });
});
