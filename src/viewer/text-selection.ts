/** Keep native selection/copy semantics, but highlight text nodes instead of WebKit's block boxes. */
export function installTextSelection() {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return;
  // WebKit also omits Custom Highlight paint for a parent li's bare text above
  // a nested list. Prepare inline wrappers before selection; never replace a
  // selected text node. Spans preserve layout, textContent and clipboard bytes.
  const prepare = (root: Element | Document) => {
    const nested = 'li:has(> ul), li:has(> ol)';
    const items = [...root.querySelectorAll(nested)];
    if (root instanceof Element && root.matches(nested)) items.unshift(root);
    for (const item of items) {
      if (!item.closest('.markdown-body')) continue;
      for (const node of [...item.childNodes]) if (node instanceof Text && node.textContent?.trim()) {
        const span = document.createElement('span'); node.replaceWith(span); span.append(node);
      }
    }
  };
  prepare(document);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node instanceof Element) prepare(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
  let frame = 0;
  const paint = () => {
    frame = 0;
    const selection = document.getSelection();
    const ranges: Range[] = [];
    if (selection && !selection.isCollapsed) for (let index = 0; index < selection.rangeCount; index++) {
      const selected = selection.getRangeAt(index);
      const ancestor = selected.commonAncestorContainer;
      const element = ancestor instanceof Element ? ancestor : ancestor.parentElement;
      const inside = element?.closest('.markdown-body');
      // Native Select All may give a range whose ancestor includes app chrome.
      const articles = inside ? [inside] : [...document.querySelectorAll('.markdown-body')]
        .filter(article => article.getBoundingClientRect().height > 0 && selected.intersectsNode(article));
      for (const article of articles) {
        const visit = (node: Node): void => {
          if (ranges.length >= 4096 || !selected.intersectsNode(node)) return;
          if (node instanceof Text) {
            const range = document.createRange(); range.selectNodeContents(node);
            if (range.compareBoundaryPoints(Range.START_TO_START, selected) < 0) range.setStart(selected.startContainer, selected.startOffset);
            if (range.compareBoundaryPoints(Range.END_TO_END, selected) > 0) range.setEnd(selected.endContainer, selected.endOffset);
            if (!range.collapsed) ranges.push(range);
            return;
          }
          if (!(node instanceof Element)) return;
          const rect = node.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > innerHeight) return;
          const children = node.children;
          // Renderer flow children are vertically ordered, including list items and
          // table rows. Seek at every large container, not only the article root.
          let first: Node | null = node.firstChild, stop: Node | null = null;
          if (children.length > 16) {
            let low = 0, high = children.length;
            while (low < high) {
              const middle = (low + high) >>> 1;
              if (children[middle]!.getBoundingClientRect().bottom < 0) low = middle + 1;
              else high = middle;
            }
            if (low === children.length) return;
            first = children[low]!;
            while (first.previousSibling instanceof Text) first = first.previousSibling;
            let last = low;
            while (last < children.length && children[last]!.getBoundingClientRect().top <= innerHeight) last++;
            stop = children[last] ?? null;
          }
          for (let child = first; child && child !== stop; child = child.nextSibling) visit(child);
        };
        visit(article);
      }
    }
    document.documentElement.classList.toggle('scrivo-text-selection', ranges.length > 0);
    if (ranges.length) CSS.highlights.set('scrivo-selection', new Highlight(...ranges));
    else CSS.highlights.delete('scrivo-selection');
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
}
