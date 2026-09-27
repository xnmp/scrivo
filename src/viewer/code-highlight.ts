// Fenced code in the reading view, highlighted after the document has painted.
// Grammars come from the editor's language catalog and load only when a block uses
// them. Text nodes are built directly; no document-derived string becomes HTML.
import { LanguageDescription, LanguageSupport } from '@codemirror/language';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { codeLanguages } from '../editor/code-languages';

const languages = codeLanguages(() => new LanguageSupport(markdownLanguage));
const MAX_CODE_LENGTH = 20_000;

const idle = () => new Promise<void>((resolve) => requestIdleCallback(() => resolve()));

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
export async function highlightCodeBlocks(article: HTMLElement, current: () => boolean, onMutated: () => void): Promise<void> {
  const blocks = [...article.querySelectorAll<HTMLElement>('pre[data-lang] > code')];
  for (const code of blocks) {
    if (!current()) return;
    const lang = code.parentElement?.getAttribute('data-lang');
    const text = code.textContent ?? '';
    if (!lang || text.length > MAX_CODE_LENGTH) continue;
    const description = LanguageDescription.matchLanguageName(languages, lang, true);
    if (!description) continue;
    try {
      const support = await description.load();
      await idle();
      if (!current() || !article.contains(code)) return;
      code.replaceChildren(highlightedNodes(text, support.language.parser));
      onMutated();
    } catch {
      // A failed grammar or parser leaves the original, readable code in place.
    }
  }
}
