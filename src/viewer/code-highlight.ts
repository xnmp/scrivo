// Fenced code in the reading view, highlighted after the document has painted.
// Grammars come from the editor's language catalog and load only when a block uses
// them. Text nodes are built directly; no document-derived string becomes HTML.
import { LanguageDescription, LanguageSupport } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { codeLanguages } from '../editor/code-languages';

const languages = codeLanguages(() => new LanguageSupport(markdownLanguage));
const MAX_CODE_LENGTH = 20_000;

const idle = () => new Promise<IdleDeadline>((resolve) => requestIdleCallback(resolve));

function highlightedNodes(text: string, parser: LanguageSupport['language']['parser']): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let end = 0;
  highlightTree(parser.parse(text), classHighlighter, (from, to, classes) => {
    if (from > end) fragment.appendChild(document.createTextNode(text.slice(end, from)));
    const span = document.createElement('span');
    span.className = classes;
    span.textContent = text.slice(from, to);
    fragment.appendChild(span);
    end = to;
  });
  if (end < text.length) fragment.appendChild(document.createTextNode(text.slice(end)));
  return fragment;
}

/** Returns after all known, reasonably sized code blocks have been highlighted. */
export async function highlightCodeBlocks(
  article: HTMLElement,
  current: () => boolean,
  onMutated: () => void,
  descriptions: readonly LanguageDescription[] = languages,
): Promise<void> {
  const blocks = [...article.querySelectorAll<HTMLElement>('pre[data-lang] > code')];
  let deadline: IdleDeadline | null = null;
  const supports = new Map<LanguageDescription, LanguageSupport>();
  const unavailable = new Set<LanguageDescription>();
  let changed = false;
  const notify = () => {
    if (!changed) return;
    changed = false;
    onMutated();
  };
  for (const code of blocks) {
    if (!current()) return;
    const lang = code.parentElement?.getAttribute('data-lang');
    const text = code.textContent ?? '';
    if (!lang || text.length > MAX_CODE_LENGTH) continue;
    const description = LanguageDescription.matchLanguageName(descriptions, lang, true);
    if (!description) continue;
    if (unavailable.has(description)) continue;
    let support = supports.get(description);
    if (!support) {
      // A new grammar import can yield to input for an arbitrary time. Flush
      // changed text nodes before that await so an open Find never uses stale ranges.
      notify();
      try {
        support = await description.load();
        supports.set(description, support);
      } catch {
        // A failed grammar leaves the original, readable code in place.
        unavailable.add(description);
        continue;
      }
      if (!current()) return;
    }
    // Several small blocks can fit in one idle period. Refresh find's text index
    // once per batch, before yielding, instead of rescanning the document per block.
    if (!deadline || deadline.timeRemaining() < 2) {
      notify();
      deadline = await idle();
    }
    if (!current()) return;
    if (!article.contains(code)) {
      notify();
      return;
    }
    try {
      code.replaceChildren(highlightedNodes(text, support.language.parser));
      changed = true;
    } catch {
      // A failed parser leaves the original, readable code in place.
    }
  }
  notify();
}
