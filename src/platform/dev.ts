// Browser (non-Tauri) platform for `bun run dev` and the Playwright suite: an
// in-memory disk seeded from the URL (`?doc=<name>` picks a sample document).
import { createMemoryPlatform, type MemoryPlatform } from './memory';

const SAMPLE = `# Welcome to Scrivo

Scrivo is a **fast**, *open-source* markdown editor. Syntax like \`**\` melts away as you
write and comes back when your caret is inside it.

## Things to try

- [x] Open a file from the command line
- [ ] Toggle source mode with Ctrl+/
- A [link](https://example.com) and inline math $e^{i\\pi} + 1 = 0$

> Quotes, lists, tables and code blocks render in place.

| Feature | Status |
| :------ | -----: |
| Tables  | ✓      |
| Math    | ✓      |

\`\`\`ts
const greet = (name: string) => \`hello \${name}\`;
\`\`\`

$$
\\int_0^1 x^2\\,dx = \\frac{1}{3}
$$
`;

export function createDevPlatform(): MemoryPlatform {
  const params = new URLSearchParams(location.search);
  const docParam = params.get('doc');
  const files: Record<string, string> = { '/sample/welcome.md': SAMPLE };
  const inline = params.get('text');
  if (inline !== null) files['/sample/inline.md'] = inline;
  const startupPath = inline !== null ? '/sample/inline.md' : docParam === 'none' ? undefined : '/sample/welcome.md';
  const platform = createMemoryPlatform({ files, ...(startupPath ? { startupPath } : {}) });
  // Mirror titles into the tab so they are visible during development.
  const setTitle = platform.window.setTitle;
  platform.window.setTitle = (title) => {
    setTitle(title);
    document.title = title;
  };
  return platform;
}
