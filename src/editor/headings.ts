import { GFM, parser as markdownParser } from '@lezer/markdown';
import { parseFragment } from 'parse5';
import type { SyntaxNode } from '@lezer/common';
import type { Heading } from '../app/ports';
import { frontMatterSyntax, mathSyntax } from './markdown-blocks';

// Outline parsing needs Markdown structure, without parsing fenced code languages.
const parser = markdownParser.configure([GFM, frontMatterSyntax, mathSyntax]);
const markers = /^(?:HeaderMark|EmphasisMark|StrikethroughMark|LinkMark|CodeMark|HTMLTag|LinkLabel)$/;

function label(source: string, heading: SyntaxNode): string {
  const replacements: Array<{ from: number; to: number; text: string }> = [];
  const visit = (node: SyntaxNode) => {
    if (markers.test(node.name) || (node.name === 'URL' && /^(?:Link|Image)$/.test(node.parent?.name ?? ''))) {
      replacements.push({ from: node.from, to: node.to, text: '' });
      return;
    }
    if (node.name === 'Escape') {
      replacements.push({ from: node.from, to: node.from + 1, text: '' });
      return;
    }
    if (node.name === 'Entity') {
      const parsed = parseFragment(source.slice(node.from, node.to));
      const decoded = parsed.childNodes.map((child) => 'value' in child ? child.value : '').join('');
      replacements.push({ from: node.from, to: node.to, text: decoded });
      return;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(heading);
  let result = '';
  let position = heading.from;
  for (const replacement of replacements) {
    result += source.slice(position, replacement.from) + replacement.text;
    position = replacement.to;
  }
  return (result + source.slice(position, heading.to)).trim().replace(/\s+/g, ' ');
}

/** Pure full-document index; run in a worker, never on the typing thread. */
export function extractHeadings(markdown: string): readonly Heading[] {
  const source = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
  const headings: Heading[] = [];
  let line = 1;
  let position = 0;
  parser.parse(source).iterate({
    enter(node) {
      if (node.name === 'FencedCode' || node.name === 'CodeBlock') return false;
      const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;
      while (position < node.from) if (source[position++] === '\n') line++;
      headings.push({ id: `line-${line}`, line, level: Number(match[1]), text: label(source, node.node) });
    },
  });
  return headings;
}
