// A deliberately small HTML-to-Markdown converter for clipboard fragments.
// parse5 builds an inert tree: pasted HTML is never attached to the document,
// and only explicitly supported elements can contribute Markdown syntax.
import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5';

const MAX_HTML_LENGTH = 5_000_000;
const MAX_TAG_STARTS = 10_000;
const MAX_DEPTH = 128;
const OMIT = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'template', 'head', 'meta', 'link']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'figure', 'figcaption', 'blockquote', 'ul', 'ol', 'pre', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

const element = (node: Html.Node): node is Html.Element => 'tagName' in node;
const children = (node: Html.Node): Html.ChildNode[] => 'childNodes' in node ? node.childNodes : [];
const attr = (node: Html.Element, name: string): string | undefined => node.attrs.find((a) => a.name === name)?.value;
const atDepth = (depth: number) => {
  if (depth > MAX_DEPTH) throw new Error('Clipboard HTML is too deeply nested');
};

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/[\\`*_{}\[\]<>!|~#$]/g, '\\$&');
const longestBacktickRun = (text: string): number => {
  let longest = 0;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return longest;
};
const plainText = (node: Html.Node, depth: number): string => {
  atDepth(depth);
  if (node.nodeName === '#text') return (node as Html.TextNode).value;
  if (element(node) && OMIT.has(node.tagName)) return '';
  if (element(node) && node.tagName === 'br') return '\n';
  return children(node).map((child) => plainText(child, depth + 1)).join('');
};

/** Restrict link destinations to ordinary web links and portable relative paths. */
export function safePasteUrl(input: string): string | null {
  const url = input.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url) || url.startsWith('//') || url.startsWith('\\')) return null;
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme && !['http', 'https', 'mailto'].includes(scheme)) return null;
  // The HTML parser has already decoded character references in attributes.
  return encodeURI(url).replace(/&/g, '&amp;').replace(/[()<>\\]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

const codeSpan = (source: string): string => {
  const code = source.replace(/\s*\n\s*/g, ' ');
  const fence = '`'.repeat(longestBacktickRun(code) + 1);
  const padded = /^`|`$|^ | $/.test(code) ? ` ${code} ` : code;
  return `${fence}${padded}${fence}`;
};

const wrap = (marker: string, content: string): string => {
  const left = /^\s*/.exec(content)?.[0] ?? '';
  const right = /\s*$/.exec(content)?.[0] ?? '';
  const core = content.slice(left.length, content.length - right.length);
  return core ? `${left}${marker}${core}${marker}${right}` : content;
};

const inline = (node: Html.Node, depth: number): string => {
  atDepth(depth);
  if (node.nodeName === '#text') return escapeText((node as Html.TextNode).value.replace(/\s+/g, ' '));
  if (!element(node)) return children(node).map((child) => inline(child, depth + 1)).join('');
  const tag = node.tagName;
  if (OMIT.has(tag)) return '';
  if (tag === 'br') return '  \n';
  if (tag === 'img') return escapeText(attr(node, 'alt') ?? '');
  if (tag === 'code') return codeSpan(plainText(node, depth + 1));
  const content = node.childNodes.map((child) => inline(child, depth + 1)).join('');
  if (tag === 'a') {
    const url = safePasteUrl(attr(node, 'href') ?? '');
    return url && content.trim() ? `[${content}](${url})` : content;
  }
  if (tag === 'strong' || tag === 'b') return wrap('**', content);
  if (tag === 'em' || tag === 'i') return wrap('*', content);
  if (tag === 'del' || tag === 's' || tag === 'strike') return wrap('~~', content);
  if (tag === 'p' || tag === 'div' || tag === 'li') return `${content} `;
  return content;
};

const inlineChildren = (node: Html.Node, depth: number): string => children(node).map((child) => inline(child, depth + 1)).join('');
const blockStart = (text: string): string => text.split('\n').map((line) => {
  const space = /^[ \t]*/.exec(line)?.[0] ?? '';
  const body = line.slice(space.length);
  if (/^\d+[.)](?=\s)/.test(body)) return `${space}${body.replace(/[.)]/, (punctuation) => `\\${punctuation}`)}`;
  if (/^[-+](?=\s)/.test(body) || /^(?:-\s*)+$/.test(body) || /^=+\s*$/.test(body)) {
    return `${space}\\${body}`;
  }
  return line;
}).join('\n');

const codeBlock = (node: Html.Element, depth: number): string => {
  const raw = plainText(node, depth + 1).replace(/^\n|\n$/g, '');
  const longest = longestBacktickRun(raw);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const code = node.childNodes.find((child) => element(child) && child.tagName === 'code');
  const language = code && element(code) ? /(?:^|\s)language-([\w.+-]+)/.exec(attr(code, 'class') ?? '')?.[1] ?? '' : '';
  return `${fence}${language}\n${raw}\n${fence}`;
};

const list = (node: Html.Element, depth: number): string => {
  atDepth(depth);
  const items = node.childNodes.filter((child): child is Html.Element => element(child) && child.tagName === 'li');
  const startText = attr(node, 'start') ?? '1';
  const start = node.tagName === 'ol' && /^\+?\d{1,9}$/.test(startText) ? Number(startText) : 1;
  return items.map((item, index) => {
    const marker = node.tagName === 'ol' ? `${start + index}. ` : '- ';
    const nested = item.childNodes.filter((child): child is Html.Element => element(child) && (child.tagName === 'ul' || child.tagName === 'ol'));
    const contentNodes = item.childNodes.filter((child) => !nested.includes(child as Html.Element));
    const content = blocks(contentNodes, depth + 1).replace(/\n\n/g, '\n').trim() || '';
    const lines = content.split('\n');
    const first = `${marker}${lines[0] ?? ''}`;
    const continuation = lines.slice(1).map((line) => `${' '.repeat(marker.length)}${line}`);
    const childLines = nested.flatMap((child) => list(child, depth + 1).split('\n').map((line) => `${' '.repeat(marker.length)}${line}`));
    return [first, ...continuation, ...childLines].join('\n');
  }).join('\n');
};

const tableRows = (node: Html.Node, depth: number): Html.Element[] => {
  atDepth(depth);
  if (element(node) && node.tagName === 'tr') return [node];
  if (element(node) && !['table', 'thead', 'tbody', 'tfoot'].includes(node.tagName)) return [];
  return children(node).flatMap((child) => tableRows(child, depth + 1));
};

const table = (node: Html.Element, depth: number): string => {
  const rows = tableRows(node, depth + 1).map((row) => row.childNodes
    .filter((child): child is Html.Element => element(child) && (child.tagName === 'td' || child.tagName === 'th'))
    .map((cell) => inlineChildren(cell, depth + 2).replace(/\s+/g, ' ').trim()));
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width) return '';
  const line = (cells: readonly string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`;
  return [line(rows[0] ?? []), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
};

const block = (node: Html.Element, depth: number): string => {
  atDepth(depth);
  const tag = node.tagName;
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineChildren(node, depth).trim()}`;
  if (tag === 'p') return blockStart(inlineChildren(node, depth).trim());
  if (tag === 'ul' || tag === 'ol') return list(node, depth);
  if (tag === 'pre') return codeBlock(node, depth);
  if (tag === 'table') return table(node, depth);
  if (tag === 'hr') return '---';
  if (tag === 'blockquote') return blocks(node.childNodes, depth + 1).split('\n').map((line) => line ? `> ${line}` : '>').join('\n');
  return blocks(node.childNodes, depth + 1);
};

const blocks = (nodes: readonly Html.ChildNode[], depth: number): string => {
  atDepth(depth);
  const output: string[] = [];
  let loose = '';
  const flush = () => {
    const text = blockStart(loose.trim());
    if (text) output.push(text);
    loose = '';
  };
  for (const node of nodes) {
    if (element(node) && OMIT.has(node.tagName)) continue;
    if (element(node) && BLOCK.has(node.tagName)) {
      flush();
      const rendered = block(node, depth + 1).trim();
      if (rendered) output.push(rendered);
    } else {
      loose += inline(node, depth + 1);
    }
  }
  flush();
  return output.join('\n\n');
};

/** Return null so the clipboard adapter can fall back to text/plain. */
export function convertRichHtml(html: string): string | null {
  if (!html || html.length > MAX_HTML_LENGTH) return null;
  let tagStarts = 0;
  for (let index = html.indexOf('<'); index !== -1; index = html.indexOf('<', index + 1)) {
    if (++tagStarts > MAX_TAG_STARTS) return null;
  }
  try {
    const markdown = blocks(parseFragment(html).childNodes, 0).trim();
    return markdown || null;
  } catch {
    return null;
  }
}
