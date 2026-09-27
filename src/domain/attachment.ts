/** Portable Markdown links for files imported into a sibling assets/ directory. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']);
export const MAX_CLIPBOARD_FILE_BYTES = 64 * 1024 * 1024;

export function checkClipboardFileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_CLIPBOARD_FILE_BYTES) {
    throw new Error('Clipboard file exceeds the 64 MiB import limit');
  }
}
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext', 'txt']);
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'application/pdf': 'pdf',
};

const extension = (name: string): string => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const escapeLabel = (text: string): string => text.replace(/[\\\[\]]/g, '\\$&');
const encodeSegment = (segment: string): string => encodeURIComponent(segment)
  .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export const isMarkdownFile = (name: string): boolean => MARKDOWN_EXTENSIONS.has(extension(name));

/** Match the native writer's portable filename policy for the browser test adapter. */
export function safeAttachmentName(requested: string, mimeType = ''): string {
  let name = [...requested].map((char) => /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/.test(char) ? '_' : char)
    .join('').trim().replace(/[. ]+$/, '');
  if (!name || name === '.' || name === '..') name = 'attachment';
  if (!name.includes('.') && MIME_EXTENSIONS[mimeType.toLowerCase()]) name += `.${MIME_EXTENSIONS[mimeType.toLowerCase()]}`;
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  const encoder = new TextEncoder();
  const dot = name.lastIndexOf('.');
  const suffix = dot > 0 && encoder.encode(name.slice(dot)).length <= 24 ? name.slice(dot) : '';
  const stem = suffix ? name.slice(0, dot) : name;
  let remaining = 180 - encoder.encode(suffix).length;
  let truncated = '';
  for (const char of stem) {
    const bytes = encoder.encode(char).length;
    if (bytes > remaining) break;
    truncated += char;
    remaining -= bytes;
  }
  return truncated + suffix;
}

export function collisionName(base: string, attempt: number): string {
  if (attempt === 0) return base;
  const dot = base.lastIndexOf('.');
  const split = dot > 0 ? dot : base.length;
  return `${base.slice(0, split)}-${attempt + 1}${base.slice(split)}`;
}

export function attachmentLink(fileName: string, mimeType = ''): string {
  if (!fileName || fileName === '.' || fileName === '..' || /[\\/\u0000-\u001f\u007f]/.test(fileName)) {
    throw new Error('Invalid attachment filename');
  }
  const ext = extension(fileName);
  const image = mimeType.toLowerCase().startsWith('image/') || IMAGE_EXTENSIONS.has(ext);
  const label = image && ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const destination = `assets/${encodeSegment(fileName)}`;
  return `${image ? '!' : ''}[${escapeLabel(label || fileName)}](${destination})`;
}
